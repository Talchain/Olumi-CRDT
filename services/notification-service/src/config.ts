/**
 * Notification Service Configuration
 */

import dotenv from 'dotenv';

dotenv.config();

export const config = {
  service: {
    name: 'notification-service',
    port: parseInt(process.env.PORT || '3003', 10),
    env: process.env.NODE_ENV || 'development',
  },
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    password: process.env.REDIS_PASSWORD || undefined,
    db: parseInt(process.env.REDIS_DB || '0', 10),
  },
  postgres: {
    host: process.env.POSTGRES_HOST || 'localhost',
    port: parseInt(process.env.POSTGRES_PORT || '5432', 10),
    database: process.env.POSTGRES_DB || 'olumi_notifications',
    user: process.env.POSTGRES_USER || 'postgres',
    password: process.env.POSTGRES_PASSWORD || 'postgres',
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
  },
  eventBus: {
    streamName: process.env.STREAM_NAME || 'olumi:events',
    consumerGroup: process.env.CONSUMER_GROUP || 'notification-service-consumers',
    consumerId: process.env.CONSUMER_ID || 'notification-service-1',
  },
  email: {
    provider: (process.env.EMAIL_PROVIDER as 'brevo' | 'sendgrid' | 'smtp') || 'brevo',
    apiKey: process.env.EMAIL_API_KEY || '',
    fromAddress: process.env.EMAIL_FROM_ADDRESS || 'noreply@olumi.com',
    fromName: process.env.EMAIL_FROM_NAME || 'Olumi',
    replyTo: process.env.EMAIL_REPLY_TO || 'support@olumi.com',
  },
  slack: {
    webhookUrl: process.env.SLACK_WEBHOOK_URL,
    botToken: process.env.SLACK_BOT_TOKEN,
    defaultChannel: process.env.SLACK_DEFAULT_CHANNEL || '#notifications',
  },
  logging: {
    level: process.env.LOG_LEVEL || 'info',
    pretty: process.env.LOG_PRETTY === 'true',
  },
  metrics: {
    enabled: process.env.METRICS_ENABLED !== 'false',
  },
};
