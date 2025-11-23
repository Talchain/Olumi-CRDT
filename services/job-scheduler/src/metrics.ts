/**
 * Job Scheduler Metrics
 */

import { createCounter, createHistogram, createGauge } from '@olumi/telemetry';

/**
 * Jobs scheduled total
 */
export const jobsScheduledTotal = createCounter({
  name: 'job_scheduler_jobs_scheduled_total',
  help: 'Total number of jobs scheduled',
  labelNames: ['job_type'],
});

/**
 * Jobs completed total
 */
export const jobsCompletedTotal = createCounter({
  name: 'job_scheduler_jobs_completed_total',
  help: 'Total number of jobs completed',
  labelNames: ['job_type'],
});

/**
 * Jobs failed total
 */
export const jobsFailedTotal = createCounter({
  name: 'job_scheduler_jobs_failed_total',
  help: 'Total number of jobs failed',
  labelNames: ['job_type'],
});

/**
 * Job execution duration
 */
export const jobExecutionDuration = createHistogram({
  name: 'job_scheduler_job_execution_duration_seconds',
  help: 'Job execution duration in seconds',
  labelNames: ['job_type'],
  buckets: [0.01, 0.05, 0.1, 0.5, 1, 5, 10, 30, 60],
});

/**
 * Queue size (waiting jobs)
 */
export const queueSize = createGauge({
  name: 'job_scheduler_queue_size',
  help: 'Number of jobs waiting in queue',
  labelNames: ['job_type'],
});

/**
 * Active jobs
 */
export const activeJobs = createGauge({
  name: 'job_scheduler_active_jobs',
  help: 'Number of jobs currently being processed',
  labelNames: ['job_type'],
});

/**
 * Failed jobs (not yet retried or removed)
 */
export const failedJobs = createGauge({
  name: 'job_scheduler_failed_jobs',
  help: 'Number of failed jobs',
  labelNames: ['job_type'],
});
