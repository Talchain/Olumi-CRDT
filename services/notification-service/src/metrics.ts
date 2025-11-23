/**
 * Notification Service Metrics
 */

import { createCounter, createHistogram, createGauge } from '@olumi/telemetry';

/**
 * Notifications sent total
 */
export const notificationsSentTotal = createCounter({
  name: 'notification_service_notifications_sent_total',
  help: 'Total number of notifications sent',
  labelNames: ['notification_type', 'channel'],
});

/**
 * Notification delivery duration
 */
export const notificationDeliveryDuration = createHistogram({
  name: 'notification_service_delivery_duration_seconds',
  help: 'Notification delivery duration in seconds',
  labelNames: ['channel'],
  buckets: [0.01, 0.05, 0.1, 0.5, 1, 2, 5],
});

/**
 * Notifications failed total
 */
export const notificationsFailedTotal = createCounter({
  name: 'notification_service_notifications_failed_total',
  help: 'Total number of failed notifications',
  labelNames: ['notification_type', 'channel', 'error_type'],
});

/**
 * In-app notifications stored
 */
export const inAppNotificationsStored = createGauge({
  name: 'notification_service_in_app_notifications_stored',
  help: 'Number of in-app notifications stored',
});

/**
 * User preferences updates
 */
export const userPreferencesUpdates = createCounter({
  name: 'notification_service_user_preferences_updates_total',
  help: 'Total number of user preference updates',
});
