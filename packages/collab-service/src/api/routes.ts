/**
 * REST API routes
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { DocumentManager } from '../collab/document-manager';
import { CollaborationWebSocketServer } from '../collab/websocket-server';
import { DatabaseClient } from '../database/client';
import { transformToRunInput } from '../types/board';
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

        if (board.orgId !== user.orgId) {
          return reply.code(403).send({
            success: false,
            error: 'Access denied',
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

        if (board.orgId !== user.orgId) {
          return reply.code(403).send({
            success: false,
            error: 'Access denied',
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

        if (board.orgId !== user.orgId) {
          return reply.code(403).send({
            success: false,
            error: 'Access denied',
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

        if (board.orgId !== user.orgId) {
          return reply.code(403).send({
            success: false,
            error: 'Access denied',
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
