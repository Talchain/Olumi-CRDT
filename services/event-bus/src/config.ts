/**
 * Event Bus Service Configuration
 */

import dotenv from 'dotenv';

dotenv.config();

export const config = {
  service: {
    name: 'event-bus',
    port: parseInt(process.env.PORT || '3001', 10),
    env: process.env.NODE_ENV || 'development',
  },
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    password: process.env.REDIS_PASSWORD || undefined,
    db: parseInt(process.env.REDIS_DB || '0', 10),
  },
  streams: {
    name: process.env.STREAM_NAME || 'olumi:events',
    consumerGroup: process.env.CONSUMER_GROUP || 'event-bus-consumers',
    maxRetries: 3,
    blockTime: 5000, // 5 seconds
    batchSize: 10,
  },
  logging: {
    level: process.env.LOG_LEVEL || 'info',
    pretty: process.env.LOG_PRETTY === 'true',
  },
  metrics: {
    enabled: process.env.METRICS_ENABLED !== 'false',
  },
};
