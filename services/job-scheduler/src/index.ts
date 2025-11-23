/**
 * Job Scheduler Service Entry Point
 */

import { JobScheduler } from './job-scheduler';
import { createServer } from './server';
import { config } from './config';
import { createLogger } from '@olumi/telemetry';
import * as workers from './workers';

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
    'Starting Job Scheduler service'
  );

  // Create job scheduler
  const jobScheduler = new JobScheduler();

  // Initialize with schedules
  await jobScheduler.initialize(config.jobs.schedules);

  // Register workers
  jobScheduler.registerWorker({
    jobType: 'EXPIRE_ACCESS_REQUESTS',
    handler: workers.expireAccessRequestsWorker,
  });

  jobScheduler.registerWorker({
    jobType: 'NOTIFY_EXPIRING_ACCESS',
    handler: workers.notifyExpiringAccessWorker,
  });

  jobScheduler.registerWorker({
    jobType: 'CLEANUP_OLD_AUDIT_LOGS',
    handler: workers.cleanupOldAuditLogsWorker,
  });

  jobScheduler.registerWorker({
    jobType: 'CLEANUP_EXPIRED_SESSIONS',
    handler: workers.cleanupExpiredSessionsWorker,
  });

  jobScheduler.registerWorker({
    jobType: 'GENERATE_DAILY_ANALYTICS',
    handler: workers.generateDailyAnalyticsWorker,
  });

  logger.info('All workers registered');

  // Create HTTP server
  const app = createServer(jobScheduler);

  // Start HTTP server
  const server = app.listen(config.service.port, () => {
    logger.info(
      { port: config.service.port },
      'Job Scheduler HTTP server listening'
    );
  });

  // Graceful shutdown
  const shutdown = async () => {
    logger.info('Shutting down Job Scheduler service');

    server.close(() => {
      logger.info('HTTP server closed');
    });

    await jobScheduler.stop();

    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

// Start the service
main().catch((err) => {
  logger.fatal({ err }, 'Fatal error starting Job Scheduler service');
  process.exit(1);
});

// Export for testing
export { JobScheduler } from './job-scheduler';
export { createServer } from './server';
