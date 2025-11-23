/**
 * Event Bus using Redis Streams
 * Provides pub/sub functionality with at-least-once delivery guarantees
 */

import Redis from 'ioredis';
import { randomUUID } from 'crypto';
import { pino } from 'pino';
import { config } from './config';
import type { OlumiEvent, EventType } from '@olumi/contracts';

const logger = pino({ level: config.logging.level });

export interface EventHandler<T extends OlumiEvent = OlumiEvent> {
  (event: T): Promise<void>;
}

export interface ConsumerConfig {
  consumerId: string;
  eventTypes?: EventType[];
  handler: EventHandler;
  autoAck?: boolean;
}

export interface PublishOptions {
  correlationId?: string;
}

/**
 * EventBus provides Redis Streams-based event distribution
 */
export class EventBus {
  private redis: Redis;
  private consumers: Map<string, ConsumerConfig> = new Map();
  private running: boolean = false;
  private consumerLoops: Map<string, Promise<void>> = new Map();

  constructor(redisClient?: Redis) {
    this.redis = redisClient || new Redis({
      host: config.redis.host,
      port: config.redis.port,
      password: config.redis.password,
      db: config.redis.db,
      maxRetriesPerRequest: 3,
      retryStrategy: (times: number) => {
        const delay = Math.min(times * 50, 2000);
        return delay;
      },
    });

    this.redis.on('error', (err) => {
      logger.error({ err }, 'Redis connection error');
    });

    this.redis.on('connect', () => {
      logger.info('Connected to Redis');
    });
  }

  /**
   * Initialize the event bus (create stream and consumer group)
   */
  async initialize(): Promise<void> {
    try {
      // Create stream if it doesn't exist
      await this.redis.xgroup(
        'CREATE',
        config.streams.name,
        config.streams.consumerGroup,
        '0',
        'MKSTREAM'
      );
      logger.info(
        { stream: config.streams.name, group: config.streams.consumerGroup },
        'Consumer group created'
      );
    } catch (err: any) {
      if (err.message.includes('BUSYGROUP')) {
        logger.info('Consumer group already exists');
      } else {
        throw err;
      }
    }
  }

  /**
   * Publish an event to the event bus
   */
  async publish(event: OlumiEvent, options?: PublishOptions): Promise<string> {
    const eventId = event.event_id || randomUUID();
    const timestamp = event.timestamp || new Date().toISOString();

    const eventWithDefaults: OlumiEvent = {
      ...event,
      event_id: eventId,
      timestamp,
      correlation_id: options?.correlationId || event.correlation_id,
    };

    try {
      const messageId = await this.redis.xadd(
        config.streams.name,
        '*',
        'event_type', event.event_type,
        'event_data', JSON.stringify(eventWithDefaults)
      );

      logger.info(
        {
          eventId,
          eventType: event.event_type,
          messageId,
          correlationId: eventWithDefaults.correlation_id,
        },
        'Event published'
      );

      return messageId;
    } catch (err) {
      logger.error({ err, event }, 'Failed to publish event');
      throw new Error('Failed to publish event');
    }
  }

  /**
   * Subscribe to events with a consumer
   */
  subscribe(consumerConfig: ConsumerConfig): void {
    const { consumerId, eventTypes, handler } = consumerConfig;

    if (this.consumers.has(consumerId)) {
      throw new Error(`Consumer ${consumerId} already exists`);
    }

    this.consumers.set(consumerId, consumerConfig);

    logger.info(
      { consumerId, eventTypes: eventTypes || 'ALL' },
      'Consumer registered'
    );

    // Start consuming if already running
    if (this.running) {
      this.startConsumer(consumerId);
    }
  }

  /**
   * Unsubscribe a consumer
   */
  unsubscribe(consumerId: string): void {
    this.consumers.delete(consumerId);
    logger.info({ consumerId }, 'Consumer unregistered');
  }

  /**
   * Start consuming events
   */
  async start(): Promise<void> {
    if (this.running) {
      logger.warn('Event bus already running');
      return;
    }

    this.running = true;
    logger.info('Starting event bus consumers');

    // Start all registered consumers
    for (const consumerId of this.consumers.keys()) {
      this.startConsumer(consumerId);
    }
  }

  /**
   * Stop consuming events
   */
  async stop(): Promise<void> {
    if (!this.running) {
      return;
    }

    this.running = false;
    logger.info('Stopping event bus consumers');

    // Wait for all consumer loops to finish
    await Promise.all(this.consumerLoops.values());
    this.consumerLoops.clear();

    await this.redis.quit();
    logger.info('Event bus stopped');
  }

  /**
   * Acknowledge a message
   */
  async ack(messageId: string): Promise<void> {
    await this.redis.xack(
      config.streams.name,
      config.streams.consumerGroup,
      messageId
    );
  }

  /**
   * Get pending messages for a consumer
   */
  async getPendingMessages(consumerId: string): Promise<any[]> {
    const pending = await this.redis.xpending(
      config.streams.name,
      config.streams.consumerGroup,
      '-',
      '+',
      10,
      consumerId
    );

    return pending;
  }

  /**
   * Get stream info
   */
  async getStreamInfo(): Promise<{
    length: number;
    groups: number;
    lastId: string;
  }> {
    const info = await this.redis.xinfo('STREAM', config.streams.name);

    // Parse Redis array response
    const infoObj: any = {};
    for (let i = 0; i < info.length; i += 2) {
      infoObj[info[i]] = info[i + 1];
    }

    return {
      length: infoObj.length || 0,
      groups: infoObj.groups || 0,
      lastId: infoObj['last-generated-id'] || '0-0',
    };
  }

  /**
   * Start a single consumer
   */
  private startConsumer(consumerId: string): void {
    const consumerLoop = this.runConsumerLoop(consumerId);
    this.consumerLoops.set(consumerId, consumerLoop);
  }

  /**
   * Run consumer loop
   */
  private async runConsumerLoop(consumerId: string): Promise<void> {
    const consumerConfig = this.consumers.get(consumerId);
    if (!consumerConfig) {
      return;
    }

    const { eventTypes, handler, autoAck = true } = consumerConfig;

    logger.info({ consumerId }, 'Starting consumer loop');

    while (this.running) {
      try {
        // Read messages from stream
        const messages = await this.redis.xreadgroup(
          'GROUP',
          config.streams.consumerGroup,
          consumerId,
          'COUNT',
          config.streams.batchSize,
          'BLOCK',
          config.streams.blockTime,
          'STREAMS',
          config.streams.name,
          '>'
        );

        if (!messages || messages.length === 0) {
          continue;
        }

        // Process messages
        for (const [stream, streamMessages] of messages) {
          for (const [messageId, fields] of streamMessages) {
            await this.processMessage(
              consumerId,
              messageId,
              fields,
              eventTypes,
              handler,
              autoAck
            );
          }
        }
      } catch (err: any) {
        if (this.running) {
          logger.error({ err, consumerId }, 'Error in consumer loop');
          // Brief delay before retrying
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
      }
    }

    logger.info({ consumerId }, 'Consumer loop stopped');
  }

  /**
   * Process a single message
   */
  private async processMessage(
    consumerId: string,
    messageId: string,
    fields: string[],
    eventTypes: EventType[] | undefined,
    handler: EventHandler,
    autoAck: boolean
  ): Promise<void> {
    try {
      // Parse message fields (Redis returns array: [key1, value1, key2, value2, ...])
      const fieldsObj: Record<string, string> = {};
      for (let i = 0; i < fields.length; i += 2) {
        fieldsObj[fields[i]] = fields[i + 1];
      }

      const eventType = fieldsObj.event_type;
      const eventData = JSON.parse(fieldsObj.event_data);

      // Filter by event type if specified
      if (eventTypes && !eventTypes.includes(eventType as EventType)) {
        // Ack and skip
        if (autoAck) {
          await this.ack(messageId);
        }
        return;
      }

      logger.debug(
        { consumerId, messageId, eventType },
        'Processing message'
      );

      // Call handler
      await handler(eventData);

      // Auto-acknowledge if enabled
      if (autoAck) {
        await this.ack(messageId);
      }

      logger.debug(
        { consumerId, messageId, eventType },
        'Message processed successfully'
      );
    } catch (err) {
      logger.error(
        { err, consumerId, messageId },
        'Error processing message'
      );
      // Message will remain in pending list for retry
    }
  }

  /**
   * Health check
   */
  async healthCheck(): Promise<{ healthy: boolean; redis: string }> {
    try {
      await this.redis.ping();
      return { healthy: true, redis: 'connected' };
    } catch (err) {
      return { healthy: false, redis: 'disconnected' };
    }
  }
}
