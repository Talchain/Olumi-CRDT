/**
 * Integration Tests - Event Flow
 * Tests cross-service communication and event handling
 */

import { EventBus } from '../services/event-bus/src/event-bus';
import { NotificationService } from '../services/notification-service/src/notification-service';
import { NotificationDatabase } from '../services/notification-service/src/database';
import { MockEmailProvider } from '../services/notification-service/src/providers/email';
import { MockSlackProvider } from '../services/notification-service/src/providers/slack';
import Redis from 'ioredis';
import type { AccessRequestCreatedEvent, NotificationRequestedEvent } from '@olumi/contracts';

describe('Integration Tests - Event Flow', () => {
  let eventBus: EventBus;
  let notificationService: NotificationService;
  let redis: Redis;
  let database: NotificationDatabase;
  let emailProvider: MockEmailProvider;
  let slackProvider: MockSlackProvider;

  beforeAll(async () => {
    // Set up Redis
    redis = new Redis({
      host: 'localhost',
      port: 6379,
      db: 15, // Test DB
    });

    // Set up Event Bus
    eventBus = new EventBus(redis);
    await eventBus.initialize();

    // Set up Notification Service
    database = new NotificationDatabase();
    await database.initialize();
    emailProvider = new MockEmailProvider();
    slackProvider = new MockSlackProvider();
    notificationService = new NotificationService(database, emailProvider, slackProvider);
  });

  afterAll(async () => {
    await eventBus.stop();
    await database.close();
    await redis.quit();
  });

  it('should deliver notification when access request event is published', async () => {
    // Subscribe to notification events
    const receivedNotifications: NotificationRequestedEvent[] = [];

    eventBus.subscribe({
      consumerId: 'notification-consumer',
      eventTypes: ['NOTIFICATION_REQUESTED'],
      handler: async (event: NotificationRequestedEvent) => {
        receivedNotifications.push(event);

        // Send notification
        await notificationService.sendNotification({
          notificationType: event.notification_type as any,
          recipientUserId: event.recipient_user_id,
          recipientEmail: event.recipient_email,
          channels: event.channels as any,
        });
      },
    });

    await eventBus.start();

    // Publish notification request event
    const notificationEvent: NotificationRequestedEvent = {
      event_id: 'evt_integration_test_1',
      event_type: 'NOTIFICATION_REQUESTED',
      timestamp: new Date().toISOString(),
      source_service: 'collab-service',
      notification_type: 'ACCESS_REQUEST_CREATED',
      recipient_user_id: 'user_integration_test',
      recipient_email: 'user@example.com',
      subject: 'New Access Request',
      message: 'A user has requested access',
      channels: ['email'],
    };

    await eventBus.publish(notificationEvent);

    // Wait for event processing
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Verify notification was received and delivered
    expect(receivedNotifications.length).toBeGreaterThanOrEqual(1);
    expect(emailProvider.sentEmails.length).toBeGreaterThanOrEqual(1);
  }, 10000);

  it('should handle end-to-end access request flow', async () => {
    const events: any[] = [];

    // Subscribe to all events
    eventBus.subscribe({
      consumerId: 'audit-consumer',
      handler: async (event: any) => {
        events.push(event);
      },
    });

    await eventBus.start();

    // 1. Publish ACCESS_REQUEST_CREATED event
    const accessRequestEvent: AccessRequestCreatedEvent = {
      event_id: 'evt_access_request_1',
      event_type: 'ACCESS_REQUEST_CREATED',
      timestamp: new Date().toISOString(),
      source_service: 'collab-service',
      request_id: 'req_integration_1',
      board_id: 'board_1',
      element_id: 'elem_1',
      element_type: 'goal',
      requester_id: 'user_requester',
      requester_email: 'requester@example.com',
      reason: 'Need access for review',
      status: 'pending',
    };

    await eventBus.publish(accessRequestEvent);

    // Wait for processing
    await new Promise((resolve) => setTimeout(resolve, 1500));

    // Verify events were received
    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(events.some((e) => e.event_type === 'ACCESS_REQUEST_CREATED')).toBe(true);
  }, 10000);
});
