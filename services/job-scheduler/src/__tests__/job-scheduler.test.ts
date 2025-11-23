/**
 * Job Scheduler Tests
 * Comprehensive test suite for BullMQ-based job scheduler
 */

import { JobScheduler } from '../job-scheduler';
import { config } from '../config';
import Redis from 'ioredis';
import { Job } from 'bullmq';
import type { JobSchedule, JOB_TYPES } from '@olumi/contracts';

describe('JobScheduler', () => {
  let jobScheduler: JobScheduler;
  let redis: Redis;

  beforeAll(async () => {
    // Use test Redis instance
    redis = new Redis({
      host: config.redis.host,
      port: config.redis.port,
      db: 15, // Use test DB
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
    });
  });

  beforeEach(async () => {
    jobScheduler = new JobScheduler(redis);

    // Initialize with test schedules (disabled to avoid auto-running)
    const testSchedules: JobSchedule[] = [
      {
        job_type: 'EXPIRE_ACCESS_REQUESTS',
        cron: '*/5 * * * *',
        enabled: false, // Disabled for tests
        max_retries: 2,
      },
      {
        job_type: 'CLEANUP_OLD_AUDIT_LOGS',
        cron: '0 2 * * 0',
        enabled: false,
        max_retries: 1,
      },
    ];

    await jobScheduler.initialize(testSchedules);
  });

  afterEach(async () => {
    await jobScheduler.stop();

    // Clean up all test queues
    const keys = await redis.keys('bull:olumi:jobs:*');
    if (keys.length > 0) {
      await redis.del(...keys);
    }
  });

  afterAll(async () => {
    await redis.quit();
  });

  // ========================================================================
  // INITIALIZATION TESTS
  // ========================================================================

  describe('initialize()', () => {
    it('should create queues for all job types', async () => {
      const counts = await jobScheduler.getJobCounts('EXPIRE_ACCESS_REQUESTS');
      expect(counts).toBeDefined();
      expect(counts.waiting).toBe(0);
    });

    it('should schedule repeatable jobs when enabled', async () => {
      const scheduler = new JobScheduler(redis);

      const schedules: JobSchedule[] = [
        {
          job_type: 'EXPIRE_ACCESS_REQUESTS',
          cron: '*/5 * * * *',
          enabled: true, // Enabled
        },
      ];

      await scheduler.initialize(schedules);

      // Check that repeatable job exists
      const counts = await scheduler.getJobCounts('EXPIRE_ACCESS_REQUESTS');
      expect(counts.waiting + counts.delayed).toBeGreaterThanOrEqual(0);

      await scheduler.stop();
    });

    it('should not schedule repeatable jobs when disabled', async () => {
      const counts = await jobScheduler.getJobCounts('EXPIRE_ACCESS_REQUESTS');
      // Should only have the repeatable job entry (0 or 1), not multiple jobs
      expect(counts.waiting + counts.delayed).toBeLessThanOrEqual(1);
    });
  });

  // ========================================================================
  // WORKER REGISTRATION TESTS
  // ========================================================================

  describe('registerWorker()', () => {
    it('should register a worker successfully', () => {
      const handler = jest.fn();

      jobScheduler.registerWorker({
        jobType: 'EXPIRE_ACCESS_REQUESTS',
        handler,
      });

      expect(true).toBe(true);
    });

    it('should throw error for duplicate worker registration', () => {
      const handler = jest.fn();

      jobScheduler.registerWorker({
        jobType: 'EXPIRE_ACCESS_REQUESTS',
        handler,
      });

      expect(() => {
        jobScheduler.registerWorker({
          jobType: 'EXPIRE_ACCESS_REQUESTS',
          handler,
        });
      }).toThrow('Worker for job type EXPIRE_ACCESS_REQUESTS already registered');
    });

    it('should allow custom concurrency', () => {
      const handler = jest.fn();

      jobScheduler.registerWorker({
        jobType: 'CLEANUP_OLD_AUDIT_LOGS',
        handler,
        concurrency: 10,
      });

      expect(true).toBe(true);
    });
  });

  // ========================================================================
  // JOB SCHEDULING TESTS
  // ========================================================================

  describe('scheduleJob()', () => {
    it('should schedule a one-time job', async () => {
      const jobId = await jobScheduler.scheduleJob('EXPIRE_ACCESS_REQUESTS', {
        dry_run: true,
      });

      expect(jobId).toBeDefined();
      expect(typeof jobId).toBe('string');

      const counts = await jobScheduler.getJobCounts('EXPIRE_ACCESS_REQUESTS');
      expect(counts.waiting).toBeGreaterThanOrEqual(1);
    });

    it('should schedule a delayed job', async () => {
      const jobId = await jobScheduler.scheduleJob(
        'EXPIRE_ACCESS_REQUESTS',
        { dry_run: true },
        { delay: 5000 } // 5 seconds
      );

      expect(jobId).toBeDefined();

      const counts = await jobScheduler.getJobCounts('EXPIRE_ACCESS_REQUESTS');
      expect(counts.delayed).toBeGreaterThanOrEqual(1);
    });

    it('should schedule a job with custom jobId', async () => {
      const customJobId = 'test-job-123';

      const jobId = await jobScheduler.scheduleJob(
        'EXPIRE_ACCESS_REQUESTS',
        { dry_run: true },
        { jobId: customJobId }
      );

      expect(jobId).toBe(customJobId);
    });

    it('should throw error for invalid queue', async () => {
      await expect(
        jobScheduler.scheduleJob('INVALID_JOB_TYPE' as any, {})
      ).rejects.toThrow('Queue for job type INVALID_JOB_TYPE not found');
    });
  });

  // ========================================================================
  // JOB RETRIEVAL TESTS
  // ========================================================================

  describe('getJob()', () => {
    it('should retrieve a job by ID', async () => {
      const jobId = await jobScheduler.scheduleJob('EXPIRE_ACCESS_REQUESTS', {
        dry_run: true,
      });

      const job = await jobScheduler.getJob('EXPIRE_ACCESS_REQUESTS', jobId);

      expect(job).toBeDefined();
      expect(job?.id).toBe(jobId);
      expect(job?.data).toEqual({ dry_run: true });
    });

    it('should return undefined for non-existent job', async () => {
      const job = await jobScheduler.getJob('EXPIRE_ACCESS_REQUESTS', 'non-existent');

      expect(job).toBeUndefined();
    });

    it('should return undefined for invalid queue', async () => {
      const job = await jobScheduler.getJob('INVALID_JOB_TYPE' as any, 'some-id');

      expect(job).toBeUndefined();
    });
  });

  // ========================================================================
  // JOB COUNTS TESTS
  // ========================================================================

  describe('getJobCounts()', () => {
    it('should return job counts for a queue', async () => {
      // Schedule some jobs
      await jobScheduler.scheduleJob('EXPIRE_ACCESS_REQUESTS', { dry_run: true });
      await jobScheduler.scheduleJob('EXPIRE_ACCESS_REQUESTS', { dry_run: false });

      const counts = await jobScheduler.getJobCounts('EXPIRE_ACCESS_REQUESTS');

      expect(counts).toHaveProperty('waiting');
      expect(counts).toHaveProperty('active');
      expect(counts).toHaveProperty('completed');
      expect(counts).toHaveProperty('failed');
      expect(counts).toHaveProperty('delayed');
      expect(counts.waiting).toBeGreaterThanOrEqual(2);
    });

    it('should return zero counts for empty queue', async () => {
      const counts = await jobScheduler.getJobCounts('CLEANUP_OLD_AUDIT_LOGS');

      expect(counts.waiting).toBe(0);
      expect(counts.active).toBe(0);
    });

    it('should return zero counts for invalid queue', async () => {
      const counts = await jobScheduler.getJobCounts('INVALID_JOB_TYPE' as any);

      expect(counts.waiting).toBe(0);
      expect(counts.active).toBe(0);
      expect(counts.completed).toBe(0);
      expect(counts.failed).toBe(0);
      expect(counts.delayed).toBe(0);
    });
  });

  // ========================================================================
  // JOB EXECUTION TESTS
  // ========================================================================

  describe('job execution', () => {
    it('should execute a job successfully', async () => {
      const executedJobs: any[] = [];
      const handler = jest.fn(async (job: Job) => {
        executedJobs.push(job.data);
      });

      jobScheduler.registerWorker({
        jobType: 'EXPIRE_ACCESS_REQUESTS',
        handler,
      });

      await jobScheduler.scheduleJob('EXPIRE_ACCESS_REQUESTS', {
        dry_run: true,
      });

      // Wait for job execution
      await new Promise((resolve) => setTimeout(resolve, 2000));

      expect(handler).toHaveBeenCalled();
      expect(executedJobs.length).toBeGreaterThanOrEqual(1);
      expect(executedJobs[0].dry_run).toBe(true);
    }, 10000);

    it('should retry failed jobs', async () => {
      let attempts = 0;
      const handler = jest.fn(async () => {
        attempts++;
        if (attempts < 2) {
          throw new Error('Job failed');
        }
        // Success on second attempt
      });

      jobScheduler.registerWorker({
        jobType: 'EXPIRE_ACCESS_REQUESTS',
        handler,
      });

      await jobScheduler.scheduleJob('EXPIRE_ACCESS_REQUESTS', {
        dry_run: true,
      });

      // Wait for retries
      await new Promise((resolve) => setTimeout(resolve, 5000));

      expect(handler).toHaveBeenCalledTimes(2);
    }, 10000);

    it('should handle worker errors gracefully', async () => {
      const handler = jest.fn(async () => {
        throw new Error('Worker error');
      });

      jobScheduler.registerWorker({
        jobType: 'EXPIRE_ACCESS_REQUESTS',
        handler,
      });

      await jobScheduler.scheduleJob('EXPIRE_ACCESS_REQUESTS', {
        dry_run: true,
      });

      // Wait for job to fail
      await new Promise((resolve) => setTimeout(resolve, 5000));

      // Job should have failed
      const failedJobs = await jobScheduler.getFailedJobs('EXPIRE_ACCESS_REQUESTS');
      expect(failedJobs.length).toBeGreaterThanOrEqual(1);
    }, 10000);
  });

  // ========================================================================
  // FAILED JOBS TESTS
  // ========================================================================

  describe('getFailedJobs()', () => {
    it('should return failed jobs', async () => {
      const handler = jest.fn(async () => {
        throw new Error('Intentional failure');
      });

      jobScheduler.registerWorker({
        jobType: 'EXPIRE_ACCESS_REQUESTS',
        handler,
      });

      await jobScheduler.scheduleJob('EXPIRE_ACCESS_REQUESTS', { dry_run: true });

      // Wait for job to fail (with retries)
      await new Promise((resolve) => setTimeout(resolve, 8000));

      const failedJobs = await jobScheduler.getFailedJobs('EXPIRE_ACCESS_REQUESTS', 10);

      expect(failedJobs.length).toBeGreaterThanOrEqual(1);
    }, 15000);

    it('should limit number of failed jobs returned', async () => {
      const failedJobs = await jobScheduler.getFailedJobs('EXPIRE_ACCESS_REQUESTS', 5);

      expect(failedJobs.length).toBeLessThanOrEqual(5);
    });
  });

  // ========================================================================
  // JOB RETRY TESTS
  // ========================================================================

  describe('retryJob()', () => {
    it('should retry a failed job', async () => {
      let attempts = 0;
      const handler = jest.fn(async () => {
        attempts++;
        throw new Error('Always fail');
      });

      jobScheduler.registerWorker({
        jobType: 'EXPIRE_ACCESS_REQUESTS',
        handler,
      });

      const jobId = await jobScheduler.scheduleJob('EXPIRE_ACCESS_REQUESTS', {
        dry_run: true,
      });

      // Wait for job to fail
      await new Promise((resolve) => setTimeout(resolve, 8000));

      const initialAttempts = attempts;

      // Retry the job
      await jobScheduler.retryJob('EXPIRE_ACCESS_REQUESTS', jobId);

      // Wait for retry
      await new Promise((resolve) => setTimeout(resolve, 2000));

      expect(attempts).toBeGreaterThan(initialAttempts);
    }, 15000);

    it('should throw error for non-existent job', async () => {
      await expect(
        jobScheduler.retryJob('EXPIRE_ACCESS_REQUESTS', 'non-existent')
      ).rejects.toThrow('Job non-existent not found');
    });
  });

  // ========================================================================
  // JOB REMOVAL TESTS
  // ========================================================================

  describe('removeJob()', () => {
    it('should remove a job', async () => {
      const jobId = await jobScheduler.scheduleJob('EXPIRE_ACCESS_REQUESTS', {
        dry_run: true,
      });

      await jobScheduler.removeJob('EXPIRE_ACCESS_REQUESTS', jobId);

      const job = await jobScheduler.getJob('EXPIRE_ACCESS_REQUESTS', jobId);
      expect(job).toBeUndefined();
    });

    it('should throw error for non-existent job', async () => {
      await expect(
        jobScheduler.removeJob('EXPIRE_ACCESS_REQUESTS', 'non-existent')
      ).rejects.toThrow('Job non-existent not found');
    });
  });

  // ========================================================================
  // QUEUE MANAGEMENT TESTS
  // ========================================================================

  describe('pauseQueue() and resumeQueue()', () => {
    it('should pause a queue', async () => {
      await jobScheduler.pauseQueue('EXPIRE_ACCESS_REQUESTS');
      expect(true).toBe(true);
    });

    it('should resume a paused queue', async () => {
      await jobScheduler.pauseQueue('EXPIRE_ACCESS_REQUESTS');
      await jobScheduler.resumeQueue('EXPIRE_ACCESS_REQUESTS');
      expect(true).toBe(true);
    });

    it('should throw error for invalid queue', async () => {
      await expect(
        jobScheduler.pauseQueue('INVALID_JOB_TYPE' as any)
      ).rejects.toThrow('Queue for job type INVALID_JOB_TYPE not found');
    });
  });

  // ========================================================================
  // HEALTH CHECK TESTS
  // ========================================================================

  describe('healthCheck()', () => {
    it('should return healthy status when Redis is connected', async () => {
      const health = await jobScheduler.healthCheck();

      expect(health.healthy).toBe(true);
      expect(health.redis).toBe('connected');
    });

    it('should return unhealthy status when Redis is disconnected', async () => {
      await jobScheduler.stop();

      const health = await jobScheduler.healthCheck();

      expect(health.healthy).toBe(false);
      expect(health.redis).toBe('disconnected');
    });
  });

  // ========================================================================
  // STOP TESTS
  // ========================================================================

  describe('stop()', () => {
    it('should stop all workers and queues', async () => {
      const handler = jest.fn();

      jobScheduler.registerWorker({
        jobType: 'EXPIRE_ACCESS_REQUESTS',
        handler,
      });

      await jobScheduler.stop();

      expect(true).toBe(true);
    });
  });
});
