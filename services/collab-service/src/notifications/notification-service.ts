/**
 * Notification service implementation
 *
 * NOTE: This is a simple in-memory implementation for Phase 4.
 * For production, replace with:
 * - Redis queue (Bull/BullMQ)
 * - AWS SQS/SNS
 * - RabbitMQ
 * - Apache Kafka
 *
 * Current implementation provides:
 * - In-memory queue for notifications
 * - Basic delivery tracking
 * - WebSocket broadcast support (future)
 * - Email/SMS integration points (stubs)
 */

import { v4 as uuidv4 } from 'uuid';
import { pino } from 'pino';
import { config } from '../config';
import {
  INotificationService,
  AccessNotification,
  NotificationType,
} from './notification-types';

const logger = pino({ level: config.logging.level });

export class InMemoryNotificationService implements INotificationService {
  private queue: Map<string, AccessNotification> = new Map();
  private delivered: Set<string> = new Set();
  private failed: Map<string, { notification: AccessNotification; error: string }> = new Map();
  private deliveredCount = 0;
  private failedCount = 0;

  /**
   * Queue a notification for delivery
   */
  async queueNotification(notification: AccessNotification): Promise<void> {
    this.queue.set(notification.notification_id, notification);

    logger.info(
      {
        notificationId: notification.notification_id,
        type: notification.type,
        recipientUserId: notification.recipient_user_id,
        priority: notification.priority,
      },
      'Notification queued'
    );

    // Attempt immediate delivery (in production, this would be async worker)
    setImmediate(() => {
      this.processNotification(notification).catch((err) => {
        logger.error(
          { err, notificationId: notification.notification_id },
          'Failed to process notification'
        );
      });
    });
  }

  /**
   * Process and deliver a notification
   */
  private async processNotification(notification: AccessNotification): Promise<void> {
    try {
      // TODO: Implement actual delivery mechanisms
      // - WebSocket broadcast to connected users
      // - Email via SendGrid/AWS SES
      // - SMS via Twilio
      // - Push notifications via Firebase/APNs

      logger.debug(
        {
          notificationId: notification.notification_id,
          type: notification.type,
          recipientUserId: notification.recipient_user_id,
        },
        'Processing notification (stub)'
      );

      // Stub: Mark as delivered
      await this.markAsDelivered(notification.notification_id);

      // Remove from queue
      this.queue.delete(notification.notification_id);
      this.deliveredCount++;
    } catch (err: any) {
      logger.error({ err, notificationId: notification.notification_id }, 'Notification delivery failed');
      this.failed.set(notification.notification_id, {
        notification,
        error: err.message || 'Unknown error',
      });
      this.failedCount++;
    }
  }

  /**
   * Get pending notifications for a user
   */
  async getPendingNotifications(userId: string): Promise<AccessNotification[]> {
    const pending: AccessNotification[] = [];

    for (const notification of this.queue.values()) {
      if (notification.recipient_user_id === userId && !this.delivered.has(notification.notification_id)) {
        pending.push(notification);
      }
    }

    return pending;
  }

  /**
   * Mark notification as read/delivered
   */
  async markAsDelivered(notificationId: string): Promise<void> {
    this.delivered.add(notificationId);
    logger.debug({ notificationId }, 'Notification marked as delivered');
  }

  /**
   * Get service health/stats
   */
  getStats(): {
    queueSize: number;
    deliveredCount: number;
    failedCount: number;
  } {
    return {
      queueSize: this.queue.size,
      deliveredCount: this.deliveredCount,
      failedCount: this.failedCount,
    };
  }

  /**
   * Clear all data (for testing)
   */
  clear(): void {
    this.queue.clear();
    this.delivered.clear();
    this.failed.clear();
    this.deliveredCount = 0;
    this.failedCount = 0;
  }
}

/**
 * Helper functions to create notifications
 */

export function createAccessRequestNotification(params: {
  requestId: string;
  boardId: string;
  elementId: string;
  requesterUserId: string;
  requesterName?: string;
  rationale?: string;
  recipientUserId: string;
}): AccessNotification {
  return {
    notification_id: uuidv4(),
    type: 'access_request_created',
    recipient_user_id: params.recipientUserId,
    created_at: new Date().toISOString(),
    priority: 'normal',
    data: {
      request_id: params.requestId,
      board_id: params.boardId,
      element_id: params.elementId,
      requester_user_id: params.requesterUserId,
      requester_name: params.requesterName,
      rationale: params.rationale,
    },
  };
}

export function createApprovalNotification(params: {
  requestId: string;
  boardId: string;
  elementId: string;
  approvedByUserId: string;
  approvedByName?: string;
  expiresAt: string;
  recipientUserId: string;
}): AccessNotification {
  return {
    notification_id: uuidv4(),
    type: 'access_request_approved',
    recipient_user_id: params.recipientUserId,
    created_at: new Date().toISOString(),
    priority: 'high',
    data: {
      request_id: params.requestId,
      board_id: params.boardId,
      element_id: params.elementId,
      approved_by_user_id: params.approvedByUserId,
      approved_by_name: params.approvedByName,
      expires_at: params.expiresAt,
    },
  };
}

export function createDenialNotification(params: {
  requestId: string;
  boardId: string;
  elementId: string;
  deniedByUserId: string;
  deniedByName?: string;
  denialReason?: string;
  recipientUserId: string;
}): AccessNotification {
  return {
    notification_id: uuidv4(),
    type: 'access_request_denied',
    recipient_user_id: params.recipientUserId,
    created_at: new Date().toISOString(),
    priority: 'normal',
    data: {
      request_id: params.requestId,
      board_id: params.boardId,
      element_id: params.elementId,
      denied_by_user_id: params.deniedByUserId,
      denied_by_name: params.deniedByName,
      denial_reason: params.denialReason,
    },
  };
}

export function createExpiringSoonNotification(params: {
  requestId: string;
  boardId: string;
  elementId: string;
  expiresAt: string;
  hoursUntilExpiration: number;
  recipientUserId: string;
}): AccessNotification {
  return {
    notification_id: uuidv4(),
    type: 'access_expiring_soon',
    recipient_user_id: params.recipientUserId,
    created_at: new Date().toISOString(),
    priority: 'normal',
    data: {
      request_id: params.requestId,
      board_id: params.boardId,
      element_id: params.elementId,
      expires_at: params.expiresAt,
      hours_until_expiration: params.hoursUntilExpiration,
    },
  };
}

export function createExpiredNotification(params: {
  requestId: string;
  boardId: string;
  elementId: string;
  expiredAt: string;
  recipientUserId: string;
}): AccessNotification {
  return {
    notification_id: uuidv4(),
    type: 'access_expired',
    recipient_user_id: params.recipientUserId,
    created_at: new Date().toISOString(),
    priority: 'normal',
    data: {
      request_id: params.requestId,
      board_id: params.boardId,
      element_id: params.elementId,
      expired_at: params.expiredAt,
    },
  };
}
