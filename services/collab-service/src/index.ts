/**
 * Collaboration Service Entry Point
 */

import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import jwt from '@fastify/jwt';
import websocket from '@fastify/websocket';
import { pino } from 'pino';
import { config } from './config';
import { validateConfigOrExit } from './utils/config-validation';
import { DatabaseClient } from './database/client';
import { DocumentManager } from './collab/document-manager';
import { CollaborationWebSocketServer } from './collab/websocket-server';
import { registerRoutes } from './api/routes';
import { createExpirationJob, AccessExpirationJob } from './jobs/access-expiration-job';
import { InMemoryNotificationService } from './notifications/notification-service';

const logger = pino({
  level: config.logging.level,
  transport:
    config.server.env === 'development'
      ? {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'HH:MM:ss',
            ignore: 'pid,hostname',
          },
        }
      : undefined,
});

async function start() {
  // CRITICAL: Validate configuration before starting server
  // This prevents deployment with insecure defaults (weak JWT secrets, wildcard CORS, etc.)
  validateConfigOrExit();

  // Initialize database
  const db = new DatabaseClient();

  try {
    await db.initialize();
    logger.info('Database initialized');
  } catch (err) {
    logger.fatal({ err }, 'Failed to initialize database');
    process.exit(1);
  }

  // Initialize document manager
  const documentManager = new DocumentManager(db);
  logger.info('Document manager initialized');

  // Initialize WebSocket server
  const wsServer = new CollaborationWebSocketServer(documentManager, db);
  logger.info('WebSocket server initialized');

  // Initialize notification service
  const notificationService = new InMemoryNotificationService();
  logger.info('Notification service initialized');

  // Initialize access expiration background job
  const expirationJob = createExpirationJob(db, documentManager, notificationService, {
    intervalMs: 5 * 60 * 1000, // Run every 5 minutes
  });
  logger.info('Access expiration job started');

  // Create Fastify app
  // SECURITY: Only trust proxy headers if explicitly configured
  // This prevents IP spoofing via X-Forwarded-For headers
  const trustProxyConfig = config.server.trustProxy
    ? config.server.trustedProxyIps.length > 0
      ? config.server.trustedProxyIps // Trust specific IPs only
      : true // Trust all (use only if proxy validates)
    : false; // Don't trust any proxy headers

  const app = Fastify({
    logger,
    trustProxy: trustProxyConfig,
  });

  // Register CORS
  await app.register(cors, {
    origin: config.cors.allowedOrigins,
    credentials: true,
  });

  // Register helmet for security headers
  await app.register(helmet, {
    // Content Security Policy
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        baseUri: ["'self'"],
        fontSrc: ["'self'", 'https:', 'data:'],
        formAction: ["'self'"],
        frameAncestors: ["'none'"], // Equivalent to X-Frame-Options: DENY
        imgSrc: ["'self'", 'data:', 'https:'],
        objectSrc: ["'none'"],
        scriptSrc: ["'self'"],
        scriptSrcAttr: ["'none'"],
        styleSrc: ["'self'", 'https:', "'unsafe-inline'"], // Allow inline styles for compatibility
        upgradeInsecureRequests: config.server.env === 'production' ? [] : null,
        // Allow WebSocket connections from allowed origins
        connectSrc: ["'self'", ...config.cors.allowedOrigins],
      },
    },
    // Strict Transport Security (HSTS)
    hsts: config.server.env === 'production' ? {
      maxAge: 31536000, // 1 year in seconds
      includeSubDomains: true,
      preload: true,
    } : false, // Disable HSTS in development
    // X-Frame-Options (redundant with frameAncestors in CSP, but good defense-in-depth)
    frameguard: {
      action: 'deny',
    },
    // X-Content-Type-Options
    noSniff: true,
    // X-DNS-Prefetch-Control
    dnsPrefetchControl: {
      allow: false,
    },
    // X-Download-Options for IE8+
    ieNoOpen: true,
    // X-Permitted-Cross-Domain-Policies
    permittedCrossDomainPolicies: {
      permittedPolicies: 'none',
    },
  });

  // Register JWT
  await app.register(jwt, {
    secret: config.jwt.secret,
  });

  // Add authentication decorator
  app.decorate('authenticate', async function (request: any, reply: any) {
    try {
      await request.jwtVerify();
    } catch (err) {
      reply.code(401).send({ success: false, error: 'Unauthorized' });
    }
  });

  // Add admin check decorator
  app.decorate('requireAdmin', async function (request: any, reply: any) {
    const user = request.user;
    if (!user || !user.roles || !user.roles.includes('admin')) {
      reply.code(403).send({ success: false, error: 'Admin access required' });
    }
  });

  // Register routes
  await registerRoutes(app, documentManager, wsServer, db, notificationService);

  // Register WebSocket upgrade handler
  app.server.on('upgrade', (request, socket, head) => {
    if (request.url?.startsWith('/api/collab/boards/')) {
      wsServer.handleUpgrade(request, socket, head);
    } else {
      socket.destroy();
    }
  });

  // Graceful shutdown
  const shutdown = async () => {
    logger.info('Shutting down...');

    try {
      // Stop background jobs
      expirationJob.stop();

      await wsServer.shutdown();
      await documentManager.shutdown();
      await app.close();
      await db.close();

      logger.info('Shutdown complete');
      process.exit(0);
    } catch (err) {
      logger.error({ err }, 'Error during shutdown');
      process.exit(1);
    }
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  // Start server
  try {
    await app.listen({
      port: config.server.port,
      host: config.server.host,
    });

    logger.info(
      { port: config.server.port, env: config.server.env },
      'Collaboration service started'
    );
  } catch (err) {
    logger.fatal({ err }, 'Failed to start server');
    process.exit(1);
  }
}

start();
