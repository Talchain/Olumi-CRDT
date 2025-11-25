/**
 * Notification system types for access requests and other events
 */

export type NotificationType =
  | 'access_request_created'
  | 'access_request_approved'
  | 'access_request_denied'
  | 'access_expiring_soon'
  | 'access_expired'
  | 'review_requested'
  | 'review_completed'
  | 'review_overdue'
  | 'review_reminder';

export interface BaseNotification {
  notification_id: string;
  type: NotificationType;
  recipient_user_id: string;
  created_at: string;
  priority: 'low' | 'normal' | 'high';
  data: Record<string, any>;
}

export interface AccessRequestCreatedNotification extends BaseNotification {
  type: 'access_request_created';
  data: {
    request_id: string;
    board_id: string;
    element_id: string;
    requester_user_id: string;
    requester_name?: string;
    rationale?: string;
  };
}

export interface AccessRequestApprovedNotification extends BaseNotification {
  type: 'access_request_approved';
  data: {
    request_id: string;
    board_id: string;
    element_id: string;
    approved_by_user_id: string;
    approved_by_name?: string;
    expires_at: string;
  };
}

export interface AccessRequestDeniedNotification extends BaseNotification {
  type: 'access_request_denied';
  data: {
    request_id: string;
    board_id: string;
    element_id: string;
    denied_by_user_id: string;
    denied_by_name?: string;
    denial_reason?: string;
  };
}

export interface AccessExpiringSoonNotification extends BaseNotification {
  type: 'access_expiring_soon';
  data: {
    request_id: string;
    board_id: string;
    element_id: string;
    expires_at: string;
    hours_until_expiration: number;
  };
}

export interface AccessExpiredNotification extends BaseNotification {
  type: 'access_expired';
  data: {
    request_id: string;
    board_id: string;
    element_id: string;
    expired_at: string;
  };
}

export type AccessNotification =
  | AccessRequestCreatedNotification
  | AccessRequestApprovedNotification
  | AccessRequestDeniedNotification
  | AccessExpiringSoonNotification
  | AccessExpiredNotification;

// ============================================================================
// Review Notifications (G.4)
// ============================================================================

export interface ReviewRequestedNotification extends BaseNotification {
  type: 'review_requested';
  data: {
    review_id: string;
    board_id: string;
    board_name: string;
    snapshot_id: string;
    requested_by_user_id: string;
    requested_by_name?: string;
    due_date?: string;
    context_message?: string;
  };
}

export interface ReviewCompletedNotification extends BaseNotification {
  type: 'review_completed';
  data: {
    review_id: string;
    board_id: string;
    board_name: string;
    snapshot_id: string;
    overall_result: 'approved' | 'changes_needed' | 'mixed' | 'no_consensus';
    approvals_count: number;
    changes_requested_count: number;
    recommendation: string;
  };
}

export interface ReviewOverdueNotification extends BaseNotification {
  type: 'review_overdue';
  data: {
    review_id: string;
    board_id: string;
    board_name: string;
    due_date: string;
    days_overdue: number;
  };
}

export interface ReviewReminderNotification extends BaseNotification {
  type: 'review_reminder';
  data: {
    review_id: string;
    board_id: string;
    board_name: string;
    due_date?: string;
    hours_until_due?: number;
  };
}

export type ReviewNotification =
  | ReviewRequestedNotification
  | ReviewCompletedNotification
  | ReviewOverdueNotification
  | ReviewReminderNotification;

export type AllNotifications = AccessNotification | ReviewNotification;

/**
 * Notification service interface
 */
export interface INotificationService {
  /**
   * Queue a notification for delivery
   */
  queueNotification(notification: AllNotifications): Promise<void>;

  /**
   * Get pending notifications for a user
   */
  getPendingNotifications(userId: string): Promise<AllNotifications[]>;

  /**
   * Mark notification as read/delivered
   */
  markAsDelivered(notificationId: string): Promise<void>;

  /**
   * Get service health/stats
   */
  getStats(): {
    queueSize: number;
    deliveredCount: number;
    failedCount: number;
  };
}
