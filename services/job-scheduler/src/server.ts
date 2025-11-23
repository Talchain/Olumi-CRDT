/**
 * HTTP Server for Job Scheduler
 * Provides health check, metrics, and job management endpoints
 */

import express from 'express';
import { config } from './config';
import { JobScheduler } from './job-scheduler';
import { getMetrics } from '@olumi/telemetry';
import { createLogger } from '@olumi/telemetry';
import { JOB_TYPES, JobType } from '@olumi/contracts';

const logger = createLogger({
  serviceName: config.service.name,
  level: config.logging.level,
  pretty: config.logging.pretty,
});

export function createServer(jobScheduler: JobScheduler): express.Application {
  const app = express();

  // Middleware
  app.use(express.json());

  // Request logging
  app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
      const duration = Date.now() - start;
      logger.info(
        {
          method: req.method,
          path: req.path,
          statusCode: res.statusCode,
          duration,
        },
        'HTTP request'
      );
    });
    next();
  });

  /**
   * Health check endpoint
   */
  app.get('/health', async (req, res) => {
    try {
      const health = await jobScheduler.healthCheck();
      const statusCode = health.healthy ? 200 : 503;
      res.status(statusCode).json(health);
    } catch (err: any) {
      logger.error({ err }, 'Health check failed');
      res.status(503).json({
        healthy: false,
        error: err.message,
      });
    }
  });

  /**
   * Readiness check endpoint
   */
  app.get('/ready', async (req, res) => {
    try {
      const health = await jobScheduler.healthCheck();
      const statusCode = health.healthy ? 200 : 503;
      res.status(statusCode).json({
        ready: health.healthy,
        redis: health.redis,
      });
    } catch (err: any) {
      res.status(503).json({
        ready: false,
        error: err.message,
      });
    }
  });

  /**
   * Metrics endpoint (Prometheus format)
   */
  app.get('/metrics', async (req, res) => {
    try {
      const metrics = await getMetrics();
      res.set('Content-Type', 'text/plain');
      res.send(metrics);
    } catch (err: any) {
      logger.error({ err }, 'Failed to get metrics');
      res.status(500).json({ error: 'Failed to get metrics' });
    }
  });

  /**
   * Get job counts for all queues
   */
  app.get('/jobs/counts', async (req, res) => {
    try {
      const allCounts: Record<string, any> = {};

      for (const jobType of Object.values(JOB_TYPES)) {
        const counts = await jobScheduler.getJobCounts(jobType as JobType);
        allCounts[jobType] = counts;
      }

      res.json(allCounts);
    } catch (err: any) {
      logger.error({ err }, 'Failed to get job counts');
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * Get job counts for a specific queue
   */
  app.get('/jobs/:jobType/counts', async (req, res) => {
    try {
      const jobType = req.params.jobType as JobType;

      if (!Object.values(JOB_TYPES).includes(jobType)) {
        return res.status(400).json({ error: 'Invalid job type' });
      }

      const counts = await jobScheduler.getJobCounts(jobType);
      res.json(counts);
    } catch (err: any) {
      logger.error({ err }, 'Failed to get job counts');
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * Get failed jobs
   */
  app.get('/jobs/:jobType/failed', async (req, res) => {
    try {
      const jobType = req.params.jobType as JobType;
      const limit = parseInt(req.query.limit as string) || 10;

      if (!Object.values(JOB_TYPES).includes(jobType)) {
        return res.status(400).json({ error: 'Invalid job type' });
      }

      const jobs = await jobScheduler.getFailedJobs(jobType, limit);
      res.json(jobs);
    } catch (err: any) {
      logger.error({ err }, 'Failed to get failed jobs');
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * Retry a failed job
   */
  app.post('/jobs/:jobType/:jobId/retry', async (req, res) => {
    try {
      const { jobType, jobId } = req.params;

      if (!Object.values(JOB_TYPES).includes(jobType as JobType)) {
        return res.status(400).json({ error: 'Invalid job type' });
      }

      await jobScheduler.retryJob(jobType as JobType, jobId);
      res.json({ success: true });
    } catch (err: any) {
      logger.error({ err }, 'Failed to retry job');
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * Remove a job
   */
  app.delete('/jobs/:jobType/:jobId', async (req, res) => {
    try {
      const { jobType, jobId } = req.params;

      if (!Object.values(JOB_TYPES).includes(jobType as JobType)) {
        return res.status(400).json({ error: 'Invalid job type' });
      }

      await jobScheduler.removeJob(jobType as JobType, jobId);
      res.json({ success: true });
    } catch (err: any) {
      logger.error({ err }, 'Failed to remove job');
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * Pause a queue
   */
  app.post('/jobs/:jobType/pause', async (req, res) => {
    try {
      const jobType = req.params.jobType as JobType;

      if (!Object.values(JOB_TYPES).includes(jobType)) {
        return res.status(400).json({ error: 'Invalid job type' });
      }

      await jobScheduler.pauseQueue(jobType);
      res.json({ success: true });
    } catch (err: any) {
      logger.error({ err }, 'Failed to pause queue');
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * Resume a queue
   */
  app.post('/jobs/:jobType/resume', async (req, res) => {
    try {
      const jobType = req.params.jobType as JobType;

      if (!Object.values(JOB_TYPES).includes(jobType)) {
        return res.status(400).json({ error: 'Invalid job type' });
      }

      await jobScheduler.resumeQueue(jobType);
      res.json({ success: true });
    } catch (err: any) {
      logger.error({ err }, 'Failed to resume queue');
      res.status(500).json({ error: err.message });
    }
  });

  // 404 handler
  app.use((req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  // Error handler
  app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    logger.error({ err, path: req.path }, 'Unhandled error');
    res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}
