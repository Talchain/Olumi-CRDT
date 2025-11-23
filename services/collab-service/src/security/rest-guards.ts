/**
 * REST API Security Guards
 * Middleware to enforce element-level access control on REST endpoints
 */

import { FastifyRequest, FastifyReply } from 'fastify';
import { pino } from 'pino';
import { VisibilityManager } from '../visibility/visibility-manager';
import { SecurityAuditLogger } from '../audit/security-audit-logger';
import { createEnhancedUserContextAsync } from '../auth/authorization';
import { DatabaseClient } from '../database/client';

const logger = pino();

export class RestGuards {
  constructor(
    private visibilityManager: VisibilityManager,
    private auditLogger: SecurityAuditLogger,
    private db: DatabaseClient
  ) {}

  /**
   * Require element access middleware
   * Blocks request if user doesn't have access to element
   */
  requireElementAccess() {
    return async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        // @ts-ignore - Fastify user object
        const user = request.user as any;
        const userContext = await createEnhancedUserContextAsync(user, this.db);

        // Extract element ID and board ID from params
        const params = request.params as any;
        const { elementId, boardId } = params;

        if (!elementId || !boardId) {
          return reply.code(400).send({
            success: false,
            error: 'Missing elementId or boardId in request',
          });
        }

        // Check if user can view element
        const result = await this.visibilityManager.canViewElement(
          boardId,
          elementId,
          userContext.userId,
          userContext.role || 'VIEWER'
        );

        if (!result.can_view) {
          // Log unauthorized access attempt
          await this.auditLogger.log({
            event_type: 'UNAUTHORIZED_REST_ACCESS',
            actor_user_id: userContext.userId,
            board_id: boardId,
            element_id: elementId,
            metadata: {
              method: request.method,
              path: request.url,
              reason: result.reason,
              ip_address: request.ip,
              user_agent: request.headers['user-agent'],
            },
          });

          logger.warn(
            {
              userId: userContext.userId,
              boardId,
              elementId,
              method: request.method,
              path: request.url,
              reason: result.reason,
            },
            'Blocked unauthorized REST access'
          );

          return reply.code(403).send({
            success: false,
            error: 'FORBIDDEN',
            message: 'You do not have access to this element',
          });
        }

        // Access granted, proceed
        logger.debug(
          {
            userId: userContext.userId,
            boardId,
            elementId,
            method: request.method,
          },
          'Element access granted'
        );
      } catch (err) {
        logger.error({ err }, 'Error in requireElementAccess middleware');
        return reply.code(500).send({
          success: false,
          error: 'Internal server error',
        });
      }
    };
  }

  /**
   * Require board owner middleware
   * Only allows board owners to proceed
   */
  requireBoardOwner() {
    return async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        // @ts-ignore
        const user = request.user as any;
        const userContext = await createEnhancedUserContextAsync(user, this.db);

        const params = request.params as any;
        const { boardId } = params;

        if (!boardId) {
          return reply.code(400).send({
            success: false,
            error: 'Missing boardId in request',
          });
        }

        // Get board and check ownership
        const board = await this.db.getBoard(boardId);
        if (!board) {
          return reply.code(404).send({
            success: false,
            error: 'Board not found',
          });
        }

        if (board.ownerId !== userContext.userId) {
          await this.auditLogger.log({
            event_type: 'UNAUTHORIZED_OWNER_ACCESS',
            actor_user_id: userContext.userId,
            board_id: boardId,
            metadata: {
              method: request.method,
              path: request.url,
              actual_owner: board.ownerId,
            },
          });

          return reply.code(403).send({
            success: false,
            error: 'FORBIDDEN',
            message: 'Only board owner can perform this action',
          });
        }
      } catch (err) {
        logger.error({ err }, 'Error in requireBoardOwner middleware');
        return reply.code(500).send({
          success: false,
          error: 'Internal server error',
        });
      }
    };
  }

  /**
   * Rate limit middleware with timing attack resistance
   * All responses take similar time regardless of whether limit is hit
   */
  rateLimitWithTimingResistance(maxRequests: number, windowMs: number) {
    const requestCounts = new Map<string, RequestWindow>();

    return async (request: FastifyRequest, reply: FastifyReply) => {
      const startTime = Date.now();
      const minResponseTime = 10; // Minimum 10ms response time

      try {
        // @ts-ignore
        const user = request.user as any;
        const userContext = await createEnhancedUserContextAsync(user, this.db);

        const key = `${userContext.userId}:${request.url}`;
        const now = Date.now();

        // Clean up old entries
        if (requestCounts.size > 10000) {
          const cutoff = now - windowMs;
          for (const [k, v] of requestCounts.entries()) {
            if (v.windowStart < cutoff) {
              requestCounts.delete(k);
            }
          }
        }

        // Get or create window
        let window = requestCounts.get(key);
        if (!window || now - window.windowStart > windowMs) {
          window = {
            count: 0,
            windowStart: now,
          };
          requestCounts.set(key, window);
        }

        // Increment count
        window.count++;

        const isRateLimited = window.count > maxRequests;

        // Ensure minimum response time for timing attack resistance
        const elapsed = Date.now() - startTime;
        if (elapsed < minResponseTime) {
          await new Promise((resolve) => setTimeout(resolve, minResponseTime - elapsed));
        }

        if (isRateLimited) {
          await this.auditLogger.log({
            event_type: 'RATE_LIMIT_EXCEEDED',
            actor_user_id: userContext.userId,
            metadata: {
              path: request.url,
              count: window.count,
              max: maxRequests,
              window_ms: windowMs,
            },
          });

          return reply.code(429).send({
            success: false,
            error: 'RATE_LIMIT_EXCEEDED',
            message: 'Too many requests',
            retry_after: Math.ceil((windowMs - (now - window.windowStart)) / 1000),
          });
        }
      } catch (err) {
        logger.error({ err }, 'Error in rate limit middleware');
        // On error, allow request (fail open for rate limiting)
      }
    };
  }
}

interface RequestWindow {
  count: number;
  windowStart: number;
}

/**
 * Create REST guards instance
 */
export function createRestGuards(
  visibilityManager: VisibilityManager,
  auditLogger: SecurityAuditLogger,
  db: DatabaseClient
): RestGuards {
  return new RestGuards(visibilityManager, auditLogger, db);
}
