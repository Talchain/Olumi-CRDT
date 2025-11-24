/**
 * Review Expiration Job Handler
 * Runs periodically to mark expired reviews
 */

import { DatabaseClient } from '../database/client';
import { EventBusClient } from '../events/event-bus-client';
import { pino } from 'pino';
import { config } from '../config';

const logger = pino({ level: config.logging.level });

export interface ReviewExpirationJobResult {
  expired_count: number;
  review_ids: string[];
  errors: Array<{ review_id: string; error: string }>;
}

/**
 * Handle review expiration
 * Called by job scheduler (hourly)
 */
export async function handleReviewExpiration(
  db: DatabaseClient,
  eventBus: EventBusClient
): Promise<ReviewExpirationJobResult> {
  const startTime = Date.now();
  logger.info('Starting review expiration job');

  const result: ReviewExpirationJobResult = {
    expired_count: 0,
    review_ids: [],
    errors: [],
  };

  try {
    // Find all expired reviews
    const expiredReviews = await db.reviewMethods.findExpiredReviews();

    logger.info(
      { expiredCount: expiredReviews.length },
      'Found expired reviews'
    );

    for (const review of expiredReviews) {
      try {
        // Mark review as expired
        await db.reviewMethods.markReviewExpired(review.review_id);

        // Publish event
        await eventBus.publish({
          event_type: 'VISIBILITY_CHANGE' as any, // TODO: Add REVIEW_EXPIRED to event types
          board_id: review.board_id,
          metadata: {
            review_id: review.review_id,
            snapshot_id: review.snapshot_id,
            requested_by: review.requested_by_user_id,
            due_date: review.due_date,
            event_subtype: 'REVIEW_EXPIRED',
          },
        });

        result.expired_count++;
        result.review_ids.push(review.review_id);

        logger.debug(
          { reviewId: review.review_id },
          'Review marked as expired'
        );
      } catch (error) {
        logger.error(
          { err: error, reviewId: review.review_id },
          'Failed to expire review'
        );

        result.errors.push({
          review_id: review.review_id,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    const duration = Date.now() - startTime;

    logger.info(
      {
        expiredCount: result.expired_count,
        errorCount: result.errors.length,
        duration,
      },
      'Review expiration job complete'
    );

    return result;
  } catch (error) {
    logger.error({ err: error }, 'Review expiration job failed');
    throw error;
  }
}
