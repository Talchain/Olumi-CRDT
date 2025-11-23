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
  checkBoardAccess,
  checkSnapshotAccess,
  AuthorizationErrors,
} from '../auth/authorization';
import { pino } from 'pino';
import { config } from '../config';

const logger = pino({ level: config.logging.level });

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

  logger.info('Routes registered');
}
