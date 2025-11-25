/**
 * Review Reminder Job (G.4)
 *
 * Periodic job that:
 * 1. Finds reviews approaching their due date
 * 2. Finds overdue reviews
 * 3. Sends reminder notifications to assigned reviewers
 *
 * Run frequency: Every 6 hours
 */

import { pino } from 'pino';
import { DatabaseClient } from '../database/client';
import { INotificationService } from '../notifications/notification-types';
import {
  createReviewReminderNotification,
  createReviewOverdueNotification,
} from '../notifications/notification-service';

const logger = pino();

export interface ReviewReminderJobConfig {
  reminderHours: number; // Send reminder when this many hours until due
  checkIntervalMs: number; // How often to run the job
}

export const DEFAULT_CONFIG: ReviewReminderJobConfig = {
  reminderHours: 24, // Remind 24 hours before due
  checkIntervalMs: 6 * 60 * 60 * 1000, // Run every 6 hours
};

export class ReviewReminderJob {
  private intervalId: NodeJS.Timeout | null = null;
  private isRunning = false;

  constructor(
    private db: DatabaseClient,
    private notificationService: INotificationService,
    private config: ReviewReminderJobConfig = DEFAULT_CONFIG
  ) {}

  /**
   * Start the reminder job
   */
  start(): void {
    if (this.intervalId) {
      logger.warn('Review reminder job already running');
      return;
    }

    logger.info(
      {
        reminderHours: this.config.reminderHours,
        checkIntervalMs: this.config.checkIntervalMs,
      },
      'Starting review reminder job'
    );

    // Run immediately on start
    this.runCheck().catch((err) => {
      logger.error({ err }, 'Failed to run initial review reminder check');
    });

    // Schedule periodic runs
    this.intervalId = setInterval(() => {
      this.runCheck().catch((err) => {
        logger.error({ err }, 'Failed to run scheduled review reminder check');
      });
    }, this.config.checkIntervalMs);
  }

  /**
   * Stop the reminder job
   */
  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      logger.info('Review reminder job stopped');
    }
  }

  /**
   * Run the reminder check
   */
  private async runCheck(): Promise<void> {
    if (this.isRunning) {
      logger.warn('Review reminder check already in progress, skipping');
      return;
    }

    this.isRunning = true;
    const startTime = Date.now();

    try {
      logger.info('Running review reminder check');

      // Find reviews that need reminders or are overdue
      const reviewsNeedingAttention = await this.findReviewsNeedingAttention();

      logger.info(
        {
          total: reviewsNeedingAttention.length,
          reminders: reviewsNeedingAttention.filter((r) => r.type === 'reminder').length,
          overdue: reviewsNeedingAttention.filter((r) => r.type === 'overdue').length,
        },
        'Found reviews needing attention'
      );

      // Send notifications
      for (const item of reviewsNeedingAttention) {
        try {
          if (item.type === 'reminder') {
            await this.sendReminder(item);
          } else if (item.type === 'overdue') {
            await this.sendOverdueNotification(item);
          }
        } catch (err) {
          logger.error({ err, reviewId: item.review_id }, 'Failed to send notification');
        }
      }

      const duration = Date.now() - startTime;
      logger.info(
        {
          processed: reviewsNeedingAttention.length,
          duration,
        },
        'Review reminder check complete'
      );
    } catch (err) {
      logger.error({ err }, 'Review reminder check failed');
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Find reviews that need reminders or are overdue
   */
  private async findReviewsNeedingAttention(): Promise<
    Array<{
      type: 'reminder' | 'overdue';
      review_id: string;
      board_id: string;
      board_name: string;
      due_date: string;
      hours_until_due?: number;
      days_overdue?: number;
      pending_reviewers: Array<{
        user_id: string;
        name: string;
      }>;
    }>
  > {
    const now = new Date();
    const reminderThreshold = new Date(now.getTime() + this.config.reminderHours * 60 * 60 * 1000);

    // Find all active reviews with due dates
    const result = await this.db.pool.query(
      `SELECT DISTINCT
        r.review_id,
        r.board_id,
        r.due_date,
        r.status,
        b.name as board_name,
        ARRAY_AGG(
          JSON_BUILD_OBJECT(
            'user_id', u.user_id,
            'name', u.name,
            'status', a.status
          )
        ) as reviewers
       FROM review_requests r
       JOIN boards b ON r.board_id = b.id
       JOIN reviewer_assignments a ON r.review_id = a.review_id
       JOIN users u ON a.user_id = u.user_id
       WHERE r.status IN ('pending', 'in_progress')
         AND r.due_date IS NOT NULL
         AND a.status IN ('pending', 'in_progress')
       GROUP BY r.review_id, r.board_id, r.due_date, r.status, b.name`
    );

    const reviewsNeedingAttention: Array<{
      type: 'reminder' | 'overdue';
      review_id: string;
      board_id: string;
      board_name: string;
      due_date: string;
      hours_until_due?: number;
      days_overdue?: number;
      pending_reviewers: Array<{ user_id: string; name: string }>;
    }> = [];

    for (const row of result.rows) {
      const dueDate = new Date(row.due_date);
      const pendingReviewers = row.reviewers
        .filter((r: any) => r.status === 'pending' || r.status === 'in_progress')
        .map((r: any) => ({ user_id: r.user_id, name: r.name }));

      if (pendingReviewers.length === 0) continue;

      // Check if overdue
      if (dueDate < now) {
        const daysOverdue = Math.ceil((now.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24));
        reviewsNeedingAttention.push({
          type: 'overdue',
          review_id: row.review_id,
          board_id: row.board_id,
          board_name: row.board_name,
          due_date: row.due_date,
          days_overdue: daysOverdue,
          pending_reviewers: pendingReviewers,
        });
      }
      // Check if approaching due date
      else if (dueDate <= reminderThreshold) {
        const hoursUntilDue = Math.ceil(
          (dueDate.getTime() - now.getTime()) / (1000 * 60 * 60)
        );
        reviewsNeedingAttention.push({
          type: 'reminder',
          review_id: row.review_id,
          board_id: row.board_id,
          board_name: row.board_name,
          due_date: row.due_date,
          hours_until_due: hoursUntilDue,
          pending_reviewers: pendingReviewers,
        });
      }
    }

    return reviewsNeedingAttention;
  }

  /**
   * Send reminder notification
   */
  private async sendReminder(item: {
    review_id: string;
    board_id: string;
    board_name: string;
    due_date: string;
    hours_until_due?: number;
    pending_reviewers: Array<{ user_id: string; name: string }>;
  }): Promise<void> {
    for (const reviewer of item.pending_reviewers) {
      const notification = createReviewReminderNotification({
        reviewId: item.review_id,
        boardId: item.board_id,
        boardName: item.board_name,
        dueDate: item.due_date,
        hoursUntilDue: item.hours_until_due,
        recipientUserId: reviewer.user_id,
      });

      await this.notificationService.queueNotification(notification);

      logger.info(
        {
          reviewId: item.review_id,
          userId: reviewer.user_id,
          hoursUntilDue: item.hours_until_due,
        },
        'Review reminder sent'
      );
    }
  }

  /**
   * Send overdue notification
   */
  private async sendOverdueNotification(item: {
    review_id: string;
    board_id: string;
    board_name: string;
    due_date: string;
    days_overdue?: number;
    pending_reviewers: Array<{ user_id: string; name: string }>;
  }): Promise<void> {
    for (const reviewer of item.pending_reviewers) {
      const notification = createReviewOverdueNotification({
        reviewId: item.review_id,
        boardId: item.board_id,
        boardName: item.board_name,
        dueDate: item.due_date,
        daysOverdue: item.days_overdue || 1,
        recipientUserId: reviewer.user_id,
      });

      await this.notificationService.queueNotification(notification);

      logger.info(
        {
          reviewId: item.review_id,
          userId: reviewer.user_id,
          daysOverdue: item.days_overdue,
        },
        'Overdue review notification sent'
      );
    }
  }

  /**
   * Get job status
   */
  getStatus(): {
    isRunning: boolean;
    intervalMs: number;
  } {
    return {
      isRunning: this.isRunning,
      intervalMs: this.config.checkIntervalMs,
    };
  }
}
