/**
 * REST API routes
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { DocumentManager } from '../collab/document-manager';
import { CollaborationWebSocketServer } from '../collab/websocket-server';
import { DatabaseClient } from '../database/client';
import { transformToRunInput } from '../types/board';
import { createEnhancedUserContext, UserRole } from '../types/auth';
import {
  createEnhancedUserContextAsync,
  checkBoardAccess,
  checkSnapshotAccess,
  AuthorizationErrors,
} from '../auth/authorization';
import {
  createPermissiveRateLimitMiddleware,
  createRateLimitMiddleware,
  createStrictRateLimitMiddleware,
} from '../middleware/rate-limit';
import { registerAccessRequestRoutes } from './routes-access-requests';
import { pino } from 'pino';
import { config } from '../config';

const logger = pino({ level: config.logging.level });

// SECURITY FIX: Create rate limiters for different endpoint types
const readRateLimiter = createPermissiveRateLimitMiddleware(); // 300 req/min for reads
const writeRateLimiter = createRateLimitMiddleware(); // 100 req/min for writes
const strictRateLimiter = createStrictRateLimitMiddleware(); // 20 req/min for sensitive ops

interface BoardParams {
  boardId: string;
}

interface CreateSnapshotBody {
  type?: 'manual' | 'periodic' | 'on_run';
  reason?: string;
}

interface SnapshotIdParams {
  boardId: string;
  snapshotId: string;
}

interface RenameSnapshotBody {
  name: string;
}

export async function registerRoutes(
  app: FastifyInstance,
  documentManager: DocumentManager,
  wsServer: CollaborationWebSocketServer,
  db: DatabaseClient
): Promise<void> {
  /**
   * Health check
   */
  app.get('/health', async (request, reply) => {
    const docMetrics = documentManager.getMetrics();
    const wsMetrics = wsServer.getMetrics();

    reply.send({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      metrics: {
        activeConnections: wsMetrics.totalConnections,
        activeBoards: wsMetrics.totalBoards,
        memoryUsageMB: Math.round(docMetrics.memoryBytes / 1024 / 1024),
        uptimeSeconds: Math.floor(process.uptime()),
      },
    });
  });

  /**
   * Get latest snapshot
   */
  app.get<{ Params: BoardParams }>(
    '/api/collab/boards/:boardId/snapshot',
    {
      onRequest: [app.authenticate],
    },
    async (request, reply) => {
      const { boardId } = request.params;
      const user = (request as any).user;

      try {
        // Check access
        const board = await db.getBoard(boardId);

        if (!board) {
          return reply.code(404).send({
            success: false,
            error: 'Board not found',
          });
        }

        // Enhanced authorization check (requires at least VIEWER)
        const enhancedContext = createEnhancedUserContext(user);
        const authResult = checkBoardAccess(board, enhancedContext, UserRole.VIEWER);

        if (!authResult.authorized) {
          logger.warn(
            { boardId, userId: user.userId, reason: authResult.reason },
            'Snapshot access denied'
          );
          return reply.code(403).send({
            success: false,
            error: AuthorizationErrors[authResult.reason as keyof typeof AuthorizationErrors] || 'Access denied',
          });
        }

        // Get latest snapshot
        const snapshot = await db.getLatestSnapshot(boardId);

        if (!snapshot) {
          return reply.code(404).send({
            success: false,
            error: 'No snapshot found',
          });
        }

        reply.send({
          success: true,
          data: {
            id: snapshot.id,
            boardId: snapshot.boardId,
            version: snapshot.version,
            createdAt: snapshot.createdAt,
            board: snapshot.data,
          },
        });
      } catch (err) {
        logger.error({ err, boardId }, 'Failed to get snapshot');
        reply.code(500).send({
          success: false,
          error: 'Internal server error',
        });
      }
    }
  );

  /**
   * Create snapshot
   */
  app.post<{ Params: BoardParams; Body: CreateSnapshotBody }>(
    '/api/collab/boards/:boardId/snapshot',
    {
      onRequest: [app.authenticate],
    },
    async (request, reply) => {
      const { boardId } = request.params;
      const { type = 'manual', reason } = request.body || {};
      const user = (request as any).user;

      try {
        // Check access
        const board = await db.getBoard(boardId);

        if (!board) {
          return reply.code(404).send({
            success: false,
            error: 'Board not found',
          });
        }

        // Enhanced authorization check (requires EDITOR to create snapshots)
        const enhancedContext = createEnhancedUserContext(user);
        const authResult = checkSnapshotAccess(board, enhancedContext);

        if (!authResult.authorized) {
          logger.warn(
            { boardId, userId: user.userId, reason: authResult.reason },
            'Snapshot creation denied'
          );
          return reply.code(403).send({
            success: false,
            error: AuthorizationErrors[authResult.reason as keyof typeof AuthorizationErrors] || 'Access denied',
          });
        }

        // Generate snapshot
        const snapshot = await documentManager.generateSnapshot(boardId, type);

        if (!snapshot) {
          return reply.code(500).send({
            success: false,
            error: 'Failed to generate snapshot',
          });
        }

        logger.info({ boardId, snapshotId: snapshot.id, type, reason }, 'Snapshot created via API');

        reply.code(201).send({
          success: true,
          data: {
            id: snapshot.id,
            boardId: snapshot.boardId,
            createdAt: snapshot.createdAt,
          },
        });
      } catch (err) {
        logger.error({ err, boardId }, 'Failed to create snapshot');
        reply.code(500).send({
          success: false,
          error: 'Internal server error',
        });
      }
    }
  );

  /**
   * List snapshots for a board
   */
  app.get<{ Params: BoardParams; Querystring: { limit?: string } }>(
    '/api/collab/boards/:boardId/snapshots',
    {
      onRequest: [app.authenticate],
    },
    async (request, reply) => {
      const { boardId } = request.params;
      const limit = request.query.limit ? parseInt(request.query.limit, 10) : 50;
      const user = (request as any).user;

      try {
        // Check access
        const board = await db.getBoard(boardId);

        if (!board) {
          return reply.code(404).send({
            success: false,
            error: 'Board not found',
          });
        }

        // Enhanced authorization check (requires at least VIEWER)
        const enhancedContext = createEnhancedUserContext(user);
        const boardDoc = { ...board.data, orgId: board.orgId, teamId: board.teamId };
        const authResult = checkBoardAccess(boardDoc, enhancedContext, UserRole.VIEWER);

        if (!authResult.authorized) {
          logger.warn(
            { boardId, userId: user.userId, reason: authResult.reason },
            'Snapshot list access denied'
          );
          return reply.code(403).send({
            success: false,
            error: AuthorizationErrors[authResult.reason as keyof typeof AuthorizationErrors] || 'Access denied',
          });
        }

        // Get snapshots with provenance
        const snapshots = await documentManager.snapshotManager.listSnapshots(boardId, limit);

        const snapshotsWithProvenance = await Promise.all(
          snapshots.map(async (s) => {
            const provenance = await documentManager.snapshotManager.getSnapshotProvenance(s.snapshotId);
            return {
              snapshotId: s.snapshotId,
              snapshotHash: s.snapshotHash,
              name: s.name,
              createdAt: s.createdAt,
              createdBy: s.createdByUserId,
              isImmutable: s.isImmutable,
              parentSnapshotId: s.parentSnapshotId,
              provenance: provenance || undefined,
            };
          })
        );

        reply.send({
          success: true,
          data: {
            snapshots: snapshotsWithProvenance,
            total: snapshotsWithProvenance.length,
          },
        });
      } catch (err) {
        logger.error({ err, boardId }, 'Failed to list snapshots');
        reply.code(500).send({
          success: false,
          error: 'Internal server error',
        });
      }
    }
  );

  /**
   * Rename snapshot
   */
  app.patch<{ Params: SnapshotIdParams; Body: RenameSnapshotBody }>(
    '/api/collab/boards/:boardId/snapshots/:snapshotId',
    {
      onRequest: [app.authenticate],
    },
    async (request, reply) => {
      const { boardId, snapshotId } = request.params;
      const { name } = request.body;
      const user = (request as any).user;

      try {
        // Check access
        const board = await db.getBoard(boardId);

        if (!board) {
          return reply.code(404).send({
            success: false,
            error: 'Board not found',
          });
        }

        // Enhanced authorization check (requires EDITOR to rename snapshots)
        const enhancedContext = createEnhancedUserContext(user);
        const boardDoc = { ...board.data, orgId: board.orgId, teamId: board.teamId };
        const authResult = checkSnapshotAccess(boardDoc, enhancedContext);

        if (!authResult.authorized) {
          logger.warn(
            { boardId, snapshotId, userId: user.userId, reason: authResult.reason },
            'Snapshot rename denied'
          );
          return reply.code(403).send({
            success: false,
            error: AuthorizationErrors[authResult.reason as keyof typeof AuthorizationErrors] || 'Access denied',
          });
        }

        // Verify snapshot exists and belongs to this board
        const snapshot = await documentManager.snapshotManager.getSnapshot(snapshotId);

        if (!snapshot || snapshot.boardId !== boardId) {
          return reply.code(404).send({
            success: false,
            error: 'Snapshot not found',
          });
        }

        // Update snapshot name
        await documentManager.snapshotManager.updateSnapshotName(snapshotId, name);

        logger.info({ boardId, snapshotId, name, userId: user.userId }, 'Snapshot renamed');

        reply.send({
          success: true,
          data: {
            snapshotId,
            name,
          },
        });
      } catch (err) {
        logger.error({ err, boardId, snapshotId }, 'Failed to rename snapshot');
        reply.code(500).send({
          success: false,
          error: 'Internal server error',
        });
      }
    }
  );

  /**
   * Restore snapshot
   */
  app.post<{ Params: SnapshotIdParams }>(
    '/api/collab/boards/:boardId/snapshots/:snapshotId/restore',
    {
      onRequest: [app.authenticate],
    },
    async (request, reply) => {
      const { boardId, snapshotId } = request.params;
      const user = (request as any).user;

      try {
        // Check access
        const board = await db.getBoard(boardId);

        if (!board) {
          return reply.code(404).send({
            success: false,
            error: 'Board not found',
          });
        }

        // Enhanced authorization check (requires EDITOR to restore snapshots)
        const enhancedContext = createEnhancedUserContext(user);
        const boardDoc = { ...board.data, orgId: board.orgId, teamId: board.teamId };
        const authResult = checkSnapshotAccess(boardDoc, enhancedContext);

        if (!authResult.authorized) {
          logger.warn(
            { boardId, snapshotId, userId: user.userId, reason: authResult.reason },
            'Snapshot restore denied'
          );
          return reply.code(403).send({
            success: false,
            error: AuthorizationErrors[authResult.reason as keyof typeof AuthorizationErrors] || 'Access denied',
          });
        }

        // Verify snapshot exists and belongs to this board
        const snapshot = await documentManager.snapshotManager.getSnapshot(snapshotId);

        if (!snapshot || snapshot.boardId !== boardId) {
          return reply.code(404).send({
            success: false,
            error: 'Snapshot not found',
          });
        }

        // Restore snapshot (this will create before/after snapshots)
        await documentManager.restoreSnapshot(boardId, snapshotId, user.userId);

        logger.info({ boardId, snapshotId, userId: user.userId }, 'Snapshot restored');

        reply.send({
          success: true,
          data: {
            snapshotId,
            restoredAt: new Date().toISOString(),
          },
        });
      } catch (err) {
        logger.error({ err, boardId, snapshotId }, 'Failed to restore snapshot');
        reply.code(500).send({
          success: false,
          error: 'Internal server error',
        });
      }
    }
  );

  /**
   * Get board collaboration status
   */
  app.get<{ Params: BoardParams }>(
    '/api/collab/boards/:boardId/status',
    {
      onRequest: [app.authenticate],
    },
    async (request, reply) => {
      const { boardId } = request.params;
      const user = (request as any).user;

      try {
        // Check access
        const board = await db.getBoard(boardId);

        if (!board) {
          return reply.code(404).send({
            success: false,
            error: 'Board not found',
          });
        }

        // Enhanced authorization check (requires at least VIEWER)
        const enhancedContext = createEnhancedUserContext(user);
        const authResult = checkBoardAccess(board, enhancedContext, UserRole.VIEWER);

        if (!authResult.authorized) {
          logger.warn(
            { boardId, userId: user.userId, reason: authResult.reason },
            'Board status access denied'
          );
          return reply.code(403).send({
            success: false,
            error: AuthorizationErrors[authResult.reason as keyof typeof AuthorizationErrors] || 'Access denied',
          });
        }

        // Get status
        const status = wsServer.getBoardStatus(boardId);
        const snapshot = await db.getLatestSnapshot(boardId);

        reply.send({
          success: true,
          data: {
            boardId,
            isActive: status.isActive,
            connectedUsers: status.connectedUsers,
            lastSnapshot: snapshot?.createdAt,
          },
        });
      } catch (err) {
        logger.error({ err, boardId }, 'Failed to get board status');
        reply.code(500).send({
          success: false,
          error: 'Internal server error',
        });
      }
    }
  );

  /**
   * Get board for engine (snapshot + transformation)
   */
  app.get<{ Params: BoardParams }>(
    '/api/collab/boards/:boardId/run-input',
    {
      onRequest: [app.authenticate],
    },
    async (request, reply) => {
      const { boardId } = request.params;
      const user = (request as any).user;

      try {
        // Check access
        const board = await db.getBoard(boardId);

        if (!board) {
          return reply.code(404).send({
            success: false,
            error: 'Board not found',
          });
        }

        // Enhanced authorization check (requires EDITOR to run engine)
        const enhancedContext = createEnhancedUserContext(user);
        const authResult = checkSnapshotAccess(board, enhancedContext);

        if (!authResult.authorized) {
          logger.warn(
            { boardId, userId: user.userId, reason: authResult.reason },
            'Run input access denied'
          );
          return reply.code(403).send({
            success: false,
            error: AuthorizationErrors[authResult.reason as keyof typeof AuthorizationErrors] || 'Access denied',
          });
        }

        // Generate fresh snapshot for engine run
        const snapshot = await documentManager.generateSnapshot(boardId, 'on_run');

        if (!snapshot) {
          return reply.code(500).send({
            success: false,
            error: 'Failed to generate snapshot',
          });
        }

        // Transform to engine input
        const runInput = transformToRunInput(snapshot.data);

        reply.send({
          success: true,
          data: {
            snapshotId: snapshot.id,
            input: runInput,
          },
        });
      } catch (err) {
        logger.error({ err, boardId }, 'Failed to get run input');
        reply.code(500).send({
          success: false,
          error: 'Internal server error',
        });
      }
    }
  );

  /**
   * Admin: List active boards
   */
  app.get(
    '/api/collab/admin/boards',
    {
      onRequest: [app.authenticate, app.requireAdmin],
    },
    async (request, reply) => {
      try {
        const wsMetrics = wsServer.getMetrics();
        const docMetrics = documentManager.getMetrics();

        reply.send({
          success: true,
          data: {
            totalBoards: wsMetrics.totalBoards,
            totalConnections: wsMetrics.totalConnections,
            activeDocuments: docMetrics.activeDocuments,
            memoryUsageMB: Math.round(docMetrics.memoryBytes / 1024 / 1024),
          },
        });
      } catch (err) {
        logger.error({ err }, 'Failed to get admin boards');
        reply.code(500).send({
          success: false,
          error: 'Internal server error',
        });
      }
    }
  );

  // ========== Comment Routes (Phase 2 - Section 6) ==========

  /**
   * Create a comment on a board entity
   */
  app.post<{
    Params: BoardParams;
    Body: {
      entityId: string;
      entityType: 'goal' | 'option' | 'outcome' | 'assumption' | 'evidence' | 'edge';
      content: string;
      evidenceRefs?: string[];
      replyTo?: string;
    };
  }>(
    '/api/collab/boards/:boardId/comments',
    async (request, reply) => {
      try {
        // @ts-ignore - Fastify authenticate decorator
        await request.jwtVerify();
        const user = request.user as any;

        const userContext = await createEnhancedUserContextAsync(user, db);
        const { boardId } = request.params;
        const { entityId, entityType, content, evidenceRefs, replyTo } = request.body;

        // Check EDITOR access
        const access = await checkBoardAccess(boardId, userContext, db, 'EDITOR');
        if (!access.hasAccess) {
          return reply.code(403).send({
            success: false,
            error: access.reason || 'Access denied',
          });
        }

        const commentsManager = documentManager.commentsManager;

        const comment = await commentsManager.createComment(
          boardId,
          access.orgId!,
          access.teamId!,
          userContext.userId,
          user.name || userContext.email || 'Unknown User',  // Use name from JWT or fallback to email
          {
            entityId,
            entityType,
            content,
            evidenceRefs,
            replyTo,
          }
        );

        // Broadcast comment event to connected clients
        wsServer.broadcastCommentEvent(boardId, {
          type: 'comment_create',
          commentId: comment.id,
          entityId,
          entityType,
          authorId: userContext.userId,
          timestamp: comment.createdAt,
        });

        reply.send({
          success: true,
          data: { comment },
        });
      } catch (err) {
        logger.error({ err }, 'Failed to create comment');
        reply.code(500).send({
          success: false,
          error: 'Internal server error',
        });
      }
    }
  );

  /**
   * Get comments for a board
   */
  app.get<{
    Params: BoardParams;
    Querystring: {
      entityId?: string;
      resolved?: string;
    };
  }>(
    '/api/collab/boards/:boardId/comments',
    async (request, reply) => {
      try {
        // @ts-ignore - Fastify authenticate decorator
        await request.jwtVerify();
        const user = request.user as any;

        const userContext = await createEnhancedUserContextAsync(user, db);
        const { boardId } = request.params;
        const { entityId, resolved } = request.query;

        // Check VIEWER access
        const access = await checkBoardAccess(boardId, userContext, db, 'VIEWER');
        if (!access.hasAccess) {
          return reply.code(403).send({
            success: false,
            error: access.reason || 'Access denied',
          });
        }

        const commentsManager = documentManager.commentsManager;

        const comments = await commentsManager.getComments(boardId, {
          entityId,
          resolved: resolved !== undefined ? resolved === 'true' : undefined,
        });

        reply.send({
          success: true,
          data: { comments },
        });
      } catch (err) {
        logger.error({ err }, 'Failed to get comments');
        reply.code(500).send({
          success: false,
          error: 'Internal server error',
        });
      }
    }
  );

  /**
   * Get comment threads for a board
   */
  app.get<{
    Params: BoardParams;
    Querystring: {
      entityId?: string;
      resolved?: string;
    };
  }>(
    '/api/collab/boards/:boardId/comments/threads',
    async (request, reply) => {
      try {
        // @ts-ignore - Fastify authenticate decorator
        await request.jwtVerify();
        const user = request.user as any;

        const userContext = await createEnhancedUserContextAsync(user, db);
        const { boardId } = request.params;
        const { entityId, resolved } = request.query;

        // Check VIEWER access
        const access = await checkBoardAccess(boardId, userContext, db, 'VIEWER');
        if (!access.hasAccess) {
          return reply.code(403).send({
            success: false,
            error: access.reason || 'Access denied',
          });
        }

        const commentsManager = documentManager.commentsManager;

        const threads = await commentsManager.getCommentThreads(boardId, {
          entityId,
          resolved: resolved !== undefined ? resolved === 'true' : undefined,
        });

        reply.send({
          success: true,
          data: { threads },
        });
      } catch (err) {
        logger.error({ err }, 'Failed to get comment threads');
        reply.code(500).send({
          success: false,
          error: 'Internal server error',
        });
      }
    }
  );

  /**
   * Update a comment
   */
  app.patch<{
    Params: BoardParams & { commentId: string };
    Body: {
      content?: string;
      evidenceRefs?: string[];
    };
  }>(
    '/api/collab/boards/:boardId/comments/:commentId',
    async (request, reply) => {
      try {
        // @ts-ignore - Fastify authenticate decorator
        await request.jwtVerify();
        const user = request.user as any;

        const userContext = await createEnhancedUserContextAsync(user, db);
        const { boardId, commentId } = request.params;
        const { content, evidenceRefs } = request.body;

        // Check EDITOR access
        const access = await checkBoardAccess(boardId, userContext, db, 'EDITOR');
        if (!access.hasAccess) {
          return reply.code(403).send({
            success: false,
            error: access.reason || 'Access denied',
          });
        }

        const commentsManager = documentManager.commentsManager;

        const updatedComment = await commentsManager.updateComment(
          commentId,
          userContext.userId,
          {
            content,
            evidenceRefs,
          }
        );

        if (!updatedComment) {
          return reply.code(404).send({
            success: false,
            error: 'Comment not found',
          });
        }

        // Broadcast comment event to connected clients
        wsServer.broadcastCommentEvent(boardId, {
          type: 'comment_update',
          commentId,
          entityId: updatedComment.attachedTo.entityId,
          entityType: updatedComment.attachedTo.type,
          authorId: userContext.userId,
          timestamp: updatedComment.updatedAt,
        });

        reply.send({
          success: true,
          data: { comment: updatedComment },
        });
      } catch (err: any) {
        if (err.message === 'Only comment author can update') {
          return reply.code(403).send({
            success: false,
            error: err.message,
          });
        }
        logger.error({ err }, 'Failed to update comment');
        reply.code(500).send({
          success: false,
          error: 'Internal server error',
        });
      }
    }
  );

  /**
   * Delete a comment
   */
  app.delete<{
    Params: BoardParams & { commentId: string };
  }>(
    '/api/collab/boards/:boardId/comments/:commentId',
    async (request, reply) => {
      try {
        // @ts-ignore - Fastify authenticate decorator
        await request.jwtVerify();
        const user = request.user as any;

        const userContext = await createEnhancedUserContextAsync(user, db);
        const { boardId, commentId } = request.params;

        // Check EDITOR access
        const access = await checkBoardAccess(boardId, userContext, db, 'EDITOR');
        if (!access.hasAccess) {
          return reply.code(403).send({
            success: false,
            error: access.reason || 'Access denied',
          });
        }

        const commentsManager = documentManager.commentsManager;

        const deleted = await commentsManager.deleteComment(commentId, userContext.userId);

        if (!deleted) {
          return reply.code(404).send({
            success: false,
            error: 'Comment not found',
          });
        }

        reply.send({
          success: true,
          data: { deleted: true },
        });
      } catch (err: any) {
        if (err.message === 'Only comment author can delete') {
          return reply.code(403).send({
            success: false,
            error: err.message,
          });
        }
        logger.error({ err }, 'Failed to delete comment');
        reply.code(500).send({
          success: false,
          error: 'Internal server error',
        });
      }
    }
  );

  /**
   * Resolve a comment
   */
  app.post<{
    Params: BoardParams & { commentId: string };
  }>(
    '/api/collab/boards/:boardId/comments/:commentId/resolve',
    async (request, reply) => {
      try {
        // @ts-ignore - Fastify authenticate decorator
        await request.jwtVerify();
        const user = request.user as any;

        const userContext = await createEnhancedUserContextAsync(user, db);
        const { boardId, commentId } = request.params;

        // Check EDITOR access
        const access = await checkBoardAccess(boardId, userContext, db, 'EDITOR');
        if (!access.hasAccess) {
          return reply.code(403).send({
            success: false,
            error: access.reason || 'Access denied',
          });
        }

        const commentsManager = documentManager.commentsManager;

        const resolvedComment = await commentsManager.resolveComment(
          commentId,
          userContext.userId
        );

        if (!resolvedComment) {
          return reply.code(404).send({
            success: false,
            error: 'Comment not found',
          });
        }

        // Broadcast comment event to connected clients
        wsServer.broadcastCommentEvent(boardId, {
          type: 'comment_resolve',
          commentId,
          entityId: resolvedComment.attachedTo.entityId,
          entityType: resolvedComment.attachedTo.type,
          authorId: userContext.userId,
          timestamp: resolvedComment.resolvedAt!,
        });

        reply.send({
          success: true,
          data: { comment: resolvedComment },
        });
      } catch (err) {
        logger.error({ err }, 'Failed to resolve comment');
        reply.code(500).send({
          success: false,
          error: 'Internal server error',
        });
      }
    }
  );

  /**
   * Unresolve a comment
   */
  app.post<{
    Params: BoardParams & { commentId: string };
  }>(
    '/api/collab/boards/:boardId/comments/:commentId/unresolve',
    async (request, reply) => {
      try {
        // @ts-ignore - Fastify authenticate decorator
        await request.jwtVerify();
        const user = request.user as any;

        const userContext = await createEnhancedUserContextAsync(user, db);
        const { boardId, commentId } = request.params;

        // Check EDITOR access
        const access = await checkBoardAccess(boardId, userContext, db, 'EDITOR');
        if (!access.hasAccess) {
          return reply.code(403).send({
            success: false,
            error: access.reason || 'Access denied',
          });
        }

        const commentsManager = documentManager.commentsManager;

        const unresolvedComment = await commentsManager.unresolveComment(
          commentId,
          userContext.userId
        );

        if (!unresolvedComment) {
          return reply.code(404).send({
            success: false,
            error: 'Comment not found',
          });
        }

        // Broadcast comment event to connected clients
        wsServer.broadcastCommentEvent(boardId, {
          type: 'comment_unresolve',
          commentId,
          entityId: unresolvedComment.attachedTo.entityId,
          entityType: unresolvedComment.attachedTo.type,
          authorId: userContext.userId,
          timestamp: unresolvedComment.updatedAt,
        });

        reply.send({
          success: true,
          data: { comment: unresolvedComment },
        });
      } catch (err) {
        logger.error({ err }, 'Failed to unresolve comment');
        reply.code(500).send({
          success: false,
          error: 'Internal server error',
        });
      }
    }
  );

  /**
   * Get comment statistics for a board
   */
  app.get<{
    Params: BoardParams;
  }>(
    '/api/collab/boards/:boardId/comments/stats',
    async (request, reply) => {
      try {
        // @ts-ignore - Fastify authenticate decorator
        await request.jwtVerify();
        const user = request.user as any;

        const userContext = await createEnhancedUserContextAsync(user, db);
        const { boardId } = request.params;

        // Check VIEWER access
        const access = await checkBoardAccess(boardId, userContext, db, 'VIEWER');
        if (!access.hasAccess) {
          return reply.code(403).send({
            success: false,
            error: access.reason || 'Access denied',
          });
        }

        const commentsManager = documentManager.commentsManager;

        const stats = await commentsManager.getCommentStats(boardId);

        reply.send({
          success: true,
          data: { stats },
        });
      } catch (err) {
        logger.error({ err }, 'Failed to get comment stats');
        reply.code(500).send({
          success: false,
          error: 'Internal server error',
        });
      }
    }
  );

  // ========== Visibility Routes (Phase 4 - Section H) ==========

  /**
   * Set element visibility
   * SECURITY: Strict rate limiting (20 req/min) to prevent abuse
   */
  app.post<{
    Params: BoardParams & { elementId: string };
    Body: {
      element_type: string;
      visibility_mode: 'public' | 'confidential';
      viewer_whitelist?: string[];
      viewer_roles?: string[];
      rationale?: string;
    };
  }>(
    '/api/collab/boards/:boardId/elements/:elementId/visibility',
    {
      preHandler: strictRateLimiter.middleware(),
    },
    async (request, reply) => {
      try {
        // @ts-ignore - Fastify authenticate decorator
        await request.jwtVerify();
        const user = request.user as any;

        const userContext = await createEnhancedUserContextAsync(user, db);
        const { boardId, elementId } = request.params;
        const { element_type, visibility_mode, viewer_whitelist, viewer_roles, rationale } =
          request.body;

        // Check EDITOR access (only editors/owners can set visibility)
        const access = await checkBoardAccess(boardId, userContext, db, 'EDITOR');
        if (!access.hasAccess) {
          return reply.code(403).send({
            success: false,
            error: access.reason || 'Access denied',
          });
        }

        const visibilityManager = documentManager.visibilityManager;

        // SECURITY FIX: Use orgId/teamId from database (access.orgId/teamId), not from client
        const visibility = await visibilityManager.setElementVisibility(
          boardId,
          access.orgId!,     // From database, not from client
          access.teamId!,    // From database, not from client
          user.userId,
          access.role!,
          {
            elementId,
            elementType: element_type as any,
            visibilityMode: visibility_mode,
            viewerWhitelist: viewer_whitelist,
            viewerRoles: viewer_roles,
            rationale,
          }
        );

        // Broadcast visibility change event
        wsServer.broadcastToBoard(boardId, {
          type: 'visibility-changed',
          elementId,
          visibilityMode: visibility_mode,
        });

        reply.send({
          success: true,
          data: { visibility },
        });
      } catch (err: any) {
        logger.error({ err }, 'Failed to set element visibility');
        reply.code(err.message.includes('Only') ? 403 : 500).send({
          success: false,
          error: err.message || 'Internal server error',
        });
      }
    }
  );

  /**
   * Get element visibility
   */
  app.get<{
    Params: BoardParams & { elementId: string };
  }>(
    '/api/collab/boards/:boardId/elements/:elementId/visibility',
    async (request, reply) => {
      try {
        // @ts-ignore - Fastify authenticate decorator
        await request.jwtVerify();
        const user = request.user as any;

        const userContext = await createEnhancedUserContextAsync(user, db);
        const { boardId, elementId } = request.params;

        // Check VIEWER access
        const access = await checkBoardAccess(boardId, userContext, db, 'VIEWER');
        if (!access.hasAccess) {
          return reply.code(403).send({
            success: false,
            error: access.reason || 'Access denied',
          });
        }

        const visibilityManager = documentManager.visibilityManager;

        const visibility = await visibilityManager.getElementVisibility(boardId, elementId);

        reply.send({
          success: true,
          data: { visibility },
        });
      } catch (err) {
        logger.error({ err }, 'Failed to get element visibility');
        reply.code(500).send({
          success: false,
          error: 'Internal server error',
        });
      }
    }
  );

  /**
   * Check if user can view element
   */
  app.get<{
    Params: BoardParams & { elementId: string };
  }>(
    '/api/collab/boards/:boardId/elements/:elementId/visibility/check',
    async (request, reply) => {
      try {
        // @ts-ignore - Fastify authenticate decorator
        await request.jwtVerify();
        const user = request.user as any;

        const userContext = await createEnhancedUserContextAsync(user, db);
        const { boardId, elementId } = request.params;

        // Check VIEWER access
        const access = await checkBoardAccess(boardId, userContext, db, 'VIEWER');
        if (!access.hasAccess) {
          return reply.code(403).send({
            success: false,
            error: access.reason || 'Access denied',
          });
        }

        const visibilityManager = documentManager.visibilityManager;

        const checkResult = await visibilityManager.canViewElement(
          boardId,
          elementId,
          user.userId,
          access.role!
        );

        reply.send({
          success: true,
          data: checkResult,
        });
      } catch (err) {
        logger.error({ err }, 'Failed to check element visibility');
        reply.code(500).send({
          success: false,
          error: 'Internal server error',
        });
      }
    }
  );

  /**
   * Get all visibility records for a board
   */
  app.get<{
    Params: BoardParams;
  }>(
    '/api/collab/boards/:boardId/visibility',
    async (request, reply) => {
      try {
        // @ts-ignore - Fastify authenticate decorator
        await request.jwtVerify();
        const user = request.user as any;

        const userContext = await createEnhancedUserContextAsync(user, db);
        const { boardId } = request.params;

        // Check VIEWER access
        const access = await checkBoardAccess(boardId, userContext, db, 'VIEWER');
        if (!access.hasAccess) {
          return reply.code(403).send({
            success: false,
            error: access.reason || 'Access denied',
          });
        }

        const visibilityManager = documentManager.visibilityManager;

        const records = await visibilityManager.getBoardVisibility(boardId);

        reply.send({
          success: true,
          data: { records },
        });
      } catch (err) {
        logger.error({ err }, 'Failed to get board visibility');
        reply.code(500).send({
          success: false,
          error: 'Internal server error',
        });
      }
    }
  );

  /**
   * Get confidential elements for a board
   */
  app.get<{
    Params: BoardParams;
  }>(
    '/api/collab/boards/:boardId/visibility/confidential',
    async (request, reply) => {
      try {
        // @ts-ignore - Fastify authenticate decorator
        await request.jwtVerify();
        const user = request.user as any;

        const userContext = await createEnhancedUserContextAsync(user, db);
        const { boardId } = request.params;

        // Check EDITOR access (only editors/owners can see list of confidential elements)
        const access = await checkBoardAccess(boardId, userContext, db, 'EDITOR');
        if (!access.hasAccess) {
          return reply.code(403).send({
            success: false,
            error: access.reason || 'Access denied',
          });
        }

        const visibilityManager = documentManager.visibilityManager;

        const confidential = await visibilityManager.getConfidentialElements(boardId);

        reply.send({
          success: true,
          data: { confidential },
        });
      } catch (err) {
        logger.error({ err }, 'Failed to get confidential elements');
        reply.code(500).send({
          success: false,
          error: 'Internal server error',
        });
      }
    }
  );

  /**
   * Set visibility policy for a board
   * SECURITY: Strict rate limiting (20 req/min) - policy changes are sensitive
   */
  app.post<{
    Params: BoardParams;
    Body: {
      default_visibility: 'public' | 'confidential';
      allow_viewer_whitelist: boolean;
      require_owner_for_confidential: boolean;
    };
  }>(
    '/api/collab/boards/:boardId/visibility/policy',
    {
      preHandler: strictRateLimiter.middleware(),
    },
    async (request, reply) => {
      try {
        // @ts-ignore - Fastify authenticate decorator
        await request.jwtVerify();
        const user = request.user as any;

        const userContext = await createEnhancedUserContextAsync(user, db);
        const { boardId } = request.params;
        const { default_visibility, allow_viewer_whitelist, require_owner_for_confidential } =
          request.body;

        // Check OWNER access (only owners can set policy)
        const access = await checkBoardAccess(boardId, userContext, db, 'OWNER');
        if (!access.hasAccess) {
          return reply.code(403).send({
            success: false,
            error: 'Only board owners can set visibility policy',
          });
        }

        const visibilityManager = documentManager.visibilityManager;

        // SECURITY FIX: Use orgId/teamId from database (access.orgId/teamId), not from client
        const policy = await visibilityManager.setVisibilityPolicy(
          boardId,
          access.orgId!,     // From database, not from client
          access.teamId!,    // From database, not from client
          user.userId,
          access.role!,
          {
            default_visibility,
            allow_viewer_whitelist,
            require_owner_for_confidential,
          }
        );

        reply.send({
          success: true,
          data: { policy },
        });
      } catch (err: any) {
        logger.error({ err }, 'Failed to set visibility policy');
        reply.code(err.message.includes('Only') ? 403 : 500).send({
          success: false,
          error: err.message || 'Internal server error',
        });
      }
    }
  );

  /**
   * Get visibility policy for a board
   */
  app.get<{
    Params: BoardParams;
  }>(
    '/api/collab/boards/:boardId/visibility/policy',
    async (request, reply) => {
      try {
        // @ts-ignore - Fastify authenticate decorator
        await request.jwtVerify();
        const user = request.user as any;

        const userContext = await createEnhancedUserContextAsync(user, db);
        const { boardId } = request.params;

        // Check VIEWER access
        const access = await checkBoardAccess(boardId, userContext, db, 'VIEWER');
        if (!access.hasAccess) {
          return reply.code(403).send({
            success: false,
            error: access.reason || 'Access denied',
          });
        }

        const visibilityManager = documentManager.visibilityManager;

        const policy = await visibilityManager.getVisibilityPolicy(boardId);

        reply.send({
          success: true,
          data: { policy },
        });
      } catch (err) {
        logger.error({ err }, 'Failed to get visibility policy');
        reply.code(500).send({
          success: false,
          error: 'Internal server error',
        });
      }
    }
  );

  /**
   * Get visibility change history
   */
  app.get<{
    Params: BoardParams;
    Querystring: {
      elementId?: string;
    };
  }>(
    '/api/collab/boards/:boardId/visibility/history',
    async (request, reply) => {
      try {
        // @ts-ignore - Fastify authenticate decorator
        await request.jwtVerify();
        const user = request.user as any;

        const userContext = await createEnhancedUserContextAsync(user, db);
        const { boardId } = request.params;
        const { elementId } = request.query;

        // Check VIEWER access
        const access = await checkBoardAccess(boardId, userContext, db, 'VIEWER');
        if (!access.hasAccess) {
          return reply.code(403).send({
            success: false,
            error: access.reason || 'Access denied',
          });
        }

        const visibilityManager = documentManager.visibilityManager;

        const history = await visibilityManager.getVisibilityHistory(boardId, elementId);

        reply.send({
          success: true,
          data: { history },
        });
      } catch (err) {
        logger.error({ err }, 'Failed to get visibility history');
        reply.code(500).send({
          success: false,
          error: 'Internal server error',
        });
      }
    }
  );

  /**
   * Get visibility statistics for a board
   */
  app.get<{
    Params: BoardParams;
  }>(
    '/api/collab/boards/:boardId/visibility/stats',
    async (request, reply) => {
      try {
        // @ts-ignore - Fastify authenticate decorator
        await request.jwtVerify();
        const user = request.user as any;

        const userContext = await createEnhancedUserContextAsync(user, db);
        const { boardId } = request.params;

        // Check VIEWER access
        const access = await checkBoardAccess(boardId, userContext, db, 'VIEWER');
        if (!access.hasAccess) {
          return reply.code(403).send({
            success: false,
            error: access.reason || 'Access denied',
          });
        }

        const visibilityManager = documentManager.visibilityManager;

        const stats = await visibilityManager.getVisibilityStats(boardId);

        reply.send({
          success: true,
          data: { stats },
        });
      } catch (err) {
        logger.error({ err }, 'Failed to get visibility stats');
        reply.code(500).send({
          success: false,
          error: 'Internal server error',
        });
      }
    }
  );

  // Access request routes (Phase 4 - Section H.5)
  await registerAccessRequestRoutes(app, documentManager, db);

  logger.info('Routes registered');
}
