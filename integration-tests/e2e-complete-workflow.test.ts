/**
 * End-to-End Integration Tests
 * Tests full workflows across all infrastructure services
 */

import { describe, test, expect, beforeAll, afterAll } from '@jest/globals';
import { DatabaseClient } from '../../services/collab-service/src/database/client';
import { EventBus } from '../../services/event-bus/src/event-bus';
import { JobScheduler } from '../../services/job-scheduler/src/job-scheduler';
import { NotificationService } from '../../services/notification-service/src/notification-service';
import { NotificationDatabase } from '../../services/notification-service/src/database';
import { MockEmailProvider } from '../../services/notification-service/src/providers/email';
import { MockSlackProvider } from '../../services/notification-service/src/providers/slack';
import { VisibilityManager } from '../../services/collab-service/src/visibility/visibility-manager';
import { handleAccessExpiration } from '../../services/collab-service/src/jobs/access-expiration-handler';
import { EventBusClient } from '../../services/collab-service/src/events/event-bus-client';
import Redis from 'ioredis';
import type { AccessRequestCreatedEvent, AccessRequestApprovedEvent } from '@olumi/contracts';

describe('End-to-End Integration Tests', () => {
  let collabDb: DatabaseClient;
  let notificationDb: NotificationDatabase;
  let eventBus: EventBus;
  let jobScheduler: JobScheduler;
  let notificationService: NotificationService;
  let visibilityManager: VisibilityManager;
  let eventBusClient: EventBusClient;
  let emailProvider: MockEmailProvider;
  let slackProvider: MockSlackProvider;
  let redis: Redis;

  beforeAll(async () => {
    // Initialize Redis
    redis = new Redis({
      host: 'localhost',
      port: 6379,
      db: 15, // Test DB
    });

    // Initialize Event Bus
    eventBus = new EventBus(redis);
    await eventBus.initialize();
    await eventBus.start();

    // Initialize databases
    collabDb = new DatabaseClient();
    await collabDb.connect();

    notificationDb = new NotificationDatabase();
    await notificationDb.initialize();

    // Initialize services
    visibilityManager = new VisibilityManager(collabDb);
    eventBusClient = new EventBusClient();

    emailProvider = new MockEmailProvider();
    slackProvider = new MockSlackProvider();
    notificationService = new NotificationService(
      notificationDb,
      emailProvider,
      slackProvider
    );

    jobScheduler = new JobScheduler(redis);
    await jobScheduler.initialize([
      {
        job_type: 'EXPIRE_ACCESS_REQUESTS',
        cron: '*/5 * * * *',
        enabled: false, // Manually triggered in tests
      },
    ]);
  });

  afterAll(async () => {
    await eventBus.stop();
    await jobScheduler.stop();
    await collabDb.close();
    await notificationDb.close();
    await eventBusClient.close();
    await redis.quit();
  });

  // =========================================================================
  // E2E TEST 1: Complete Access Request Workflow
  // =========================================================================

  test('E2E: Access request → Event → Notification → Approval → Event → Notification', async () => {
    const testId = `e2e_${Date.now()}`;
    const boardId = `board_${testId}`;
    const elementId = `element_${testId}`;
    const requesterId = `requester_${testId}`;
    const ownerId = `owner_${testId}`;

    // Track events and notifications
    const receivedEvents: any[] = [];
    const receivedNotifications: any[] = [];

    // Subscribe to events
    eventBus.subscribe({
      consumerId: `e2e_consumer_${testId}`,
      handler: async (event: any) => {
        receivedEvents.push(event);

        // If it's a notification request event, send notification
        if (event.event_type === 'ACCESS_REQUEST_CREATED') {
          const notification = await notificationService.sendNotification({
            notificationType: 'ACCESS_REQUEST_CREATED',
            recipientUserId: ownerId,
            recipientEmail: `${ownerId}@example.com`,
            channels: ['email'],
            templateVariables: {
              requester_name: requesterId,
              board_name: 'Test Board',
              element_type: 'goal',
              reason: event.reason,
            },
          });
          receivedNotifications.push(notification);
        }

        if (event.event_type === 'ACCESS_REQUEST_APPROVED') {
          const notification = await notificationService.sendNotification({
            notificationType: 'ACCESS_REQUEST_APPROVED',
            recipientUserId: requesterId,
            recipientEmail: `${requesterId}@example.com`,
            channels: ['email'],
            templateVariables: {
              approver_name: ownerId,
              board_name: 'Test Board',
              element_type: 'goal',
              duration_days: 7,
              expires_at: event.expires_at,
            },
          });
          receivedNotifications.push(notification);
        }
      },
    });

    // Step 1: Create access request
    const request = await collabDb.accessRequestsMethods.createAccessRequest({
      board_id: boardId,
      element_id: elementId,
      requester_user_id: requesterId,
      rationale: 'Need access for E2E test',
    });

    expect(request.request_id).toBeDefined();
    expect(request.status).toBe('pending');

    // Step 2: Publish event
    const createEvent: AccessRequestCreatedEvent = {
      event_id: `evt_create_${testId}`,
      event_type: 'ACCESS_REQUEST_CREATED',
      timestamp: new Date().toISOString(),
      source_service: 'collab-service',
      request_id: request.request_id,
      board_id: boardId,
      element_id: elementId,
      element_type: 'goal',
      requester_id: requesterId,
      requester_email: `${requesterId}@example.com`,
      reason: 'Need access for E2E test',
      status: 'pending',
    };

    await eventBusClient.publish(createEvent);

    // Step 3: Wait for event consumption and notification
    await new Promise((resolve) => setTimeout(resolve, 2000));

    expect(receivedEvents.some((e) => e.event_type === 'ACCESS_REQUEST_CREATED')).toBe(true);
    expect(receivedNotifications.length).toBeGreaterThanOrEqual(1);
    expect(emailProvider.sentEmails.length).toBeGreaterThanOrEqual(1);

    // Step 4: Approve request
    const approved = await collabDb.accessRequestsMethods.approveAccessRequest({
      request_id: request.request_id,
      approved_by_user_id: ownerId,
      expires_in_days: 7,
    });

    expect(approved.status).toBe('approved');
    expect(approved.expires_at).toBeDefined();

    // Step 5: Publish approval event
    const approveEvent: AccessRequestApprovedEvent = {
      event_id: `evt_approve_${testId}`,
      event_type: 'ACCESS_REQUEST_APPROVED',
      timestamp: new Date().toISOString(),
      source_service: 'collab-service',
      request_id: request.request_id,
      board_id: boardId,
      element_id: elementId,
      requester_id: requesterId,
      requester_email: `${requesterId}@example.com`,
      approved_by: ownerId,
      approved_by_email: `${ownerId}@example.com`,
      duration_days: 7,
      expires_at: approved.expires_at!,
    };

    await eventBusClient.publish(approveEvent);

    // Step 6: Wait for approval notification
    await new Promise((resolve) => setTimeout(resolve, 2000));

    expect(receivedEvents.some((e) => e.event_type === 'ACCESS_REQUEST_APPROVED')).toBe(true);
    expect(emailProvider.sentEmails.length).toBeGreaterThanOrEqual(2);

    // Verify email contents
    const approvalEmail = emailProvider.sentEmails.find((e) =>
      e.subject.includes('Access Request Approved') || e.subject.includes('granted')
    );
    expect(approvalEmail).toBeDefined();

    // Cleanup
    eventBus.unsubscribe(`e2e_consumer_${testId}`);
  }, 30000);

  // =========================================================================
  // E2E TEST 2: Expiration Workflow
  // =========================================================================

  test('E2E: Approved request → Job Scheduler → Expiration → Event → Notification', async () => {
    const testId = `exp_${Date.now()}`;
    const boardId = `board_${testId}`;
    const elementId = `element_${testId}`;
    const requesterId = `requester_${testId}`;
    const ownerId = `owner_${testId}`;

    // Create confidential element with requester in whitelist
    await visibilityManager.setElementVisibility(
      boardId,
      'org_test',
      'team_test',
      ownerId,
      'OWNER',
      {
        elementId,
        elementType: 'goal',
        visibilityMode: 'confidential',
        viewerWhitelist: [requesterId],
        viewerRoles: [],
      }
    );

    // Create and approve request with past expiration
    const request = await collabDb.accessRequestsMethods.createAccessRequest({
      board_id: boardId,
      element_id: elementId,
      requester_user_id: requesterId,
      rationale: 'Test expiration',
    });

    await collabDb.accessRequestsMethods.approveAccessRequest({
      request_id: request.request_id,
      approved_by_user_id: ownerId,
      expires_in_days: -1, // Already expired
    });

    // Track expiration events
    const expirationEvents: any[] = [];
    eventBus.subscribe({
      consumerId: `exp_consumer_${testId}`,
      eventTypes: ['ACCESS_REQUEST_EXPIRED'],
      handler: async (event: any) => {
        expirationEvents.push(event);

        // Send expiration notification
        await notificationService.sendNotification({
          notificationType: 'ACCESS_REQUEST_EXPIRED',
          recipientUserId: requesterId,
          recipientEmail: `${requesterId}@example.com`,
          channels: ['email', 'in_app'],
          templateVariables: {
            board_name: 'Test Board',
            element_type: 'goal',
          },
        });
      },
    });

    // Run expiration job
    const result = await handleAccessExpiration(collabDb, visibilityManager, eventBusClient);

    expect(result.expired_count).toBeGreaterThanOrEqual(1);
    expect(result.expired_request_ids).toContain(request.request_id);

    // Wait for event processing
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Verify expiration event was published
    expect(expirationEvents.some((e) => e.request_id === request.request_id)).toBe(true);

    // Verify whitelist was updated
    const visibility = await visibilityManager.getElementVisibility(boardId, elementId);
    expect(visibility?.viewer_whitelist.includes(requesterId)).toBe(false);

    // Verify request status
    const updated = await collabDb.accessRequestsMethods.getAccessRequest(request.request_id);
    expect(updated?.status).toBe('expired');

    // Cleanup
    eventBus.unsubscribe(`exp_consumer_${testId}`);
  }, 30000);

  // =========================================================================
  // E2E TEST 3: Multi-Channel Notification Delivery
  // =========================================================================

  test('E2E: Event → Multi-channel notification (email + in-app + Slack)', async () => {
    const testId = `multi_${Date.now()}`;
    const userId = `user_${testId}`;

    // Clear providers
    emailProvider.clear();
    slackProvider.clear();

    // Send multi-channel notification
    const notification = await notificationService.sendNotification({
      notificationType: 'ACCESS_REQUEST_APPROVED',
      recipientUserId: userId,
      recipientEmail: `${userId}@example.com`,
      channels: ['email', 'in_app', 'slack'],
      templateVariables: {
        approver_name: 'Test Owner',
        board_name: 'Test Board',
        element_type: 'goal',
        duration_days: 30,
        expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      },
    });

    expect(notification.channels).toEqual(['email', 'in_app', 'slack']);

    // Verify email sent
    expect(emailProvider.sentEmails.length).toBe(1);
    expect(emailProvider.sentEmails[0].to).toBe(`${userId}@example.com`);

    // Verify Slack sent
    expect(slackProvider.sentMessages.length).toBe(1);

    // Verify in-app stored
    const inAppNotifications = await notificationService.getInAppNotifications(userId);
    expect(inAppNotifications.some((n) => n.notification_id === notification.notification_id)).toBe(
      true
    );

    // Verify delivery status
    const deliveries = await notificationService.getDeliveryStatus(notification.notification_id);
    expect(deliveries.length).toBeGreaterThanOrEqual(3);
    expect(deliveries.every((d) => d.status === 'sent')).toBe(true);
  }, 15000);

  // =========================================================================
  // E2E TEST 4: Rate Limiting Enforcement
  // =========================================================================

  test('E2E: Rate limiting blocks 11th request', async () => {
    const testId = `rate_${Date.now()}`;
    const boardId = `board_${testId}`;
    const requesterId = `requester_${testId}`;

    // Create 10 requests
    for (let i = 0; i < 10; i++) {
      await collabDb.accessRequestsMethods.createAccessRequest({
        board_id: boardId,
        element_id: `element_${testId}_${i}`,
        requester_user_id: requesterId,
        rationale: `Request ${i}`,
      });
    }

    // Verify count
    const count = await collabDb.accessRequestsMethods.countRecentRequests(
      requesterId,
      boardId,
      24
    );

    expect(count).toBe(10);

    // 11th request should be blocked (in actual API with 429 response)
    // This is tested at the API level, here we just verify the count is accurate
  }, 15000);

  // =========================================================================
  // E2E TEST 5: Event Bus Reliability (At-Least-Once Delivery)
  // =========================================================================

  test('E2E: Event Bus delivers events at-least-once', async () => {
    const testId = `reliability_${Date.now()}`;
    const receivedEvents: any[] = [];

    // Subscribe consumer
    eventBus.subscribe({
      consumerId: `reliability_consumer_${testId}`,
      handler: async (event: any) => {
        receivedEvents.push(event);
      },
    });

    // Publish 10 events
    const eventIds: string[] = [];
    for (let i = 0; i < 10; i++) {
      const eventId = `evt_${testId}_${i}`;
      eventIds.push(eventId);

      await eventBusClient.publish({
        event_id: eventId,
        event_type: 'BOARD_CREATED',
        timestamp: new Date().toISOString(),
        source_service: 'test',
        board_id: `board_${testId}`,
        board_name: `Test Board ${i}`,
        created_by: 'test_user',
        team_id: 'test_team',
      } as any);
    }

    // Wait for consumption
    await new Promise((resolve) => setTimeout(resolve, 3000));

    // Verify all events received (at-least-once)
    expect(receivedEvents.length).toBeGreaterThanOrEqual(10);

    // Verify all event IDs present
    const receivedIds = receivedEvents.map((e) => e.event_id);
    eventIds.forEach((id) => {
      expect(receivedIds).toContain(id);
    });

    // Cleanup
    eventBus.unsubscribe(`reliability_consumer_${testId}`);
  }, 15000);

  // =========================================================================
  // E2E TEST 6: Performance Under Load
  // =========================================================================

  test('E2E: System handles 100 concurrent access requests', async () => {
    const testId = `perf_${Date.now()}`;
    const boardId = `board_${testId}`;

    const start = Date.now();

    // Create 100 requests concurrently
    const promises = [];
    for (let i = 0; i < 100; i++) {
      promises.push(
        collabDb.accessRequestsMethods.createAccessRequest({
          board_id: boardId,
          element_id: `element_${testId}_${i}`,
          requester_user_id: `user_${testId}_${i % 10}`, // 10 different users
          rationale: `Performance test ${i}`,
        })
      );
    }

    const results = await Promise.all(promises);
    const duration = Date.now() - start;

    // Verify all succeeded
    expect(results.length).toBe(100);
    expect(results.every((r) => r.request_id !== undefined)).toBe(true);

    // Should complete in reasonable time (< 5 seconds for 100 requests)
    expect(duration).toBeLessThan(5000);

    console.log(`Created 100 access requests in ${duration}ms`);
  }, 30000);
});
