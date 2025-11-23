/**
 * Access Expiration Job Handler
 * Integrates with Job Scheduler service to expire access requests
 */

import { pino } from 'pino';
import { DatabaseClient } from '../database/client';
import { VisibilityManager } from '../visibility/visibility-manager';
import { EventBusClient } from '../events/event-bus-client';
import { UserRole } from '../types/auth';
import type { AccessRequestExpiredEvent } from '@olumi/contracts';
import { randomUUID } from 'crypto';

const logger = pino();

export interface AccessExpirationJobResult {
  expired_count: number;
  errors: number;
  expired_request_ids: string[];
}

/**
 * Handle access expiration job
 * Called by Job Scheduler service every hour
 */
export async function handleAccessExpiration(
  db: DatabaseClient,
  visibilityManager: VisibilityManager,
  eventBus: EventBusClient
): Promise<AccessExpirationJobResult> {
  const startTime = Date.now();
  const result: AccessExpirationJobResult = {
    expired_count: 0,
    errors: 0,
    expired_request_ids: [],
  };

  try {
    logger.info('Starting access expiration job');

    // Find expired access requests
    const expired = await db.accessRequestsMethods.findExpiredRequests();

    logger.info({ count: expired.length }, 'Found expired access requests');

    // Process each expired request
    for (const request of expired) {
      try {
        // Remove from whitelist
        const visibility = await visibilityManager.getElementVisibility(
          request.board_id,
          request.element_id
        );

        if (visibility && visibility.viewer_whitelist) {
          const updatedWhitelist = visibility.viewer_whitelist.filter(
            (userId) => userId !== request.requester_user_id
          );

          // Only update if user was actually in whitelist
          if (updatedWhitelist.length < visibility.viewer_whitelist.length) {
            await visibilityManager.setElementVisibility(
              request.board_id,
              'system', // orgId - use system for automated actions
              'system', // teamId
              'system', // userId - automated job
              UserRole.ADMIN, // role
              {
                elementId: request.element_id,
                elementType: visibility.element_type,
                visibilityMode: visibility.visibility_mode,
                viewerWhitelist: updatedWhitelist,
                viewerRoles: visibility.viewer_roles,
                rationale: `Access expired for request ${request.request_id}`,
              }
            );

            logger.debug(
              {
                requestId: request.request_id,
                elementId: request.element_id,
                userId: request.requester_user_id,
              },
              'Removed user from whitelist'
            );
          }
        }

        // Mark request as expired
        await db.accessRequestsMethods.markAsExpired(request.request_id);

        // Publish event to Event Bus
        const event: AccessRequestExpiredEvent = {
          event_id: randomUUID(),
          event_type: 'ACCESS_REQUEST_EXPIRED',
          timestamp: new Date().toISOString(),
          source_service: 'collab-service',
          request_id: request.request_id,
          board_id: request.board_id,
          element_id: request.element_id,
          requester_id: request.requester_user_id,
          requester_email: request.requester_user_id, // TODO: Get actual email from users table
          expired_at: new Date().toISOString(),
        };

        await eventBus.publish(event);

        result.expired_count++;
        result.expired_request_ids.push(request.request_id);

        logger.info(
          {
            requestId: request.request_id,
            requesterId: request.requester_user_id,
            elementId: request.element_id,
          },
          'Access request expired successfully'
        );
      } catch (err) {
        logger.error(
          { err, requestId: request.request_id },
          'Failed to expire access request'
        );
        result.errors++;
      }
    }

    const duration = Date.now() - startTime;
    logger.info(
      {
        expired_count: result.expired_count,
        errors: result.errors,
        duration_ms: duration,
      },
      'Access expiration job completed'
    );

    return result;
  } catch (err) {
    logger.error({ err }, 'Access expiration job failed');
    throw err;
  }
}

/**
 * Endpoint for Job Scheduler to call
 * POST /jobs/expire-access-requests
 */
export async function expireAccessRequestsEndpoint(
  db: DatabaseClient,
  visibilityManager: VisibilityManager,
  eventBus: EventBusClient
) {
  return async (_request: any, reply: any) => {
    try {
      const result = await handleAccessExpiration(db, visibilityManager, eventBus);

      reply.send({
        success: true,
        data: result,
      });
    } catch (err: any) {
      logger.error({ err }, 'Access expiration endpoint failed');
      reply.code(500).send({
        success: false,
        error: err.message || 'Internal server error',
      });
    }
  };
}
