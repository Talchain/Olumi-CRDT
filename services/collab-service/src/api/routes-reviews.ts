/**
 * Review Request API Routes
 * G.1: Async review workflows on top of infrastructure
 */

import { FastifyInstance } from 'fastify';
import { DatabaseClient } from '../database/client';
import { EventBusClient } from '../events/event-bus-client';
import {
  requireBoardAccess,
  AuthLevel,
  BoardAuthorizedRequest,
} from '../middleware/authorization';
import { CreateReviewRequestParams } from '../database/client-reviews';
import { pino } from 'pino';
import { config } from '../config';
import { INotificationService } from '../notifications/notification-types';
import {
  createReviewRequestedNotification,
  createReviewCompletedNotification,
} from '../notifications/notification-service';

const logger = pino({ level: config.logging.level });

interface ReviewIdParams {
  reviewId: string;
}

interface AssignmentIdParams {
  assignmentId: string;
}

interface CreateReviewBody {
  snapshot_id: string;
  reviewer_user_ids: string[];
  completion_rule: 'all' | 'majority' | 'threshold';
  threshold_count?: number;
  due_date?: string;
  context_message?: string;
}

interface UpdateReviewerBody {
  decision: 'approve' | 'request_changes' | 'comment_only';
}

interface AddCommentBody {
  comment_text: string;
  element_id?: string;
}

export async function registerReviewRoutes(
  app: FastifyInstance,
  db: DatabaseClient,
  eventBus: EventBusClient,
  notificationService: INotificationService
): Promise<void> {
  /**
   * POST /boards/:boardId/reviews
   * Create a new review request
   */
  app.post<{
    Params: { boardId: string };
    Body: CreateReviewBody;
  }>(
    '/api/boards/:boardId/reviews',
    {
      preHandler: [
        (app as any).authenticate,
        requireBoardAccess(db, AuthLevel.EDITOR), // Editors can request reviews
      ],
    },
    async (request, reply) => {
      const req = request as BoardAuthorizedRequest;
      const { boardId } = request.params;
      const body = request.body;

      try {
        // Validate snapshot exists
        const snapshot = await db.snapshotMethods.getSnapshotRecord(body.snapshot_id);
        if (!snapshot) {
          return reply.code(404).send({
            success: false,
            error: 'Snapshot not found',
          });
        }

        // Validate snapshot belongs to this board
        if (snapshot.boardId !== boardId) {
          return reply.code(400).send({
            success: false,
            error: 'Snapshot does not belong to this board',
          });
        }

        // Validate reviewers
        if (!body.reviewer_user_ids || body.reviewer_user_ids.length === 0) {
          return reply.code(400).send({
            success: false,
            error: 'At least one reviewer required',
          });
        }

        // Validate completion rule
        if (body.completion_rule === 'threshold') {
          if (!body.threshold_count || body.threshold_count < 1) {
            return reply.code(400).send({
              success: false,
              error: 'threshold_count required and must be >= 1 for threshold completion rule',
            });
          }
          if (body.threshold_count > body.reviewer_user_ids.length) {
            return reply.code(400).send({
              success: false,
              error: 'threshold_count cannot exceed number of reviewers',
            });
          }
        }

        // Create review request
        const params: CreateReviewRequestParams = {
          board_id: boardId,
          snapshot_id: body.snapshot_id,
          requested_by_user_id: req.user.userId,
          reviewer_user_ids: body.reviewer_user_ids,
          completion_rule: body.completion_rule,
          threshold_count: body.threshold_count,
          due_date: body.due_date,
          context_message: body.context_message,
        };

        const review = await db.reviewMethods.createReviewRequest(params);

        // Publish event to event bus
        await eventBus.publish({
          event_type: 'VISIBILITY_CHANGE' as any, // TODO: Add REVIEW_REQUESTED to event types
          board_id: boardId,
          metadata: {
            review_id: review.review_id,
            snapshot_id: review.snapshot_id,
            requested_by: req.user.userId,
            reviewer_count: body.reviewer_user_ids.length,
            completion_rule: review.completion_rule,
            event_subtype: 'REVIEW_REQUESTED',
          },
        });

        // Get board name for notifications (G.4)
        const board = await db.getBoardMetadata(boardId);

        // Get requester name
        const requester = await db.getUserById(req.user.userId);

        // Send notifications to reviewers (G.4)
        for (const reviewer_id of body.reviewer_user_ids) {
          try {
            const notification = createReviewRequestedNotification({
              reviewId: review.review_id,
              boardId,
              boardName: board?.name || 'Unknown Board',
              snapshotId: review.snapshot_id,
              requestedByUserId: req.user.userId,
              requestedByName: requester?.name,
              dueDate: review.due_date || undefined,
              contextMessage: review.context_message || undefined,
              recipientUserId: reviewer_id,
            });
            await notificationService.queueNotification(notification);
            logger.info(
              { reviewerId: reviewer_id, reviewId: review.review_id },
              'Review notification sent'
            );
          } catch (notifError) {
            logger.warn({ err: notifError, reviewerId: reviewer_id }, 'Failed to send review notification');
          }
        }

        logger.info(
          {
            reviewId: review.review_id,
            boardId,
            requestedBy: req.user.userId,
            reviewerCount: body.reviewer_user_ids.length,
          },
          'Review request created'
        );

        reply.send({
          success: true,
          data: review,
        });
      } catch (err) {
        logger.error({ err, boardId, userId: req.user.userId }, 'Failed to create review request');
        reply.code(500).send({
          success: false,
          error: 'Internal server error',
        });
      }
    }
  );

  /**
   * GET /boards/:boardId/reviews
   * List reviews for a board
   */
  app.get<{
    Params: { boardId: string };
  }>(
    '/api/boards/:boardId/reviews',
    {
      preHandler: [
        (app as any).authenticate,
        requireBoardAccess(db, AuthLevel.VIEWER),
      ],
    },
    async (request, reply) => {
      const { boardId } = request.params;

      try {
        const reviews = await db.reviewMethods.listBoardReviews(boardId);

        reply.send({
          success: true,
          data: reviews,
        });
      } catch (err) {
        logger.error({ err, boardId }, 'Failed to list reviews');
        reply.code(500).send({
          success: false,
          error: 'Internal server error',
        });
      }
    }
  );

  /**
   * GET /reviews/:reviewId
   * Get review details with assignments
   */
  app.get<{
    Params: ReviewIdParams;
  }>(
    '/api/reviews/:reviewId',
    {
      preHandler: [(app as any).authenticate],
    },
    async (request, reply) => {
      const { reviewId } = request.params;

      try {
        const review = await db.reviewMethods.getReviewRequest(reviewId);
        if (!review) {
          return reply.code(404).send({
            success: false,
            error: 'Review not found',
          });
        }

        const assignments = await db.reviewMethods.getReviewerAssignments(reviewId);
        const comments = await db.reviewMethods.getReviewComments(reviewId);

        reply.send({
          success: true,
          data: {
            review,
            assignments,
            comments,
          },
        });
      } catch (err) {
        logger.error({ err, reviewId }, 'Failed to get review');
        reply.code(500).send({
          success: false,
          error: 'Internal server error',
        });
      }
    }
  );

  /**
   * GET /users/me/reviews
   * Reviewer inbox - List reviews assigned to current user with rich context
   * G.2: Prioritized by status and due date
   */
  app.get(
    '/api/users/me/reviews',
    {
      preHandler: [(app as any).authenticate],
    },
    async (request, reply) => {
      const req = request as any;

      try {
        const inbox = await db.reviewMethods.getUserReviewInbox(req.user.userId);

        reply.send({
          success: true,
          data: inbox,
        });
      } catch (err) {
        logger.error({ err, userId: req.user.userId }, 'Failed to get review inbox');
        reply.code(500).send({
          success: false,
          error: 'Internal server error',
        });
      }
    }
  );

  /**
   * GET /reviews/:reviewId/context
   * Get full review context for review mode (G.2)
   * Returns snapshot, assignment details, and change detection
   */
  app.get<{
    Params: ReviewIdParams;
  }>(
    '/api/reviews/:reviewId/context',
    {
      preHandler: [(app as any).authenticate],
    },
    async (request, reply) => {
      const req = request as any;
      const { reviewId } = request.params;

      try {
        const context = await db.reviewMethods.getReviewContext(reviewId, req.user.userId);

        if (!context) {
          return reply.code(404).send({
            success: false,
            error: 'Review not found or snapshot unavailable',
          });
        }

        // Automatically transition to in_progress on first access
        if (context.my_assignment && context.my_assignment.status === 'pending') {
          await db.reviewMethods.updateReviewerAssignment({
            assignment_id: context.my_assignment.assignment_id,
            status: 'in_progress',
          });

          logger.info(
            { reviewId, userId: req.user.userId },
            'Auto-transitioned review to in_progress on context access'
          );
        }

        reply.send({
          success: true,
          data: context,
        });
      } catch (err) {
        logger.error({ err, reviewId }, 'Failed to get review context');
        reply.code(500).send({
          success: false,
          error: 'Internal server error',
        });
      }
    }
  );

  /**
   * POST /assignments/:assignmentId/start
   * Start reviewing (mark as in_progress)
   */
  app.post<{
    Params: AssignmentIdParams;
  }>(
    '/api/assignments/:assignmentId/start',
    {
      preHandler: [(app as any).authenticate],
    },
    async (request, reply) => {
      const req = request as any;
      const { assignmentId } = request.params;

      try {
        const updatedAssignment = await db.reviewMethods.updateReviewerAssignment({
          assignment_id: assignmentId,
          status: 'in_progress',
        });

        logger.info(
          { assignmentId, userId: req.user.userId },
          'Reviewer started review'
        );

        reply.send({
          success: true,
          data: updatedAssignment,
        });
      } catch (err) {
        logger.error({ err, assignmentId }, 'Failed to start review');
        reply.code(500).send({
          success: false,
          error: 'Internal server error',
        });
      }
    }
  );

  /**
   * POST /assignments/:assignmentId/complete
   * Complete review with decision
   */
  app.post<{
    Params: AssignmentIdParams;
    Body: UpdateReviewerBody;
  }>(
    '/api/assignments/:assignmentId/complete',
    {
      preHandler: [(app as any).authenticate],
    },
    async (request, reply) => {
      const { assignmentId } = request.params;
      const { decision } = request.body;

      try {
        // Update assignment
        const updatedAssignment = await db.reviewMethods.updateReviewerAssignment({
          assignment_id: assignmentId,
          status: 'complete',
          decision,
        });

        // Check if review is now complete
        const isComplete = await db.reviewMethods.checkReviewCompletion(
          updatedAssignment.review_id
        );

        if (isComplete) {
          // Mark review as complete
          const completedReview = await db.reviewMethods.markReviewComplete(
            updatedAssignment.review_id
          );

          // Generate outcome (G.3)
          const outcome = await db.reviewMethods.generateReviewOutcome(
            updatedAssignment.review_id
          );

          // Publish completion event
          await eventBus.publish({
            event_type: 'VISIBILITY_CHANGE' as any, // TODO: Add REVIEW_COMPLETED to event types
            board_id: completedReview.board_id,
            metadata: {
              review_id: completedReview.review_id,
              completion_rule: completedReview.completion_rule,
              overall_result: outcome.overall_result,
              event_subtype: 'REVIEW_COMPLETED',
            },
          });

          // Notify requester (G.4)
          try {
            const board = await db.getBoardMetadata(completedReview.board_id);
            const notification = createReviewCompletedNotification({
              reviewId: completedReview.review_id,
              boardId: completedReview.board_id,
              boardName: board?.name || 'Unknown Board',
              snapshotId: completedReview.snapshot_id,
              overallResult: outcome.overall_result,
              approvalsCount: outcome.approvals_count,
              changesRequestedCount: outcome.changes_requested_count,
              recommendation: outcome.recommendation,
              recipientUserId: completedReview.requested_by_user_id,
            });
            await notificationService.queueNotification(notification);
            logger.info(
              {
                userId: completedReview.requested_by_user_id,
                reviewId: completedReview.review_id,
                outcome: outcome.overall_result,
              },
              'Review completion notification sent'
            );
          } catch (notifError) {
            logger.warn({ err: notifError, reviewId: completedReview.review_id }, 'Failed to send completion notification');
          }
        }

        logger.info(
          {
            assignmentId,
            reviewId: updatedAssignment.review_id,
            decision,
            isComplete,
          },
          'Reviewer completed review'
        );

        reply.send({
          success: true,
          data: {
            assignment: updatedAssignment,
            review_completed: isComplete,
          },
        });
      } catch (err) {
        logger.error({ err, assignmentId }, 'Failed to complete review');
        reply.code(500).send({
          success: false,
          error: 'Internal server error',
        });
      }
    }
  );

  /**
   * POST /assignments/:assignmentId/decline
   * Decline to review
   */
  app.post<{
    Params: AssignmentIdParams;
  }>(
    '/api/assignments/:assignmentId/decline',
    {
      preHandler: [(app as any).authenticate],
    },
    async (request, reply) => {
      const req = request as any;
      const { assignmentId } = request.params;

      try {
        const updatedAssignment = await db.reviewMethods.updateReviewerAssignment({
          assignment_id: assignmentId,
          status: 'declined',
        });

        logger.info(
          { assignmentId, userId: req.user.userId },
          'Reviewer declined review'
        );

        reply.send({
          success: true,
          data: updatedAssignment,
        });
      } catch (err) {
        logger.error({ err, assignmentId }, 'Failed to decline review');
        reply.code(500).send({
          success: false,
          error: 'Internal server error',
        });
      }
    }
  );

  /**
   * POST /reviews/:reviewId/comments
   * Add comment to review
   */
  app.post<{
    Params: ReviewIdParams;
    Body: AddCommentBody;
  }>(
    '/api/reviews/:reviewId/comments',
    {
      preHandler: [(app as any).authenticate],
    },
    async (request, reply) => {
      const req = request as any;
      const { reviewId } = request.params;
      const { comment_text, element_id } = request.body;

      try {
        // Verify user is assigned to this review
        const assignments = await db.reviewMethods.getReviewerAssignments(reviewId);
        const userAssignment = assignments.find((a) => a.user_id === req.user.userId);

        if (!userAssignment) {
          return reply.code(403).send({
            success: false,
            error: 'You are not assigned to this review',
          });
        }

        const comment = await db.reviewMethods.addComment({
          review_id: reviewId,
          assignment_id: userAssignment.assignment_id,
          user_id: req.user.userId,
          comment_text,
          element_id,
        });

        logger.info(
          {
            reviewId,
            commentId: comment.comment_id,
            userId: req.user.userId,
          },
          'Review comment added'
        );

        reply.send({
          success: true,
          data: comment,
        });
      } catch (err) {
        logger.error({ err, reviewId }, 'Failed to add comment');
        reply.code(500).send({
          success: false,
          error: 'Internal server error',
        });
      }
    }
  );

  /**
   * GET /reviews/:reviewId/outcome
   * Get review outcome (G.3)
   * Returns comprehensive outcome analysis with decisions and recommendations
   */
  app.get<{
    Params: ReviewIdParams;
  }>(
    '/api/reviews/:reviewId/outcome',
    {
      preHandler: [(app as any).authenticate],
    },
    async (request, reply) => {
      const { reviewId } = request.params;

      try {
        // Verify review exists and is complete
        const review = await db.reviewMethods.getReviewRequest(reviewId);
        if (!review) {
          return reply.code(404).send({
            success: false,
            error: 'Review not found',
          });
        }

        if (review.status !== 'complete') {
          return reply.code(400).send({
            success: false,
            error: 'Review is not yet complete',
          });
        }

        // Get outcome
        const outcome = await db.reviewMethods.getReviewOutcome(reviewId);
        if (!outcome) {
          return reply.code(404).send({
            success: false,
            error: 'Outcome not found',
          });
        }

        reply.send({
          success: true,
          data: outcome,
        });
      } catch (err) {
        logger.error({ err, reviewId }, 'Failed to get review outcome');
        reply.code(500).send({
          success: false,
          error: 'Internal server error',
        });
      }
    }
  );

  logger.info('Review routes registered');
}
