/**
 * HTTP Server for Event Bus
 * Provides health check and metrics endpoints
 */

import express from 'express';
import { config } from './config';
import { EventBus } from './event-bus';
import { getMetrics } from '@olumi/telemetry';
import { createLogger } from '@olumi/telemetry';

const logger = createLogger({
  serviceName: config.service.name,
  level: config.logging.level,
  pretty: config.logging.pretty,
});

export function createServer(eventBus: EventBus): express.Application {
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
      const health = await eventBus.healthCheck();
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
      const health = await eventBus.healthCheck();
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
   * Stream info endpoint
   */
  app.get('/stream/info', async (req, res) => {
    try {
      const info = await eventBus.getStreamInfo();
      res.json(info);
    } catch (err: any) {
      logger.error({ err }, 'Failed to get stream info');
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
