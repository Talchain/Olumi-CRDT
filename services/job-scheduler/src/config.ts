/**
 * Job Scheduler Service Configuration
 */

import dotenv from 'dotenv';
import { DEFAULT_JOB_SCHEDULES, JobSchedule } from '@olumi/contracts';

dotenv.config();

export const config = {
  service: {
    name: 'job-scheduler',
    port: parseInt(process.env.PORT || '3002', 10),
    env: process.env.NODE_ENV || 'development',
  },
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    password: process.env.REDIS_PASSWORD || undefined,
    db: parseInt(process.env.REDIS_DB || '0', 10),
  },
  bullmq: {
    queueNamePrefix: process.env.QUEUE_NAME_PREFIX || 'olumi:jobs',
    concurrency: parseInt(process.env.CONCURRENCY || '5', 10),
    defaultJobOptions: {
      attempts: 3,
      backoff: {
        type: 'exponential' as const,
        delay: 1000,
      },
      removeOnComplete: {
        age: 86400, // Keep completed jobs for 24 hours
        count: 1000, // Keep max 1000 completed jobs
      },
      removeOnFail: {
        age: 604800, // Keep failed jobs for 7 days
      },
    },
  },
  logging: {
    level: process.env.LOG_LEVEL || 'info',
    pretty: process.env.LOG_PRETTY === 'true',
  },
  metrics: {
    enabled: process.env.METRICS_ENABLED !== 'false',
  },
  jobs: {
    schedules: getJobSchedules(),
  },
};

/**
 * Get job schedules from environment or use defaults
 */
function getJobSchedules(): JobSchedule[] {
  return DEFAULT_JOB_SCHEDULES.map((schedule) => {
    const envKey = `${schedule.job_type}_CRON`;
    const cronOverride = process.env[envKey];

    return {
      ...schedule,
      cron: cronOverride || schedule.cron,
    };
  });
}
