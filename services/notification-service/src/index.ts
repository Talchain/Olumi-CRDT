/**
 * Notification Service Entry Point
 */

import Redis from 'ioredis';
import { NotificationDatabase } from './database';
import { NotificationService } from './notification-service';
import { createEmailProvider } from './providers/email';
import { createSlackProvider } from './providers/slack';
import { createServer } from './server';
import { config } from './config';
import { createLogger } from '@olumi/telemetry';

const logger = createLogger({
  serviceName: config.service.name,
  level: config.logging.level,
  pretty: config.logging.pretty,
});

async function main() {
  logger.info(
    {
      service: config.service.name,
      port: config.service.port,
      env: config.service.env,
    },
    'Starting Notification Service'
  );

  // Initialize database
  const database = new NotificationDatabase();
  await database.initialize();

  // Create providers
  const emailProvider = createEmailProvider();
  const slackProvider = createSlackProvider();

  // Create notification service
  const notificationService = new NotificationService(
    database,
    emailProvider,
    slackProvider
  );

  // Create Event Bus client for consuming events
  const redis = new Redis({
    host: config.redis.host,
    port: config.redis.port,
    password: config.redis.password,
    db: config.redis.db,
  });

  // Subscribe to notification events from Event Bus
  // Note: This would integrate with the EventBus service created earlier
  // For now, we're setting up the infrastructure

  logger.info('Notification service ready to consume events');

  // Create HTTP server
  const app = createServer(notificationService);

  // Start HTTP server
  const server = app.listen(config.service.port, () => {
    logger.info(
      { port: config.service.port },
      'Notification Service HTTP server listening'
    );
  });

  // Graceful shutdown
  const shutdown = async () => {
    logger.info('Shutting down Notification Service');

    server.close(() => {
      logger.info('HTTP server closed');
    });

    await database.close();
    await redis.quit();

    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

// Start the service
main().catch((err) => {
  logger.fatal({ err }, 'Fatal error starting Notification Service');
  process.exit(1);
});

// Export for testing
export { NotificationService } from './notification-service';
export { NotificationDatabase } from './database';
export { createServer } from './server';
