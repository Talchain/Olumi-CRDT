/**
 * Job Scheduler using BullMQ
 * Provides scheduled background job execution with retries and failure handling
 */

import { Queue, Worker, Job, QueueEvents } from 'bullmq';
import Redis from 'ioredis';
import { pino } from 'pino';
import { config } from './config';
import type { OlumiJob, JobType, JobSchedule } from '@olumi/contracts';

const logger = pino({ level: config.logging.level });

export interface JobHandler<T extends OlumiJob = OlumiJob> {
  (job: Job<T['payload']>): Promise<void>;
}

export interface JobWorkerConfig<T extends OlumiJob = OlumiJob> {
  jobType: JobType;
  handler: JobHandler<T>;
  concurrency?: number;
}

/**
 * JobScheduler provides BullMQ-based job scheduling and execution
 */
export class JobScheduler {
  private redis: Redis;
  private queues: Map<JobType, Queue> = new Map();
  private workers: Map<JobType, Worker> = new Map();
  private queueEvents: Map<JobType, QueueEvents> = new Map();
  private handlers: Map<JobType, JobHandler> = new Map();

  constructor(redisClient?: Redis) {
    this.redis = redisClient || new Redis({
      host: config.redis.host,
      port: config.redis.port,
      password: config.redis.password,
      db: config.redis.db,
      maxRetriesPerRequest: null, // Required for BullMQ
      enableReadyCheck: false,
    });

    this.redis.on('error', (err) => {
      logger.error({ err }, 'Redis connection error');
    });

    this.redis.on('connect', () => {
      logger.info('Connected to Redis');
    });
  }

  /**
   * Initialize job scheduler with configured schedules
   */
  async initialize(schedules: JobSchedule[]): Promise<void> {
    for (const schedule of schedules) {
      // Create queue for this job type
      const queue = new Queue(this.getQueueName(schedule.job_type), {
        connection: this.redis,
        defaultJobOptions: {
          ...config.bullmq.defaultJobOptions,
          attempts: schedule.max_retries || 3,
        },
      });

      this.queues.set(schedule.job_type, queue);

      // Create queue events for monitoring
      const queueEvents = new QueueEvents(this.getQueueName(schedule.job_type), {
        connection: this.redis,
      });

      this.queueEvents.set(schedule.job_type, queueEvents);

      // Set up event listeners
      queueEvents.on('completed', ({ jobId }) => {
        logger.info({ jobId, jobType: schedule.job_type }, 'Job completed');
      });

      queueEvents.on('failed', ({ jobId, failedReason }) => {
        logger.error(
          { jobId, jobType: schedule.job_type, failedReason },
          'Job failed'
        );
      });

      // Add repeatable job if enabled
      if (schedule.enabled) {
        await queue.add(
          schedule.job_type,
          {},
          {
            repeat: {
              pattern: schedule.cron,
            },
            jobId: `${schedule.job_type}_repeatable`,
          }
        );

        logger.info(
          { jobType: schedule.job_type, cron: schedule.cron },
          'Repeatable job scheduled'
        );
      }
    }

    logger.info({ schedules: schedules.length }, 'Job scheduler initialized');
  }

  /**
   * Register a job worker
   */
  registerWorker<T extends OlumiJob>(config: JobWorkerConfig<T>): void {
    const { jobType, handler, concurrency } = config;

    if (this.workers.has(jobType)) {
      throw new Error(`Worker for job type ${jobType} already registered`);
    }

    this.handlers.set(jobType, handler as JobHandler);

    const worker = new Worker(
      this.getQueueName(jobType),
      async (job: Job) => {
        const startTime = Date.now();

        try {
          logger.info(
            { jobId: job.id, jobType, attempt: job.attemptsMade + 1 },
            'Processing job'
          );

          await handler(job as Job<T['payload']>);

          const duration = Date.now() - startTime;
          logger.info(
            { jobId: job.id, jobType, duration },
            'Job completed successfully'
          );
        } catch (err: any) {
          const duration = Date.now() - startTime;
          logger.error(
            { jobId: job.id, jobType, err, duration },
            'Job failed'
          );
          throw err; // Re-throw to trigger retry
        }
      },
      {
        connection: this.redis,
        concurrency: concurrency || config.bullmq.concurrency,
      }
    );

    this.workers.set(jobType, worker);

    logger.info({ jobType, concurrency }, 'Worker registered');
  }

  /**
   * Schedule a one-time job
   */
  async scheduleJob<T extends OlumiJob>(
    jobType: JobType,
    payload: T['payload'],
    options?: {
      delay?: number;
      jobId?: string;
    }
  ): Promise<string> {
    const queue = this.queues.get(jobType);
    if (!queue) {
      throw new Error(`Queue for job type ${jobType} not found`);
    }

    const job = await queue.add(jobType, payload, {
      delay: options?.delay,
      jobId: options?.jobId,
    });

    logger.info(
      { jobId: job.id, jobType, delay: options?.delay },
      'Job scheduled'
    );

    return job.id!;
  }

  /**
   * Get job by ID
   */
  async getJob(jobType: JobType, jobId: string): Promise<Job | undefined> {
    const queue = this.queues.get(jobType);
    if (!queue) {
      return undefined;
    }

    return queue.getJob(jobId);
  }

  /**
   * Get job counts for a queue
   */
  async getJobCounts(jobType: JobType): Promise<{
    waiting: number;
    active: number;
    completed: number;
    failed: number;
    delayed: number;
  }> {
    const queue = this.queues.get(jobType);
    if (!queue) {
      return { waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0 };
    }

    const counts = await queue.getJobCounts();
    return {
      waiting: counts.waiting || 0,
      active: counts.active || 0,
      completed: counts.completed || 0,
      failed: counts.failed || 0,
      delayed: counts.delayed || 0,
    };
  }

  /**
   * Get failed jobs
   */
  async getFailedJobs(jobType: JobType, limit: number = 10): Promise<Job[]> {
    const queue = this.queues.get(jobType);
    if (!queue) {
      return [];
    }

    return queue.getFailed(0, limit - 1);
  }

  /**
   * Retry a failed job
   */
  async retryJob(jobType: JobType, jobId: string): Promise<void> {
    const job = await this.getJob(jobType, jobId);
    if (!job) {
      throw new Error(`Job ${jobId} not found`);
    }

    await job.retry();
    logger.info({ jobId, jobType }, 'Job retried');
  }

  /**
   * Remove a job
   */
  async removeJob(jobType: JobType, jobId: string): Promise<void> {
    const job = await this.getJob(jobType, jobId);
    if (!job) {
      throw new Error(`Job ${jobId} not found`);
    }

    await job.remove();
    logger.info({ jobId, jobType }, 'Job removed');
  }

  /**
   * Clean old jobs
   */
  async cleanJobs(
    jobType: JobType,
    grace: number,
    status: 'completed' | 'failed'
  ): Promise<string[]> {
    const queue = this.queues.get(jobType);
    if (!queue) {
      return [];
    }

    const jobs = await queue.clean(grace, 100, status);
    logger.info({ jobType, count: jobs.length, status }, 'Jobs cleaned');
    return jobs;
  }

  /**
   * Pause a queue
   */
  async pauseQueue(jobType: JobType): Promise<void> {
    const queue = this.queues.get(jobType);
    if (!queue) {
      throw new Error(`Queue for job type ${jobType} not found`);
    }

    await queue.pause();
    logger.info({ jobType }, 'Queue paused');
  }

  /**
   * Resume a queue
   */
  async resumeQueue(jobType: JobType): Promise<void> {
    const queue = this.queues.get(jobType);
    if (!queue) {
      throw new Error(`Queue for job type ${jobType} not found`);
    }

    await queue.resume();
    logger.info({ jobType }, 'Queue resumed');
  }

  /**
   * Stop all workers and close connections
   */
  async stop(): Promise<void> {
    logger.info('Stopping job scheduler');

    // Close all workers
    for (const [jobType, worker] of this.workers) {
      await worker.close();
      logger.info({ jobType }, 'Worker closed');
    }

    // Close all queue events
    for (const [jobType, queueEvents] of this.queueEvents) {
      await queueEvents.close();
      logger.info({ jobType }, 'Queue events closed');
    }

    // Close all queues
    for (const [jobType, queue] of this.queues) {
      await queue.close();
      logger.info({ jobType }, 'Queue closed');
    }

    // Close Redis connection
    await this.redis.quit();
    logger.info('Job scheduler stopped');
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

  /**
   * Get queue name with prefix
   */
  private getQueueName(jobType: JobType): string {
    return `${config.bullmq.queueNamePrefix}:${jobType}`;
  }
}
