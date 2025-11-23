/**
 * Shared Notification Type Definitions
 * Used by notification-service for multi-channel delivery
 */

/**
 * Notification channels
 */
export type NotificationChannel = 'email' | 'in_app' | 'slack';

/**
 * Notification types (matches event types)
 */
export type NotificationType =
  | 'ACCESS_REQUEST_CREATED'
  | 'ACCESS_REQUEST_APPROVED'
  | 'ACCESS_REQUEST_DENIED'
  | 'ACCESS_REQUEST_EXPIRED'
  | 'ACCESS_REQUEST_EXPIRING_SOON'
  | 'BOARD_CREATED'
  | 'ELEMENT_VISIBILITY_CHANGED'
  | 'USER_ROLE_CHANGED';

/**
 * Notification priority
 */
export type NotificationPriority = 'low' | 'normal' | 'high' | 'urgent';

/**
 * Base notification interface
 */
export interface Notification {
  notification_id: string;
  notification_type: NotificationType;
  recipient_user_id: string;
  recipient_email: string;
  priority: NotificationPriority;
  channels: NotificationChannel[];
  subject: string;
  message: string;
  metadata?: Record<string, any>;
  created_at: string;
  scheduled_for?: string;
}

/**
 * Notification delivery status
 */
export interface NotificationDelivery {
  notification_id: string;
  channel: NotificationChannel;
  status: 'pending' | 'sent' | 'failed' | 'skipped';
  sent_at?: string;
  error_message?: string;
  provider_message_id?: string;
}

/**
 * User notification preferences
 */
export interface UserNotificationPreferences {
  user_id: string;
  preferences: {
    [key in NotificationType]?: {
      enabled: boolean;
      channels: NotificationChannel[];
    };
  };
  global_settings: {
    do_not_disturb?: {
      enabled: boolean;
      start_time?: string; // HH:mm format
      end_time?: string;   // HH:mm format
      timezone?: string;
    };
    email_enabled: boolean;
    in_app_enabled: boolean;
    slack_enabled: boolean;
  };
  updated_at: string;
}

/**
 * Default notification preferences
 */
export const DEFAULT_NOTIFICATION_PREFERENCES: Omit<UserNotificationPreferences, 'user_id' | 'updated_at'> = {
  preferences: {
    ACCESS_REQUEST_CREATED: {
      enabled: true,
      channels: ['email', 'in_app'],
    },
    ACCESS_REQUEST_APPROVED: {
      enabled: true,
      channels: ['email', 'in_app'],
    },
    ACCESS_REQUEST_DENIED: {
      enabled: true,
      channels: ['email', 'in_app'],
    },
    ACCESS_REQUEST_EXPIRED: {
      enabled: true,
      channels: ['in_app'],
    },
    ACCESS_REQUEST_EXPIRING_SOON: {
      enabled: true,
      channels: ['email', 'in_app'],
    },
    BOARD_CREATED: {
      enabled: true,
      channels: ['in_app'],
    },
    ELEMENT_VISIBILITY_CHANGED: {
      enabled: true,
      channels: ['in_app'],
    },
    USER_ROLE_CHANGED: {
      enabled: true,
      channels: ['email', 'in_app'],
    },
  },
  global_settings: {
    email_enabled: true,
    in_app_enabled: true,
    slack_enabled: false,
  },
};

/**
 * Notification template variables
 */
export interface NotificationTemplateVariables {
  recipient_name?: string;
  requester_name?: string;
  approver_name?: string;
  board_name?: string;
  element_type?: string;
  element_id?: string;
  reason?: string;
  duration_days?: number;
  expires_at?: string;
  [key: string]: any;
}

/**
 * Email provider configuration
 */
export interface EmailProviderConfig {
  provider: 'brevo' | 'sendgrid' | 'smtp';
  api_key?: string;
  from_email: string;
  from_name: string;
  reply_to?: string;
}

/**
 * Slack provider configuration
 */
export interface SlackProviderConfig {
  webhook_url?: string;
  bot_token?: string;
  default_channel?: string;
}
