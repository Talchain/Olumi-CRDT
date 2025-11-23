/**
 * Event Bus Client for Collab Service
 * Publishes events to the centralized Event Bus service
 */

import Redis from 'ioredis';
import { randomUUID } from 'crypto';
import { pino } from 'pino';
import { config } from '../config';
import type { OlumiEvent } from '@olumi/contracts';

const logger = pino({ level: config.logging.level });

export class EventBusClient {
  private redis: Redis;
  private streamName: string;

  constructor() {
    this.streamName = process.env.EVENT_BUS_STREAM || 'olumi:events';

    this.redis = new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379', 10),
      password: process.env.REDIS_PASSWORD || undefined,
      db: parseInt(process.env.REDIS_DB || '0', 10),
      retryStrategy: (times: number) => {
        const delay = Math.min(times * 50, 2000);
        return delay;
      },
    });

    this.redis.on('error', (err) => {
      logger.error({ err }, 'Event Bus Redis connection error');
    });

    this.redis.on('connect', () => {
      logger.info('Event Bus Redis connected');
    });
  }

  /**
   * Publish an event to the Event Bus
   */
  async publish(event: Partial<OlumiEvent>): Promise<string> {
    const eventId = event.event_id || randomUUID();
    const timestamp = event.timestamp || new Date().toISOString();

    const fullEvent: OlumiEvent = {
      ...event,
      event_id: eventId,
      timestamp,
      source_service: 'collab-service',
    } as OlumiEvent;

    try {
      const messageId = await this.redis.xadd(
        this.streamName,
        '*',
        'event_type',
        fullEvent.event_type,
        'event_data',
        JSON.stringify(fullEvent)
      );

      logger.debug(
        {
          eventId,
          eventType: fullEvent.event_type,
          messageId,
        },
        'Event published to Event Bus'
      );

      return messageId || '';
    } catch (err) {
      logger.error({ err, event: fullEvent }, 'Failed to publish event to Event Bus');
      // Don't throw - events are fire-and-forget
      return '';
    }
  }

  /**
   * Close connection
   */
  async close(): Promise<void> {
    await this.redis.quit();
    logger.info('Event Bus client closed');
  }
}
