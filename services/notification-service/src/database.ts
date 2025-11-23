/**
 * Database Client for Notification Service
 * Manages user preferences and notification history
 */

import { Pool, PoolClient } from 'pg';
import { pino } from 'pino';
import { config } from './config';
import type {
  UserNotificationPreferences,
  NotificationChannel,
  NotificationType,
  Notification,
  NotificationDelivery,
  DEFAULT_NOTIFICATION_PREFERENCES,
} from '@olumi/contracts';

const logger = pino({ level: config.logging.level });

export class NotificationDatabase {
  private pool: Pool;

  constructor() {
    this.pool = new Pool(config.postgres);

    this.pool.on('error', (err) => {
      logger.error({ err }, 'PostgreSQL pool error');
    });

    this.pool.on('connect', () => {
      logger.info('PostgreSQL client connected');
    });
  }

  /**
   * Initialize database schema
   */
  async initialize(): Promise<void> {
    await this.pool.query(`
      -- User notification preferences
      CREATE TABLE IF NOT EXISTS user_notification_preferences (
        user_id TEXT PRIMARY KEY,
        preferences JSONB NOT NULL,
        global_settings JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_user_prefs_updated
        ON user_notification_preferences(updated_at DESC);

      -- Notification history
      CREATE TABLE IF NOT EXISTS notifications (
        notification_id TEXT PRIMARY KEY,
        notification_type TEXT NOT NULL,
        recipient_user_id TEXT NOT NULL,
        recipient_email TEXT NOT NULL,
        priority TEXT NOT NULL,
        channels TEXT[] NOT NULL,
        subject TEXT NOT NULL,
        message TEXT NOT NULL,
        metadata JSONB,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        scheduled_for TIMESTAMPTZ
      );

      CREATE INDEX IF NOT EXISTS idx_notifications_recipient
        ON notifications(recipient_user_id, created_at DESC);

      CREATE INDEX IF NOT EXISTS idx_notifications_type
        ON notifications(notification_type, created_at DESC);

      -- Notification delivery status
      CREATE TABLE IF NOT EXISTS notification_deliveries (
        id SERIAL PRIMARY KEY,
        notification_id TEXT NOT NULL REFERENCES notifications(notification_id),
        channel TEXT NOT NULL,
        status TEXT NOT NULL,
        sent_at TIMESTAMPTZ,
        error_message TEXT,
        provider_message_id TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_deliveries_notification
        ON notification_deliveries(notification_id);

      CREATE INDEX IF NOT EXISTS idx_deliveries_status
        ON notification_deliveries(status, created_at DESC);
    `);

    logger.info('Notification database schema initialized');
  }

  /**
   * Get user notification preferences
   */
  async getUserPreferences(userId: string): Promise<UserNotificationPreferences> {
    const result = await this.pool.query(
      'SELECT * FROM user_notification_preferences WHERE user_id = $1',
      [userId]
    );

    if (result.rows.length === 0) {
      // Return default preferences
      return {
        user_id: userId,
        ...(DEFAULT_NOTIFICATION_PREFERENCES as any),
        updated_at: new Date().toISOString(),
      };
    }

    const row = result.rows[0];
    return {
      user_id: row.user_id,
      preferences: row.preferences,
      global_settings: row.global_settings,
      updated_at: row.updated_at,
    };
  }

  /**
   * Update user notification preferences
   */
  async updateUserPreferences(
    userId: string,
    preferences: Partial<UserNotificationPreferences>
  ): Promise<void> {
    const existing = await this.getUserPreferences(userId);

    const updated = {
      ...existing,
      ...preferences,
      user_id: userId,
      updated_at: new Date().toISOString(),
    };

    await this.pool.query(
      `INSERT INTO user_notification_preferences (user_id, preferences, global_settings, updated_at)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id)
       DO UPDATE SET
         preferences = EXCLUDED.preferences,
         global_settings = EXCLUDED.global_settings,
         updated_at = EXCLUDED.updated_at`,
      [
        updated.user_id,
        JSON.stringify(updated.preferences),
        JSON.stringify(updated.global_settings),
        updated.updated_at,
      ]
    );

    logger.info({ userId }, 'User notification preferences updated');
  }

  /**
   * Save notification
   */
  async saveNotification(notification: Notification): Promise<void> {
    await this.pool.query(
      `INSERT INTO notifications (
        notification_id, notification_type, recipient_user_id, recipient_email,
        priority, channels, subject, message, metadata, created_at, scheduled_for
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        notification.notification_id,
        notification.notification_type,
        notification.recipient_user_id,
        notification.recipient_email,
        notification.priority,
        notification.channels,
        notification.subject,
        notification.message,
        notification.metadata ? JSON.stringify(notification.metadata) : null,
        notification.created_at,
        notification.scheduled_for || null,
      ]
    );

    logger.debug({ notificationId: notification.notification_id }, 'Notification saved');
  }

  /**
   * Save notification delivery status
   */
  async saveDelivery(delivery: NotificationDelivery): Promise<void> {
    await this.pool.query(
      `INSERT INTO notification_deliveries (
        notification_id, channel, status, sent_at, error_message, provider_message_id
      ) VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        delivery.notification_id,
        delivery.channel,
        delivery.status,
        delivery.sent_at || null,
        delivery.error_message || null,
        delivery.provider_message_id || null,
      ]
    );

    logger.debug(
      { notificationId: delivery.notification_id, channel: delivery.channel, status: delivery.status },
      'Delivery status saved'
    );
  }

  /**
   * Get notifications for user
   */
  async getNotifications(
    userId: string,
    limit: number = 50,
    offset: number = 0
  ): Promise<Notification[]> {
    const result = await this.pool.query(
      `SELECT * FROM notifications
       WHERE recipient_user_id = $1
       ORDER BY created_at DESC
       LIMIT $2 OFFSET $3`,
      [userId, limit, offset]
    );

    return result.rows.map((row) => ({
      notification_id: row.notification_id,
      notification_type: row.notification_type,
      recipient_user_id: row.recipient_user_id,
      recipient_email: row.recipient_email,
      priority: row.priority,
      channels: row.channels,
      subject: row.subject,
      message: row.message,
      metadata: row.metadata || undefined,
      created_at: row.created_at,
      scheduled_for: row.scheduled_for || undefined,
    }));
  }

  /**
   * Get delivery status for notification
   */
  async getDeliveries(notificationId: string): Promise<NotificationDelivery[]> {
    const result = await this.pool.query(
      `SELECT * FROM notification_deliveries
       WHERE notification_id = $1
       ORDER BY created_at DESC`,
      [notificationId]
    );

    return result.rows.map((row) => ({
      notification_id: row.notification_id,
      channel: row.channel,
      status: row.status,
      sent_at: row.sent_at || undefined,
      error_message: row.error_message || undefined,
      provider_message_id: row.provider_message_id || undefined,
    }));
  }

  /**
   * Get delivery statistics
   */
  async getDeliveryStats(params: {
    startDate?: Date;
    endDate?: Date;
    channel?: NotificationChannel;
  }): Promise<{
    total: number;
    sent: number;
    failed: number;
    pending: number;
    byChannel: Record<string, { sent: number; failed: number }>;
  }> {
    const conditions: string[] = [];
    const queryParams: any[] = [];
    let paramIndex = 1;

    if (params.startDate) {
      conditions.push(`created_at >= $${paramIndex++}`);
      queryParams.push(params.startDate);
    }

    if (params.endDate) {
      conditions.push(`created_at <= $${paramIndex++}`);
      queryParams.push(params.endDate);
    }

    if (params.channel) {
      conditions.push(`channel = $${paramIndex++}`);
      queryParams.push(params.channel);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const result = await this.pool.query(
      `SELECT
         COUNT(*) as total,
         COUNT(*) FILTER (WHERE status = 'sent') as sent,
         COUNT(*) FILTER (WHERE status = 'failed') as failed,
         COUNT(*) FILTER (WHERE status = 'pending') as pending
       FROM notification_deliveries
       ${whereClause}`,
      queryParams
    );

    const byChannelResult = await this.pool.query(
      `SELECT
         channel,
         COUNT(*) FILTER (WHERE status = 'sent') as sent,
         COUNT(*) FILTER (WHERE status = 'failed') as failed
       FROM notification_deliveries
       ${whereClause}
       GROUP BY channel`,
      queryParams
    );

    const byChannel: Record<string, { sent: number; failed: number }> = {};
    for (const row of byChannelResult.rows) {
      byChannel[row.channel] = {
        sent: parseInt(row.sent, 10),
        failed: parseInt(row.failed, 10),
      };
    }

    return {
      total: parseInt(result.rows[0].total, 10),
      sent: parseInt(result.rows[0].sent, 10),
      failed: parseInt(result.rows[0].failed, 10),
      pending: parseInt(result.rows[0].pending, 10),
      byChannel,
    };
  }

  /**
   * Close database connection
   */
  async close(): Promise<void> {
    await this.pool.end();
    logger.info('PostgreSQL pool closed');
  }
}
