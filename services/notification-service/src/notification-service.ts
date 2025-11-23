/**
 * Notification Service
 * Multi-channel notification delivery with user preferences
 */

import { randomUUID } from 'crypto';
import { pino } from 'pino';
import { config } from './config';
import { NotificationDatabase } from './database';
import { EmailProvider } from './providers/email';
import { SlackProvider } from './providers/slack';
import { generateTemplate } from './templates';
import type {
  Notification,
  NotificationDelivery,
  NotificationChannel,
  NotificationType,
  NotificationPriority,
  NotificationTemplateVariables,
} from '@olumi/contracts';

const logger = pino({ level: config.logging.level });

export interface SendNotificationParams {
  notificationType: NotificationType;
  recipientUserId: string;
  recipientEmail: string;
  priority?: NotificationPriority;
  channels?: NotificationChannel[];
  templateVariables?: NotificationTemplateVariables;
  metadata?: Record<string, any>;
}

/**
 * NotificationService handles multi-channel notification delivery
 */
export class NotificationService {
  constructor(
    private db: NotificationDatabase,
    private emailProvider: EmailProvider,
    private slackProvider: SlackProvider
  ) {}

  /**
   * Send a notification
   */
  async sendNotification(params: SendNotificationParams): Promise<Notification> {
    const notificationId = randomUUID();

    // Get user preferences
    const userPrefs = await this.db.getUserPreferences(params.recipientUserId);

    // Check if notification type is enabled
    const typePrefs = userPrefs.preferences[params.notificationType];
    if (typePrefs && !typePrefs.enabled) {
      logger.info(
        { notificationType: params.notificationType, userId: params.recipientUserId },
        'Notification disabled by user preferences'
      );

      // Save as skipped
      const notification = this.createNotification(notificationId, params, []);
      await this.db.saveNotification(notification);

      return notification;
    }

    // Determine channels to use
    let channels = params.channels || typePrefs?.channels || [];

    // Apply global settings
    if (!userPrefs.global_settings.email_enabled) {
      channels = channels.filter((c) => c !== 'email');
    }
    if (!userPrefs.global_settings.in_app_enabled) {
      channels = channels.filter((c) => c !== 'in_app');
    }
    if (!userPrefs.global_settings.slack_enabled) {
      channels = channels.filter((c) => c !== 'slack');
    }

    // Check do-not-disturb
    if (this.isDoNotDisturbActive(userPrefs)) {
      logger.info(
        { userId: params.recipientUserId },
        'Do-not-disturb active, skipping email and Slack'
      );
      // Only send in-app during DND
      channels = channels.filter((c) => c === 'in_app');
    }

    // Generate template
    const template = generateTemplate(
      params.notificationType,
      params.templateVariables || {}
    );

    // Create notification
    const notification = this.createNotification(notificationId, params, channels, template);

    // Save notification
    await this.db.saveNotification(notification);

    // Deliver on each channel
    for (const channel of channels) {
      await this.deliverOnChannel(notification, channel, template);
    }

    logger.info(
      {
        notificationId,
        notificationType: params.notificationType,
        recipientUserId: params.recipientUserId,
        channels,
      },
      'Notification sent'
    );

    return notification;
  }

  /**
   * Create notification object
   */
  private createNotification(
    notificationId: string,
    params: SendNotificationParams,
    channels: NotificationChannel[],
    template?: any
  ): Notification {
    return {
      notification_id: notificationId,
      notification_type: params.notificationType,
      recipient_user_id: params.recipientUserId,
      recipient_email: params.recipientEmail,
      priority: params.priority || 'normal',
      channels,
      subject: template?.subject || 'Notification',
      message: template?.textContent || '',
      metadata: params.metadata,
      created_at: new Date().toISOString(),
    };
  }

  /**
   * Deliver notification on a specific channel
   */
  private async deliverOnChannel(
    notification: Notification,
    channel: NotificationChannel,
    template: any
  ): Promise<void> {
    const delivery: NotificationDelivery = {
      notification_id: notification.notification_id,
      channel,
      status: 'pending',
    };

    try {
      if (channel === 'email') {
        await this.deliverEmail(notification, template);
      } else if (channel === 'slack') {
        await this.deliverSlack(notification, template);
      } else if (channel === 'in_app') {
        // In-app notifications are just stored in database
        logger.debug({ notificationId: notification.notification_id }, 'In-app notification stored');
      }

      delivery.status = 'sent';
      delivery.sent_at = new Date().toISOString();
    } catch (err: any) {
      logger.error(
        { err, notificationId: notification.notification_id, channel },
        'Failed to deliver notification'
      );

      delivery.status = 'failed';
      delivery.error_message = err.message;
    }

    await this.db.saveDelivery(delivery);
  }

  /**
   * Deliver email
   */
  private async deliverEmail(notification: Notification, template: any): Promise<void> {
    const result = await this.emailProvider.send({
      to: notification.recipient_email,
      subject: template.subject,
      htmlContent: template.htmlContent,
      textContent: template.textContent,
    });

    if (!result.success) {
      throw new Error(result.error || 'Email delivery failed');
    }

    logger.info(
      {
        notificationId: notification.notification_id,
        to: notification.recipient_email,
        messageId: result.messageId,
      },
      'Email delivered'
    );
  }

  /**
   * Deliver Slack message
   */
  private async deliverSlack(notification: Notification, template: any): Promise<void> {
    const result = await this.slackProvider.send({
      text: `${template.subject}\n\n${template.textContent}`,
      blocks: template.slackBlocks,
    });

    if (!result.success) {
      throw new Error(result.error || 'Slack delivery failed');
    }

    logger.info(
      { notificationId: notification.notification_id },
      'Slack message delivered'
    );
  }

  /**
   * Check if do-not-disturb is active
   */
  private isDoNotDisturbActive(userPrefs: any): boolean {
    const dnd = userPrefs.global_settings.do_not_disturb;
    if (!dnd || !dnd.enabled) {
      return false;
    }

    // TODO: Implement time-based DND check
    // For now, just check if enabled
    return false;
  }

  /**
   * Get in-app notifications for user
   */
  async getInAppNotifications(
    userId: string,
    limit: number = 50,
    offset: number = 0
  ): Promise<Notification[]> {
    return this.db.getNotifications(userId, limit, offset);
  }

  /**
   * Get delivery status for notification
   */
  async getDeliveryStatus(notificationId: string): Promise<NotificationDelivery[]> {
    return this.db.getDeliveries(notificationId);
  }

  /**
   * Get user preferences
   */
  async getUserPreferences(userId: string) {
    return this.db.getUserPreferences(userId);
  }

  /**
   * Update user preferences
   */
  async updateUserPreferences(userId: string, preferences: any) {
    return this.db.updateUserPreferences(userId, preferences);
  }

  /**
   * Get delivery statistics
   */
  async getStats(params: any) {
    return this.db.getDeliveryStats(params);
  }
}
