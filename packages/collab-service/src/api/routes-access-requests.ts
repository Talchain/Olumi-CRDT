/**
 * Access Request API routes
 * Enterprise-grade access control workflow for confidential elements
 */

import { FastifyInstance } from 'fastify';
import { DocumentManager } from '../collab/document-manager';
import { DatabaseClient } from '../database/client';
import { createEnhancedUserContextAsync, checkBoardAccess } from '../auth/authorization';
import { pino } from 'pino';
import { config } from '../config';

const logger = pino({ level: config.logging.level });

const MAX_REQUESTS_PER_DAY = 10;
const MAX_RATIONALE_LENGTH = 500;

interface BoardParams {
  boardId: string;
}

interface RequestParams extends BoardParams {
  elementId: string;
}

interface AccessRequestIdParams {
  requestId: string;
}

export async function registerAccessRequestRoutes(
  app: FastifyInstance,
  documentManager: DocumentManager,
  db: DatabaseClient
): Promise<void> {
  /**
   * POST /boards/:boardId/elements/:elementId/request-access
   * Request access to a confidential element
   */
  app.post<{
    Params: RequestParams;
    Body: {
      rationale?: string;
    };
  }>(
    '/api/collab/boards/:boardId/elements/:elementId/request-access',
    async (request, reply) => {
      try {
        // @ts-ignore - Fastify authenticate decorator
        await request.jwtVerify();
        const user = request.user as any;

        const userContext = await createEnhancedUserContextAsync(user, db);
        const { boardId, elementId } = request.params;
        const { rationale } = request.body;

        // Check board access first (must be member of board)
        const access = await checkBoardAccess(boardId, userContext, db, 'VIEWER');
        if (!access.hasAccess) {
          return reply.code(403).send({
            success: false,
            error: access.reason || 'Access denied to board',
          });
        }

        // Validate rationale length
        if (rationale && rationale.length > MAX_RATIONALE_LENGTH) {
          return reply.code(400).send({
            success: false,
            error: `Rationale too long (max ${MAX_RATIONALE_LENGTH} characters)`,
          });
        }

        // Rate limiting: Check recent request count
        const recentCount = await db.accessRequestsMethods.countRecentRequests(
          userContext.userId,
          boardId,
          24
        );

        if (recentCount >= MAX_REQUESTS_PER_DAY) {
          logger.warn(
            { userId: userContext.userId, boardId, count: recentCount },
            'Access request rate limit exceeded'
          );
          return reply.code(429).send({
            success: false,
            error: `Rate limit exceeded: maximum ${MAX_REQUESTS_PER_DAY} requests per day per board`,
            retry_after: '24 hours',
          });
        }

        // Check if element exists and is confidential
        const visibility = await documentManager.visibilityManager.getElementVisibility(
          boardId,
          elementId
        );

        if (!visibility || visibility.visibility_mode !== 'confidential') {
          return reply.code(400).send({
            success: false,
            error: 'Element is not confidential or does not exist',
          });
        }

        // Check if user already has access
        const canView = await documentManager.visibilityManager.canViewElement(
          boardId,
          elementId,
          userContext.userId,
          access.role!
        );

        if (canView.can_view) {
          return reply.code(200).send({
            success: true,
            message: 'You already have access to this element',
            already_has_access: true,
          });
        }

        // Check if pending request already exists
        const hasPending = await db.accessRequestsMethods.hasPendingRequest(
          boardId,
          elementId,
          userContext.userId
        );

        if (hasPending) {
          return reply.code(200).send({
            success: true,
            message: 'Access request already pending',
            status: 'pending',
          });
        }

        // Create access request
        const accessRequest = await db.accessRequestsMethods.createAccessRequest({
          board_id: boardId,
          element_id: elementId,
          requester_user_id: userContext.userId,
          rationale,
        });

        logger.info(
          {
            requestId: accessRequest.request_id,
            boardId,
            elementId,
            requesterId: userContext.userId,
          },
          'Access request created'
        );

        // TODO: Send notifications to board owner and element setter

        reply.code(201).send({
          success: true,
          data: {
            request_id: accessRequest.request_id,
            status: accessRequest.status,
            requested_at: accessRequest.requested_at,
          },
        });
      } catch (err) {
        logger.error({ err }, 'Failed to create access request');
        reply.code(500).send({
          success: false,
          error: 'Internal server error',
        });
      }
    }
  );

  /**
   * GET /boards/:boardId/access-requests
   * Get pending access requests for a board (owner/admin only)
   */
  app.get<{
    Params: BoardParams;
  }>(
    '/api/collab/boards/:boardId/access-requests',
    async (request, reply) => {
      try {
        // @ts-ignore - Fastify authenticate decorator
        await request.jwtVerify();
        const user = request.user as any;

        const userContext = await createEnhancedUserContextAsync(user, db);
        const { boardId } = request.params;

        // Check OWNER/ADMIN access (only owners/admins can see all requests)
        const access = await checkBoardAccess(boardId, userContext, db, 'ADMIN');
        if (!access.hasAccess) {
          return reply.code(403).send({
            success: false,
            error: 'Only board admins/owners can view access requests',
          });
        }

        // Get pending requests with requester info
        const requests = await db.accessRequestsMethods.getPendingRequestsForBoard(boardId);

        reply.send({
          success: true,
          data: {
            requests,
            total: requests.length,
          },
        });
      } catch (err) {
        logger.error({ err }, 'Failed to get access requests');
        reply.code(500).send({
          success: false,
          error: 'Internal server error',
        });
      }
    }
  );

  /**
   * GET /my-access-requests
   * Get user's own access requests across all boards
   */
  app.get('/api/collab/my-access-requests', async (request, reply) => {
    try {
      // @ts-ignore - Fastify authenticate decorator
      await request.jwtVerify();
      const user = request.user as any;

      const userContext = await createEnhancedUserContextAsync(user, db);

      // Get user's requests
      const requests = await db.accessRequestsMethods.getUserAccessRequests(
        userContext.userId
      );

      reply.send({
        success: true,
        data: {
          requests,
          total: requests.length,
        },
      });
    } catch (err) {
      logger.error({ err }, 'Failed to get user access requests');
      reply.code(500).send({
        success: false,
        error: 'Internal server error',
      });
    }
  });

  /**
   * POST /access-requests/:requestId/approve
   * Approve an access request
   */
  app.post<{
    Params: AccessRequestIdParams;
    Body: {
      expires_in_days?: number;
    };
  }>(
    '/api/collab/access-requests/:requestId/approve',
    async (request, reply) => {
      try {
        // @ts-ignore - Fastify authenticate decorator
        await request.jwtVerify();
        const user = request.user as any;

        const userContext = await createEnhancedUserContextAsync(user, db);
        const { requestId } = request.params;
        const { expires_in_days } = request.body;

        // Validate expires_in_days
        if (expires_in_days !== undefined) {
          if (expires_in_days < 1 || expires_in_days > 90) {
            return reply.code(400).send({
              success: false,
              error: 'expires_in_days must be between 1 and 90',
            });
          }
        }

        // Get the request
        const accessRequest = await db.accessRequestsMethods.getAccessRequest(requestId);
        if (!accessRequest) {
          return reply.code(404).send({
            success: false,
            error: 'Access request not found',
          });
        }

        if (accessRequest.status !== 'pending') {
          return reply.code(400).send({
            success: false,
            error: `Request already ${accessRequest.status}`,
          });
        }

        // Check board access (must be ADMIN or OWNER)
        const access = await checkBoardAccess(
          accessRequest.board_id,
          userContext,
          db,
          'ADMIN'
        );
        if (!access.hasAccess) {
          return reply.code(403).send({
            success: false,
            error: 'Only board admins/owners can approve requests',
          });
        }

        // Approve the request
        const approved = await db.accessRequestsMethods.approveAccessRequest({
          request_id: requestId,
          approved_by_user_id: userContext.userId,
          expires_in_days,
        });

        // Add requester to element's viewer whitelist
        const visibility = await documentManager.visibilityManager.getElementVisibility(
          accessRequest.board_id,
          accessRequest.element_id
        );

        if (visibility) {
          const currentWhitelist = visibility.viewer_whitelist || [];
          if (!currentWhitelist.includes(accessRequest.requester_user_id)) {
            await documentManager.visibilityManager.setElementVisibility(
              accessRequest.board_id,
              access.orgId!,
              access.teamId!,
              userContext.userId,
              access.role!,
              {
                elementId: accessRequest.element_id,
                elementType: visibility.element_type,
                visibilityMode: visibility.visibility_mode,
                viewerWhitelist: [...currentWhitelist, accessRequest.requester_user_id],
                viewerRoles: visibility.viewer_roles,
                rationale: `Access granted via request ${requestId}`,
              }
            );
          }
        }

        logger.info(
          {
            requestId,
            approvedBy: userContext.userId,
            requester: accessRequest.requester_user_id,
            expiresAt: approved.expires_at,
          },
          'Access request approved'
        );

        // TODO: Send notification to requester

        reply.send({
          success: true,
          data: {
            request: approved,
            message: 'Access granted',
          },
        });
      } catch (err: any) {
        logger.error({ err }, 'Failed to approve access request');
        reply.code(500).send({
          success: false,
          error: err.message || 'Internal server error',
        });
      }
    }
  );

  /**
   * POST /access-requests/:requestId/deny
   * Deny an access request
   */
  app.post<{
    Params: AccessRequestIdParams;
    Body: {
      reason?: string;
    };
  }>(
    '/api/collab/access-requests/:requestId/deny',
    async (request, reply) => {
      try {
        // @ts-ignore - Fastify authenticate decorator
        await request.jwtVerify();
        const user = request.user as any;

        const userContext = await createEnhancedUserContextAsync(user, db);
        const { requestId } = request.params;
        const { reason } = request.body;

        // Validate reason length
        if (reason && reason.length > MAX_RATIONALE_LENGTH) {
          return reply.code(400).send({
            success: false,
            error: `Denial reason too long (max ${MAX_RATIONALE_LENGTH} characters)`,
          });
        }

        // Get the request
        const accessRequest = await db.accessRequestsMethods.getAccessRequest(requestId);
        if (!accessRequest) {
          return reply.code(404).send({
            success: false,
            error: 'Access request not found',
          });
        }

        if (accessRequest.status !== 'pending') {
          return reply.code(400).send({
            success: false,
            error: `Request already ${accessRequest.status}`,
          });
        }

        // Check board access (must be ADMIN or OWNER)
        const access = await checkBoardAccess(
          accessRequest.board_id,
          userContext,
          db,
          'ADMIN'
        );
        if (!access.hasAccess) {
          return reply.code(403).send({
            success: false,
            error: 'Only board admins/owners can deny requests',
          });
        }

        // Deny the request
        const denied = await db.accessRequestsMethods.denyAccessRequest({
          request_id: requestId,
          denied_by_user_id: userContext.userId,
          denial_reason: reason,
        });

        logger.info(
          {
            requestId,
            deniedBy: userContext.userId,
            requester: accessRequest.requester_user_id,
            reason,
          },
          'Access request denied'
        );

        // TODO: Send notification to requester

        reply.send({
          success: true,
          data: {
            request: denied,
            message: 'Access request denied',
          },
        });
      } catch (err: any) {
        logger.error({ err }, 'Failed to deny access request');
        reply.code(500).send({
          success: false,
          error: err.message || 'Internal server error',
        });
      }
    }
  );

  logger.info('Access request routes registered');
}
