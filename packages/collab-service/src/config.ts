/**
 * Service configuration
 */

import dotenv from 'dotenv';

dotenv.config();

export interface Config {
  server: {
    port: number;
    host: string;
    env: string;
  };
  database: {
    url: string;
  };
  jwt: {
    secret: string;
    expiry: string;
  };
  features: {
    realtimeCollab: 'off' | 'beta' | 'on';
  };
  limits: {
    maxConnectionsPerUser: number;
    maxConnectionsPerOrg: number;
    maxBoardsPerOrg: number;
    updateRateLimit: number;
    snapshotIntervalMs: number;
    documentEvictionMs: number;
  };
  cors: {
    allowedOrigins: string[];
  };
  logging: {
    level: string;
  };
  metrics: {
    enabled: boolean;
  };
}

export const config: Config = {
  server: {
    port: parseInt(process.env.PORT || '3001', 10),
    host: process.env.HOST || '0.0.0.0',
    env: process.env.NODE_ENV || 'development',
  },
  database: {
    url: process.env.DATABASE_URL || 'postgresql://localhost:5432/olumi_collab',
  },
  jwt: {
    secret: process.env.JWT_SECRET || 'change-me-in-production',
    expiry: process.env.JWT_EXPIRY || '1h',
  },
  features: {
    realtimeCollab: (process.env.REALTIME_COLLAB || 'beta') as 'off' | 'beta' | 'on',
  },
  limits: {
    maxConnectionsPerUser: parseInt(process.env.MAX_CONNECTIONS_PER_USER || '10', 10),
    maxConnectionsPerOrg: parseInt(process.env.MAX_CONNECTIONS_PER_ORG || '500', 10),
    maxBoardsPerOrg: parseInt(process.env.MAX_BOARDS_PER_ORG || '100', 10),
    updateRateLimit: parseInt(process.env.UPDATE_RATE_LIMIT || '50', 10),
    snapshotIntervalMs: parseInt(process.env.SNAPSHOT_INTERVAL_MS || '300000', 10),
    documentEvictionMs: parseInt(process.env.DOCUMENT_EVICTION_MS || '600000', 10),
  },
  cors: {
    allowedOrigins: (process.env.ALLOWED_ORIGINS || 'http://localhost:3000').split(','),
  },
  logging: {
    level: process.env.LOG_LEVEL || 'info',
  },
  metrics: {
    enabled: process.env.METRICS_ENABLED === 'true',
  },
};
