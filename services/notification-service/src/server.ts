/**
 * HTTP Server for Notification Service
 * Provides health check, metrics, and notification management endpoints
 */

import express from 'express';
import { config } from './config';
import { NotificationService } from './notification-service';
import { getMetrics } from '@olumi/telemetry';
import { createLogger } from '@olumi/telemetry';

const logger = createLogger({
  serviceName: config.service.name,
  level: config.logging.level,
  pretty: config.logging.pretty,
});

export function createServer(notificationService: NotificationService): express.Application {
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
      res.json({ healthy: true });
    } catch (err: any) {
      logger.error({ err }, 'Health check failed');
      res.status(503).json({
        healthy: false,
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
   * Get in-app notifications for a user
   */
  app.get('/notifications/:userId', async (req, res) => {
    try {
      const { userId } = req.params;
      const limit = parseInt(req.query.limit as string) || 50;
      const offset = parseInt(req.query.offset as string) || 0;

      const notifications = await notificationService.getInAppNotifications(
        userId,
        limit,
        offset
      );

      res.json(notifications);
    } catch (err: any) {
      logger.error({ err }, 'Failed to get notifications');
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * Get user preferences
   */
  app.get('/preferences/:userId', async (req, res) => {
    try {
      const { userId } = req.params;

      const preferences = await notificationService.getUserPreferences(userId);

      res.json(preferences);
    } catch (err: any) {
      logger.error({ err }, 'Failed to get user preferences');
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * Update user preferences
   */
  app.put('/preferences/:userId', async (req, res) => {
    try {
      const { userId } = req.params;
      const preferences = req.body;

      await notificationService.updateUserPreferences(userId, preferences);

      res.json({ success: true });
    } catch (err: any) {
      logger.error({ err }, 'Failed to update user preferences');
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * Get delivery status for a notification
   */
  app.get('/notifications/:notificationId/delivery', async (req, res) => {
    try {
      const { notificationId } = req.params;

      const deliveries = await notificationService.getDeliveryStatus(notificationId);

      res.json(deliveries);
    } catch (err: any) {
      logger.error({ err }, 'Failed to get delivery status');
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * Get notification statistics
   */
  app.get('/stats', async (req, res) => {
    try {
      const startDate = req.query.startDate
        ? new Date(req.query.startDate as string)
        : undefined;
      const endDate = req.query.endDate
        ? new Date(req.query.endDate as string)
        : undefined;
      const channel = req.query.channel as any;

      const stats = await notificationService.getStats({
        startDate,
        endDate,
        channel,
      });

      res.json(stats);
    } catch (err: any) {
      logger.error({ err }, 'Failed to get stats');
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
