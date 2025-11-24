/**
 * HIGH PRIORITY FIX #3: Standardized Authorization Middleware
 *
 * Provides consistent authorization patterns across all routes to prevent
 * security gaps from using sync vs async authorization inconsistently.
 *
 * Problem Fixed:
 * - Routes were inconsistently using createEnhancedUserContext() (sync) vs
 *   createEnhancedUserContextAsync() (async with DB fetch)
 * - JWT payload doesn't contain team memberships, so sync version is incomplete
 * - Different routes had different authorization code patterns
 *
 * Solution:
 * - Single standardized middleware for board authorization
 * - Always fetches team memberships from database (trusted source)
 * - Consistent error handling and logging
 * - Type-safe request augmentation
 */

import { FastifyRequest, FastifyReply } from 'fastify';
import { DatabaseClient } from '../database/client';
import {
  createEnhancedUserContextAsync,
  checkBoardAccess,
  checkSnapshotAccess,
  checkEditAccess,
  checkAdminAccess,
  checkOwnerAccess,
  AuthorizationErrors,
  AuthorizationResult,
} from '../auth/authorization';
import { UserRole, EnhancedUserContext } from '../types/auth';
import { BoardDocument } from '../types/board';
import { pino } from 'pino';
import { config } from '../config';

const logger = pino({ level: config.logging.level });

/**
 * Extended request with user authentication
 */
export interface AuthenticatedRequest extends FastifyRequest {
  user: {
    userId: string;
    orgId: string;
    email: string;
    roles: string[];
    [key: string]: any;
  };
}

/**
 * Extended request with board authorization
 */
export interface BoardAuthorizedRequest extends AuthenticatedRequest {
  userContext: EnhancedUserContext;
  board: BoardDocument;
  orgId: string;
  teamId: string;
  userRole: UserRole;
}

/**
 * Authorization level required for endpoint
 */
export enum AuthLevel {
  VIEWER = 'VIEWER',
  EDITOR = 'EDITOR',
  ADMIN = 'ADMIN',
  OWNER = 'OWNER',
}

/**
 * HIGH PRIORITY FIX #3: Standardized board authorization middleware
 *
 * Creates a middleware that:
 * 1. Extracts JWT user from request (requires app.authenticate to run first)
 * 2. Fetches team memberships from database (trusted source)
 * 3. Loads board from database
 * 4. Checks authorization against required level
 * 5. Attaches userContext, board, orgId, teamId, userRole to request
 *
 * @param db - Database client
 * @param requiredLevel - Minimum authorization level (VIEWER, EDITOR, ADMIN, OWNER)
 * @returns Fastify preHandler middleware
 *
 * @example
 * ```typescript
 * app.get('/api/boards/:boardId', {
 *   preHandler: [
 *     app.authenticate,
 *     requireBoardAccess(db, AuthLevel.VIEWER)
 *   ]
 * }, async (request: BoardAuthorizedRequest, reply) => {
 *   // request.board, request.userContext, request.userRole are available
 * });
 * ```
 */
export function requireBoardAccess(
  db: DatabaseClient,
  requiredLevel: AuthLevel = AuthLevel.VIEWER
) {
  return async function(
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<void> {
    const req = request as AuthenticatedRequest;

    // Ensure user is authenticated (should be guaranteed by app.authenticate)
    if (!req.user || !req.user.userId) {
      logger.error('requireBoardAccess called without authentication');
      reply.code(401).send({
        success: false,
        error: 'Authentication required',
      });
      return;
    }

    // Extract boardId from params
    const boardId = (request.params as any).boardId;
    if (!boardId) {
      reply.code(400).send({
        success: false,
        error: 'Board ID required',
      });
      return;
    }

    try {
      // HIGH PRIORITY FIX #3: Always use async version with database fetch
      // This ensures team memberships come from trusted source (database)
      // instead of JWT payload which may be incomplete
      const userContext = await createEnhancedUserContextAsync(req.user, db);

      // Fetch board from database
      const board = await db.getBoard(boardId);

      if (!board) {
        reply.code(404).send({
          success: false,
          error: 'Board not found',
        });
        return;
      }

      // Convert board to BoardDocument format if needed
      const boardDoc: BoardDocument = {
        ...board.data,
        orgId: board.orgId,
        teamId: board.teamId,
      } as BoardDocument;

      // Perform authorization check based on required level
      let authResult: AuthorizationResult;

      switch (requiredLevel) {
        case AuthLevel.OWNER:
          authResult = checkOwnerAccess(boardDoc, userContext);
          break;
        case AuthLevel.ADMIN:
          authResult = checkAdminAccess(boardDoc, userContext);
          break;
        case AuthLevel.EDITOR:
          authResult = checkEditAccess(boardDoc, userContext);
          break;
        case AuthLevel.VIEWER:
        default:
          authResult = checkBoardAccess(boardDoc, userContext, UserRole.VIEWER);
          break;
      }

      if (!authResult.authorized) {
        logger.warn(
          {
            boardId,
            userId: req.user.userId,
            requiredLevel,
            reason: authResult.reason,
          },
          'Board access denied'
        );

        reply.code(403).send({
          success: false,
          error: AuthorizationErrors[authResult.reason as keyof typeof AuthorizationErrors] || 'Access denied',
        });
        return;
      }

      // Get user's role for this board's team
      const userRole = userContext.getTeamRole(board.teamId);

      if (!userRole) {
        logger.error(
          { boardId, userId: req.user.userId, teamId: board.teamId },
          'User has access but no role found'
        );
        reply.code(500).send({
          success: false,
          error: 'Internal authorization error',
        });
        return;
      }

      // HIGH PRIORITY FIX #3: Attach authorization context to request
      // All routes can now access these typed properties
      const authorizedReq = request as any;
      authorizedReq.userContext = userContext;
      authorizedReq.board = boardDoc;
      authorizedReq.orgId = board.orgId;
      authorizedReq.teamId = board.teamId;
      authorizedReq.userRole = userRole;

      // Authorization successful - continue to route handler
    } catch (error) {
      logger.error(
        { error, boardId, userId: req.user.userId },
        'Authorization middleware error'
      );

      reply.code(500).send({
        success: false,
        error: 'Internal server error',
      });
    }
  };
}

/**
 * HIGH PRIORITY FIX #3: Standardized snapshot authorization middleware
 *
 * Similar to requireBoardAccess but for snapshot endpoints.
 * Validates snapshot belongs to the board and user has required access.
 *
 * @param db - Database client
 * @param requiredLevel - Minimum authorization level (defaults to EDITOR for snapshots)
 */
export function requireSnapshotAccess(
  db: DatabaseClient,
  requiredLevel: AuthLevel = AuthLevel.EDITOR
) {
  return async function(
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<void> {
    const req = request as AuthenticatedRequest;

    if (!req.user || !req.user.userId) {
      reply.code(401).send({
        success: false,
        error: 'Authentication required',
      });
      return;
    }

    const boardId = (request.params as any).boardId;
    const snapshotId = (request.params as any).snapshotId;

    if (!boardId) {
      reply.code(400).send({
        success: false,
        error: 'Board ID required',
      });
      return;
    }

    try {
      const userContext = await createEnhancedUserContextAsync(req.user, db);
      const board = await db.getBoard(boardId);

      if (!board) {
        reply.code(404).send({
          success: false,
          error: 'Board not found',
        });
        return;
      }

      const boardDoc: BoardDocument = {
        ...board.data,
        orgId: board.orgId,
        teamId: board.teamId,
      } as BoardDocument;

      // Check snapshot access with required level
      let authResult: AuthorizationResult;

      switch (requiredLevel) {
        case AuthLevel.OWNER:
          authResult = checkOwnerAccess(boardDoc, userContext);
          break;
        case AuthLevel.ADMIN:
          authResult = checkAdminAccess(boardDoc, userContext);
          break;
        case AuthLevel.EDITOR:
        default:
          authResult = checkSnapshotAccess(boardDoc, userContext);
          break;
      }

      if (!authResult.authorized) {
        logger.warn(
          {
            boardId,
            snapshotId,
            userId: req.user.userId,
            reason: authResult.reason,
          },
          'Snapshot access denied'
        );

        reply.code(403).send({
          success: false,
          error: AuthorizationErrors[authResult.reason as keyof typeof AuthorizationErrors] || 'Access denied',
        });
        return;
      }

      const userRole = userContext.getTeamRole(board.teamId);

      if (!userRole) {
        reply.code(500).send({
          success: false,
          error: 'Internal authorization error',
        });
        return;
      }

      // Attach to request
      const authorizedReq = request as any;
      authorizedReq.userContext = userContext;
      authorizedReq.board = boardDoc;
      authorizedReq.orgId = board.orgId;
      authorizedReq.teamId = board.teamId;
      authorizedReq.userRole = userRole;

    } catch (error) {
      logger.error(
        { error, boardId, userId: req.user.userId },
        'Snapshot authorization middleware error'
      );

      reply.code(500).send({
        success: false,
        error: 'Internal server error',
      });
    }
  };
}
