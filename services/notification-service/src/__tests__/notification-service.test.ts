/**
 * Notification Service Tests
 * Comprehensive test suite for multi-channel notification delivery
 */

import { NotificationService } from '../notification-service';
import { NotificationDatabase } from '../database';
import { MockEmailProvider } from '../providers/email';
import { MockSlackProvider } from '../providers/slack';
import type { SendNotificationParams } from '../notification-service';

describe('NotificationService', () => {
  let notificationService: NotificationService;
  let database: NotificationDatabase;
  let emailProvider: MockEmailProvider;
  let slackProvider: MockSlackProvider;

  beforeAll(async () => {
    database = new NotificationDatabase();
    await database.initialize();
  });

  beforeEach(async () => {
    emailProvider = new MockEmailProvider();
    slackProvider = new MockSlackProvider();

    notificationService = new NotificationService(
      database,
      emailProvider,
      slackProvider
    );

    // Clear sent messages
    emailProvider.clear();
    slackProvider.clear();
  });

  afterAll(async () => {
    await database.close();
  });

  // ========================================================================
  // SEND NOTIFICATION TESTS
  // ========================================================================

  describe('sendNotification()', () => {
    const baseParams: SendNotificationParams = {
      notificationType: 'ACCESS_REQUEST_CREATED',
      recipientUserId: 'user_123',
      recipientEmail: 'user@example.com',
    };

    it('should send notification with default channels', async () => {
      const notification = await notificationService.sendNotification(baseParams);

      expect(notification).toBeDefined();
      expect(notification.notification_type).toBe('ACCESS_REQUEST_CREATED');
      expect(notification.recipient_user_id).toBe('user_123');
      expect(notification.recipient_email).toBe('user@example.com');
    });

    it('should send notification to email channel', async () => {
      await notificationService.sendNotification({
        ...baseParams,
        channels: ['email'],
        templateVariables: {
          requester_name: 'John Doe',
          board_name: 'Test Board',
          element_type: 'goal',
          reason: 'Need access',
        },
      });

      expect(emailProvider.sentEmails.length).toBe(1);
      expect(emailProvider.sentEmails[0].to).toBe('user@example.com');
      expect(emailProvider.sentEmails[0].subject).toContain('Access Request');
    });

    it('should send notification to Slack channel', async () => {
      await notificationService.sendNotification({
        ...baseParams,
        channels: ['slack'],
      });

      expect(slackProvider.sentMessages.length).toBe(1);
      expect(slackProvider.sentMessages[0].text).toBeTruthy();
    });

    it('should send notification to multiple channels', async () => {
      await notificationService.sendNotification({
        ...baseParams,
        channels: ['email', 'slack', 'in_app'],
      });

      expect(emailProvider.sentEmails.length).toBe(1);
      expect(slackProvider.sentMessages.length).toBe(1);
    });

    it('should respect user preferences for channel selection', async () => {
      // Set user preferences to disable email
      await database.updateUserPreferences('user_123', {
        global_settings: {
          email_enabled: false,
          in_app_enabled: true,
          slack_enabled: true,
        },
      });

      await notificationService.sendNotification({
        ...baseParams,
        channels: ['email', 'slack'],
      });

      // Email should not be sent
      expect(emailProvider.sentEmails.length).toBe(0);
      // Slack should be sent
      expect(slackProvider.sentMessages.length).toBe(1);
    });

    it('should skip notification if type is disabled', async () => {
      // Disable ACCESS_REQUEST_CREATED notifications
      await database.updateUserPreferences('user_123', {
        preferences: {
          ACCESS_REQUEST_CREATED: {
            enabled: false,
            channels: [],
          },
        },
      });

      const notification = await notificationService.sendNotification(baseParams);

      expect(notification.channels.length).toBe(0);
      expect(emailProvider.sentEmails.length).toBe(0);
      expect(slackProvider.sentMessages.length).toBe(0);
    });

    it('should set priority correctly', async () => {
      const notification = await notificationService.sendNotification({
        ...baseParams,
        priority: 'high',
      });

      expect(notification.priority).toBe('high');
    });

    it('should include metadata', async () => {
      const metadata = { request_id: 'req_123', board_id: 'board_456' };

      const notification = await notificationService.sendNotification({
        ...baseParams,
        metadata,
      });

      expect(notification.metadata).toEqual(metadata);
    });
  });

  // ========================================================================
  // TEMPLATE TESTS
  // ========================================================================

  describe('notification templates', () => {
    it('should use ACCESS_REQUEST_APPROVED template', async () => {
      await notificationService.sendNotification({
        notificationType: 'ACCESS_REQUEST_APPROVED',
        recipientUserId: 'user_123',
        recipientEmail: 'user@example.com',
        channels: ['email'],
        templateVariables: {
          approver_name: 'Admin User',
          board_name: 'Test Board',
          element_type: 'goal',
          duration_days: 30,
          expires_at: '2024-12-31',
        },
      });

      expect(emailProvider.sentEmails.length).toBe(1);
      expect(emailProvider.sentEmails[0].subject).toBe('Access Request Approved');
      expect(emailProvider.sentEmails[0].htmlContent).toContain('Admin User');
      expect(emailProvider.sentEmails[0].htmlContent).toContain('30 days');
    });

    it('should use ACCESS_REQUEST_DENIED template', async () => {
      await notificationService.sendNotification({
        notificationType: 'ACCESS_REQUEST_DENIED',
        recipientUserId: 'user_123',
        recipientEmail: 'user@example.com',
        channels: ['email'],
        templateVariables: {
          board_name: 'Test Board',
          element_type: 'goal',
          reason: 'Insufficient permissions',
        },
      });

      expect(emailProvider.sentEmails.length).toBe(1);
      expect(emailProvider.sentEmails[0].subject).toBe('Access Request Denied');
      expect(emailProvider.sentEmails[0].htmlContent).toContain('Insufficient permissions');
    });

    it('should use ACCESS_REQUEST_EXPIRED template', async () => {
      await notificationService.sendNotification({
        notificationType: 'ACCESS_REQUEST_EXPIRED',
        recipientUserId: 'user_123',
        recipientEmail: 'user@example.com',
        channels: ['email'],
        templateVariables: {
          board_name: 'Test Board',
          element_type: 'goal',
        },
      });

      expect(emailProvider.sentEmails.length).toBe(1);
      expect(emailProvider.sentEmails[0].subject).toBe('Access Expired');
    });

    it('should use ACCESS_REQUEST_EXPIRING_SOON template', async () => {
      await notificationService.sendNotification({
        notificationType: 'ACCESS_REQUEST_EXPIRING_SOON',
        recipientUserId: 'user_123',
        recipientEmail: 'user@example.com',
        channels: ['email'],
        templateVariables: {
          board_name: 'Test Board',
          element_type: 'goal',
          expires_at: '2024-12-25',
        },
      });

      expect(emailProvider.sentEmails.length).toBe(1);
      expect(emailProvider.sentEmails[0].subject).toBe('Access Expiring Soon');
    });
  });

  // ========================================================================
  // USER PREFERENCES TESTS
  // ========================================================================

  describe('user preferences', () => {
    it('should get default preferences for new user', async () => {
      const prefs = await notificationService.getUserPreferences('new_user_999');

      expect(prefs.user_id).toBe('new_user_999');
      expect(prefs.global_settings.email_enabled).toBe(true);
      expect(prefs.global_settings.in_app_enabled).toBe(true);
    });

    it('should update user preferences', async () => {
      await notificationService.updateUserPreferences('user_123', {
        global_settings: {
          email_enabled: false,
          in_app_enabled: true,
          slack_enabled: false,
        },
      });

      const prefs = await notificationService.getUserPreferences('user_123');

      expect(prefs.global_settings.email_enabled).toBe(false);
      expect(prefs.global_settings.in_app_enabled).toBe(true);
    });

    it('should persist preference updates', async () => {
      await notificationService.updateUserPreferences('user_persist_test', {
        preferences: {
          ACCESS_REQUEST_CREATED: {
            enabled: false,
            channels: [],
          },
        },
      });

      const prefs = await notificationService.getUserPreferences('user_persist_test');

      expect(prefs.preferences.ACCESS_REQUEST_CREATED?.enabled).toBe(false);
    });
  });

  // ========================================================================
  // IN-APP NOTIFICATIONS TESTS
  // ========================================================================

  describe('in-app notifications', () => {
    it('should store in-app notifications', async () => {
      await notificationService.sendNotification({
        notificationType: 'BOARD_CREATED',
        recipientUserId: 'user_inapp_test',
        recipientEmail: 'user@example.com',
        channels: ['in_app'],
        templateVariables: {
          board_name: 'New Board',
        },
      });

      const notifications = await notificationService.getInAppNotifications(
        'user_inapp_test'
      );

      expect(notifications.length).toBeGreaterThanOrEqual(1);
      expect(notifications[0].notification_type).toBe('BOARD_CREATED');
    });

    it('should limit number of notifications returned', async () => {
      // Send multiple notifications
      for (let i = 0; i < 10; i++) {
        await notificationService.sendNotification({
          notificationType: 'BOARD_CREATED',
          recipientUserId: 'user_limit_test',
          recipientEmail: 'user@example.com',
          channels: ['in_app'],
        });
      }

      const notifications = await notificationService.getInAppNotifications(
        'user_limit_test',
        5
      );

      expect(notifications.length).toBeLessThanOrEqual(5);
    });

    it('should support pagination', async () => {
      // Send multiple notifications
      for (let i = 0; i < 5; i++) {
        await notificationService.sendNotification({
          notificationType: 'BOARD_CREATED',
          recipientUserId: 'user_pagination_test',
          recipientEmail: 'user@example.com',
          channels: ['in_app'],
        });
      }

      const page1 = await notificationService.getInAppNotifications(
        'user_pagination_test',
        2,
        0
      );
      const page2 = await notificationService.getInAppNotifications(
        'user_pagination_test',
        2,
        2
      );

      expect(page1.length).toBe(2);
      expect(page2.length).toBeGreaterThanOrEqual(2);
      expect(page1[0].notification_id).not.toBe(page2[0].notification_id);
    });
  });

  // ========================================================================
  // DELIVERY STATUS TESTS
  // ========================================================================

  describe('delivery status', () => {
    it('should track delivery status', async () => {
      const notification = await notificationService.sendNotification({
        notificationType: 'ACCESS_REQUEST_CREATED',
        recipientUserId: 'user_delivery_test',
        recipientEmail: 'user@example.com',
        channels: ['email', 'slack'],
      });

      const deliveries = await notificationService.getDeliveryStatus(
        notification.notification_id
      );

      expect(deliveries.length).toBeGreaterThanOrEqual(2);
      expect(deliveries.some((d) => d.channel === 'email')).toBe(true);
      expect(deliveries.some((d) => d.channel === 'slack')).toBe(true);
    });

    it('should mark successful deliveries as sent', async () => {
      const notification = await notificationService.sendNotification({
        notificationType: 'ACCESS_REQUEST_CREATED',
        recipientUserId: 'user_success_test',
        recipientEmail: 'user@example.com',
        channels: ['email'],
      });

      const deliveries = await notificationService.getDeliveryStatus(
        notification.notification_id
      );

      const emailDelivery = deliveries.find((d) => d.channel === 'email');
      expect(emailDelivery?.status).toBe('sent');
      expect(emailDelivery?.sent_at).toBeDefined();
    });
  });

  // ========================================================================
  // STATISTICS TESTS
  // ========================================================================

  describe('statistics', () => {
    it('should return delivery statistics', async () => {
      // Send some notifications
      await notificationService.sendNotification({
        notificationType: 'BOARD_CREATED',
        recipientUserId: 'user_stats_test',
        recipientEmail: 'user@example.com',
        channels: ['email', 'slack'],
      });

      const stats = await notificationService.getStats({});

      expect(stats).toHaveProperty('total');
      expect(stats).toHaveProperty('sent');
      expect(stats).toHaveProperty('failed');
      expect(stats).toHaveProperty('byChannel');
      expect(stats.total).toBeGreaterThanOrEqual(2);
    });

    it('should filter stats by date range', async () => {
      const startDate = new Date('2024-01-01');
      const endDate = new Date('2024-12-31');

      const stats = await notificationService.getStats({
        startDate,
        endDate,
      });

      expect(stats).toBeDefined();
    });

    it('should filter stats by channel', async () => {
      await notificationService.sendNotification({
        notificationType: 'BOARD_CREATED',
        recipientUserId: 'user_channel_stats',
        recipientEmail: 'user@example.com',
        channels: ['email'],
      });

      const stats = await notificationService.getStats({
        channel: 'email',
      });

      expect(stats.byChannel.email).toBeDefined();
    });
  });

  // ========================================================================
  // ERROR HANDLING TESTS
  // ========================================================================

  describe('error handling', () => {
    it('should handle email delivery failures gracefully', async () => {
      // Override send to throw error
      emailProvider.send = async () => {
        throw new Error('Email service unavailable');
      };

      const notification = await notificationService.sendNotification({
        notificationType: 'BOARD_CREATED',
        recipientUserId: 'user_error_test',
        recipientEmail: 'user@example.com',
        channels: ['email'],
      });

      const deliveries = await notificationService.getDeliveryStatus(
        notification.notification_id
      );

      const emailDelivery = deliveries.find((d) => d.channel === 'email');
      expect(emailDelivery?.status).toBe('failed');
      expect(emailDelivery?.error_message).toContain('unavailable');
    });

    it('should continue with other channels if one fails', async () => {
      // Override email to fail
      emailProvider.send = async () => {
        throw new Error('Email failed');
      };

      await notificationService.sendNotification({
        notificationType: 'BOARD_CREATED',
        recipientUserId: 'user_partial_fail',
        recipientEmail: 'user@example.com',
        channels: ['email', 'slack'],
      });

      // Slack should still be sent
      expect(slackProvider.sentMessages.length).toBe(1);
    });
  });

  // ========================================================================
  // NOTIFICATION TYPE TESTS
  // ========================================================================

  describe('notification types', () => {
    const testCases: Array<{ type: any; expectedSubject: string }> = [
      { type: 'ACCESS_REQUEST_CREATED', expectedSubject: 'New Access Request' },
      { type: 'ACCESS_REQUEST_APPROVED', expectedSubject: 'Access Request Approved' },
      { type: 'ACCESS_REQUEST_DENIED', expectedSubject: 'Access Request Denied' },
      { type: 'ACCESS_REQUEST_EXPIRED', expectedSubject: 'Access Expired' },
      { type: 'ACCESS_REQUEST_EXPIRING_SOON', expectedSubject: 'Access Expiring Soon' },
      { type: 'BOARD_CREATED', expectedSubject: 'New Board Created' },
      { type: 'ELEMENT_VISIBILITY_CHANGED', expectedSubject: 'Element Visibility Changed' },
      { type: 'USER_ROLE_CHANGED', expectedSubject: 'Your Role Has Been Updated' },
    ];

    testCases.forEach(({ type, expectedSubject }) => {
      it(`should handle ${type} notification type`, async () => {
        const notification = await notificationService.sendNotification({
          notificationType: type,
          recipientUserId: `user_${type}_test`,
          recipientEmail: 'user@example.com',
          channels: ['in_app'],
        });

        expect(notification.notification_type).toBe(type);
        expect(notification.subject).toContain(expectedSubject);
      });
    });
  });
});
