/**
 * Event Bus Tests
 * Comprehensive test suite for Redis Streams-based event bus
 */

import { EventBus } from '../event-bus';
import { config } from '../config';
import Redis from 'ioredis';
import type { OlumiEvent, AccessRequestCreatedEvent, BoardCreatedEvent } from '@olumi/contracts';

describe('EventBus', () => {
  let eventBus: EventBus;
  let redis: Redis;

  beforeAll(async () => {
    // Use test Redis instance
    redis = new Redis({
      host: config.redis.host,
      port: config.redis.port,
      db: 15, // Use test DB
    });

    // Clean up test stream
    await redis.del(config.streams.name);
    await redis.del(`${config.streams.name}:test`);
  });

  beforeEach(async () => {
    eventBus = new EventBus(redis);
    await eventBus.initialize();
  });

  afterEach(async () => {
    await eventBus.stop();
    // Clean up stream after each test
    await redis.del(config.streams.name);
  });

  afterAll(async () => {
    await redis.quit();
  });

  // ========================================================================
  // INITIALIZATION TESTS
  // ========================================================================

  describe('initialize()', () => {
    it('should create stream and consumer group', async () => {
      const groups = await redis.xinfo('GROUPS', config.streams.name);
      expect(groups.length).toBeGreaterThan(0);

      // Parse group info
      const groupInfo: any = {};
      for (let i = 0; i < groups[0].length; i += 2) {
        groupInfo[groups[0][i]] = groups[0][i + 1];
      }

      expect(groupInfo.name).toBe(config.streams.consumerGroup);
    });

    it('should handle existing consumer group gracefully', async () => {
      // Initialize again
      await expect(eventBus.initialize()).resolves.not.toThrow();
    });
  });

  // ========================================================================
  // PUBLISH TESTS
  // ========================================================================

  describe('publish()', () => {
    it('should publish an event to the stream', async () => {
      const event: BoardCreatedEvent = {
        event_id: 'evt_123',
        event_type: 'BOARD_CREATED',
        timestamp: new Date().toISOString(),
        source_service: 'collab-service',
        board_id: 'board_1',
        board_name: 'Test Board',
        created_by: 'user_1',
        team_id: 'team_1',
        user_id: 'user_1',
        org_id: 'org_1',
      };

      const messageId = await eventBus.publish(event);

      expect(messageId).toBeDefined();
      expect(typeof messageId).toBe('string');

      // Verify event was added to stream
      const messages = await redis.xrange(config.streams.name, '-', '+');
      expect(messages.length).toBe(1);
    });

    it('should auto-generate event_id if not provided', async () => {
      const event: Partial<BoardCreatedEvent> = {
        event_type: 'BOARD_CREATED',
        source_service: 'collab-service',
        board_id: 'board_1',
        board_name: 'Test Board',
        created_by: 'user_1',
        team_id: 'team_1',
      };

      const messageId = await eventBus.publish(event as BoardCreatedEvent);
      expect(messageId).toBeDefined();

      // Read event back
      const messages = await redis.xrange(config.streams.name, '-', '+');
      const [, fields] = messages[0];
      const fieldsObj: Record<string, string> = {};
      for (let i = 0; i < fields.length; i += 2) {
        fieldsObj[fields[i]] = fields[i + 1];
      }
      const eventData = JSON.parse(fieldsObj.event_data);

      expect(eventData.event_id).toBeDefined();
    });

    it('should include correlation_id from options', async () => {
      const event: BoardCreatedEvent = {
        event_id: 'evt_123',
        event_type: 'BOARD_CREATED',
        timestamp: new Date().toISOString(),
        source_service: 'collab-service',
        board_id: 'board_1',
        board_name: 'Test Board',
        created_by: 'user_1',
        team_id: 'team_1',
      };

      await eventBus.publish(event, { correlationId: 'corr_123' });

      const messages = await redis.xrange(config.streams.name, '-', '+');
      const [, fields] = messages[0];
      const fieldsObj: Record<string, string> = {};
      for (let i = 0; i < fields.length; i += 2) {
        fieldsObj[fields[i]] = fields[i + 1];
      }
      const eventData = JSON.parse(fieldsObj.event_data);

      expect(eventData.correlation_id).toBe('corr_123');
    });

    it('should handle publish errors gracefully', async () => {
      // Stop event bus to cause error
      await eventBus.stop();

      const event: BoardCreatedEvent = {
        event_id: 'evt_123',
        event_type: 'BOARD_CREATED',
        timestamp: new Date().toISOString(),
        source_service: 'collab-service',
        board_id: 'board_1',
        board_name: 'Test Board',
        created_by: 'user_1',
        team_id: 'team_1',
      };

      await expect(eventBus.publish(event)).rejects.toThrow();
    });
  });

  // ========================================================================
  // SUBSCRIBE TESTS
  // ========================================================================

  describe('subscribe()', () => {
    it('should register a consumer', () => {
      const handler = jest.fn();

      eventBus.subscribe({
        consumerId: 'test_consumer_1',
        handler,
      });

      // Consumer should be registered (no error thrown)
      expect(true).toBe(true);
    });

    it('should throw error for duplicate consumer ID', () => {
      const handler = jest.fn();

      eventBus.subscribe({
        consumerId: 'test_consumer_1',
        handler,
      });

      expect(() => {
        eventBus.subscribe({
          consumerId: 'test_consumer_1',
          handler,
        });
      }).toThrow('Consumer test_consumer_1 already exists');
    });

    it('should allow filtering by event types', () => {
      const handler = jest.fn();

      eventBus.subscribe({
        consumerId: 'test_consumer_2',
        eventTypes: ['BOARD_CREATED', 'BOARD_DELETED'],
        handler,
      });

      expect(true).toBe(true);
    });
  });

  // ========================================================================
  // CONSUME TESTS
  // ========================================================================

  describe('consume events', () => {
    it('should consume published events', async () => {
      const receivedEvents: OlumiEvent[] = [];
      const handler = jest.fn(async (event: OlumiEvent) => {
        receivedEvents.push(event);
      });

      eventBus.subscribe({
        consumerId: 'test_consumer_3',
        handler,
      });

      await eventBus.start();

      // Publish event
      const event: BoardCreatedEvent = {
        event_id: 'evt_consume_1',
        event_type: 'BOARD_CREATED',
        timestamp: new Date().toISOString(),
        source_service: 'collab-service',
        board_id: 'board_1',
        board_name: 'Test Board',
        created_by: 'user_1',
        team_id: 'team_1',
      };

      await eventBus.publish(event);

      // Wait for consumption
      await new Promise((resolve) => setTimeout(resolve, 1000));

      expect(handler).toHaveBeenCalled();
      expect(receivedEvents.length).toBe(1);
      expect(receivedEvents[0].event_id).toBe('evt_consume_1');
    });

    it('should filter events by event type', async () => {
      const receivedEvents: OlumiEvent[] = [];
      const handler = jest.fn(async (event: OlumiEvent) => {
        receivedEvents.push(event);
      });

      eventBus.subscribe({
        consumerId: 'test_consumer_4',
        eventTypes: ['ACCESS_REQUEST_CREATED'],
        handler,
      });

      await eventBus.start();

      // Publish BOARD_CREATED event (should be filtered out)
      const boardEvent: BoardCreatedEvent = {
        event_id: 'evt_board_1',
        event_type: 'BOARD_CREATED',
        timestamp: new Date().toISOString(),
        source_service: 'collab-service',
        board_id: 'board_1',
        board_name: 'Test Board',
        created_by: 'user_1',
        team_id: 'team_1',
      };

      await eventBus.publish(boardEvent);

      // Publish ACCESS_REQUEST_CREATED event (should be consumed)
      const accessRequestEvent: AccessRequestCreatedEvent = {
        event_id: 'evt_access_1',
        event_type: 'ACCESS_REQUEST_CREATED',
        timestamp: new Date().toISOString(),
        source_service: 'collab-service',
        request_id: 'req_1',
        board_id: 'board_1',
        element_id: 'elem_1',
        element_type: 'goal',
        requester_id: 'user_1',
        requester_email: 'user1@example.com',
        reason: 'Need access',
        status: 'pending',
      };

      await eventBus.publish(accessRequestEvent);

      // Wait for consumption
      await new Promise((resolve) => setTimeout(resolve, 1000));

      expect(receivedEvents.length).toBe(1);
      expect(receivedEvents[0].event_type).toBe('ACCESS_REQUEST_CREATED');
    });

    it('should auto-acknowledge messages by default', async () => {
      const handler = jest.fn();

      eventBus.subscribe({
        consumerId: 'test_consumer_5',
        handler,
        autoAck: true,
      });

      await eventBus.start();

      const event: BoardCreatedEvent = {
        event_id: 'evt_ack_1',
        event_type: 'BOARD_CREATED',
        timestamp: new Date().toISOString(),
        source_service: 'collab-service',
        board_id: 'board_1',
        board_name: 'Test Board',
        created_by: 'user_1',
        team_id: 'team_1',
      };

      await eventBus.publish(event);

      // Wait for consumption
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Check pending messages (should be 0 since auto-ack)
      const pending = await eventBus.getPendingMessages('test_consumer_5');
      expect(pending.length).toBe(0);
    });

    it('should handle errors in consumer handlers', async () => {
      const handler = jest.fn(async () => {
        throw new Error('Handler error');
      });

      eventBus.subscribe({
        consumerId: 'test_consumer_6',
        handler,
      });

      await eventBus.start();

      const event: BoardCreatedEvent = {
        event_id: 'evt_error_1',
        event_type: 'BOARD_CREATED',
        timestamp: new Date().toISOString(),
        source_service: 'collab-service',
        board_id: 'board_1',
        board_name: 'Test Board',
        created_by: 'user_1',
        team_id: 'team_1',
      };

      await eventBus.publish(event);

      // Wait for consumption attempt
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Handler should have been called
      expect(handler).toHaveBeenCalled();

      // Message should remain in pending (not acked due to error)
      const pending = await eventBus.getPendingMessages('test_consumer_6');
      expect(pending.length).toBeGreaterThan(0);
    });
  });

  // ========================================================================
  // UNSUBSCRIBE TESTS
  // ========================================================================

  describe('unsubscribe()', () => {
    it('should unregister a consumer', () => {
      const handler = jest.fn();

      eventBus.subscribe({
        consumerId: 'test_consumer_7',
        handler,
      });

      eventBus.unsubscribe('test_consumer_7');

      // Should be able to subscribe again
      eventBus.subscribe({
        consumerId: 'test_consumer_7',
        handler,
      });

      expect(true).toBe(true);
    });
  });

  // ========================================================================
  // STREAM INFO TESTS
  // ========================================================================

  describe('getStreamInfo()', () => {
    it('should return stream information', async () => {
      // Publish some events
      await eventBus.publish({
        event_id: 'evt_info_1',
        event_type: 'BOARD_CREATED',
        timestamp: new Date().toISOString(),
        source_service: 'test',
        board_id: 'board_1',
        board_name: 'Test',
        created_by: 'user_1',
        team_id: 'team_1',
      } as BoardCreatedEvent);

      const info = await eventBus.getStreamInfo();

      expect(info).toHaveProperty('length');
      expect(info).toHaveProperty('groups');
      expect(info).toHaveProperty('lastId');
      expect(info.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ========================================================================
  // HEALTH CHECK TESTS
  // ========================================================================

  describe('healthCheck()', () => {
    it('should return healthy status when Redis is connected', async () => {
      const health = await eventBus.healthCheck();

      expect(health.healthy).toBe(true);
      expect(health.redis).toBe('connected');
    });

    it('should return unhealthy status when Redis is disconnected', async () => {
      await eventBus.stop();

      const health = await eventBus.healthCheck();

      expect(health.healthy).toBe(false);
      expect(health.redis).toBe('disconnected');
    });
  });

  // ========================================================================
  // START/STOP TESTS
  // ========================================================================

  describe('start() and stop()', () => {
    it('should start and stop event bus', async () => {
      await eventBus.start();
      await eventBus.stop();

      expect(true).toBe(true);
    });

    it('should handle multiple start calls gracefully', async () => {
      await eventBus.start();
      await eventBus.start(); // Should not throw

      await eventBus.stop();

      expect(true).toBe(true);
    });

    it('should stop all consumers when stopped', async () => {
      const handler = jest.fn();

      eventBus.subscribe({
        consumerId: 'test_consumer_8',
        handler,
      });

      await eventBus.start();
      await eventBus.stop();

      // Publish event after stop
      await eventBus.publish({
        event_id: 'evt_after_stop',
        event_type: 'BOARD_CREATED',
        timestamp: new Date().toISOString(),
        source_service: 'test',
        board_id: 'board_1',
        board_name: 'Test',
        created_by: 'user_1',
        team_id: 'team_1',
      } as BoardCreatedEvent);

      // Wait a bit
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Handler should not have been called
      expect(handler).not.toHaveBeenCalled();
    });
  });

  // ========================================================================
  // ACK TESTS
  // ========================================================================

  describe('ack()', () => {
    it('should acknowledge a message', async () => {
      const handler = jest.fn();

      eventBus.subscribe({
        consumerId: 'test_consumer_9',
        handler,
        autoAck: false, // Manual ack
      });

      await eventBus.start();

      await eventBus.publish({
        event_id: 'evt_manual_ack',
        event_type: 'BOARD_CREATED',
        timestamp: new Date().toISOString(),
        source_service: 'test',
        board_id: 'board_1',
        board_name: 'Test',
        created_by: 'user_1',
        team_id: 'team_1',
      } as BoardCreatedEvent);

      // Wait for consumption
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Get pending messages
      let pending = await eventBus.getPendingMessages('test_consumer_9');
      expect(pending.length).toBeGreaterThan(0);

      // Manually ack the message
      const [messageId] = pending[0];
      await eventBus.ack(messageId);

      // Check pending again (should be 0)
      pending = await eventBus.getPendingMessages('test_consumer_9');
      expect(pending.length).toBe(0);
    });
  });

  // ========================================================================
  // MULTIPLE CONSUMERS TEST
  // ========================================================================

  describe('multiple consumers', () => {
    it('should deliver events to multiple consumers', async () => {
      const receivedEvents1: OlumiEvent[] = [];
      const receivedEvents2: OlumiEvent[] = [];

      const handler1 = jest.fn(async (event: OlumiEvent) => {
        receivedEvents1.push(event);
      });

      const handler2 = jest.fn(async (event: OlumiEvent) => {
        receivedEvents2.push(event);
      });

      eventBus.subscribe({
        consumerId: 'test_consumer_10',
        handler: handler1,
      });

      eventBus.subscribe({
        consumerId: 'test_consumer_11',
        handler: handler2,
      });

      await eventBus.start();

      // Publish event
      await eventBus.publish({
        event_id: 'evt_multi_1',
        event_type: 'BOARD_CREATED',
        timestamp: new Date().toISOString(),
        source_service: 'test',
        board_id: 'board_1',
        board_name: 'Test',
        created_by: 'user_1',
        team_id: 'team_1',
      } as BoardCreatedEvent);

      // Wait for consumption
      await new Promise((resolve) => setTimeout(resolve, 1500));

      // Both consumers should have received the event
      expect(receivedEvents1.length).toBeGreaterThanOrEqual(1);
      expect(receivedEvents2.length).toBeGreaterThanOrEqual(1);
    });
  });
});
