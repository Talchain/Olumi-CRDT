/**
 * Event Bus Service Entry Point
 */

import { EventBus } from './event-bus';
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
      redis: `${config.redis.host}:${config.redis.port}`,
    },
    'Starting Event Bus service'
  );

  // Create event bus
  const eventBus = new EventBus();

  // Initialize event bus
  await eventBus.initialize();

  // Start consuming events
  await eventBus.start();

  // Create HTTP server
  const app = createServer(eventBus);

  // Start HTTP server
  const server = app.listen(config.service.port, () => {
    logger.info(
      { port: config.service.port },
      'Event Bus HTTP server listening'
    );
  });

  // Graceful shutdown
  const shutdown = async () => {
    logger.info('Shutting down Event Bus service');

    server.close(() => {
      logger.info('HTTP server closed');
    });

    await eventBus.stop();

    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

// Start the service
main().catch((err) => {
  logger.fatal({ err }, 'Fatal error starting Event Bus service');
  process.exit(1);
});

// Export for testing
export { EventBus } from './event-bus';
export { createServer } from './server';
