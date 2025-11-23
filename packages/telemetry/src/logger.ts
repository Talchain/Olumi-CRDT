/**
 * Structured Logging Helpers
 * Provides standardized logging for all services
 */

import pino from 'pino';

export interface LoggerConfig {
  serviceName: string;
  level?: string;
  pretty?: boolean;
}

/**
 * Create a logger instance for a service
 */
export function createLogger(config: LoggerConfig): pino.Logger {
  const { serviceName, level = 'info', pretty = false } = config;

  const logger = pino({
    name: serviceName,
    level,
    ...(pretty && {
      transport: {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:standard',
          ignore: 'pid,hostname',
        },
      },
    }),
    base: {
      service: serviceName,
      environment: process.env.NODE_ENV || 'development',
    },
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: {
      level: (label) => {
        return { level: label };
      },
    },
  });

  return logger;
}

/**
 * Create a child logger with additional context
 */
export function createChildLogger(
  parent: pino.Logger,
  context: Record<string, any>
): pino.Logger {
  return parent.child(context);
}

/**
 * Log levels
 */
export const LOG_LEVELS = {
  TRACE: 'trace',
  DEBUG: 'debug',
  INFO: 'info',
  WARN: 'warn',
  ERROR: 'error',
  FATAL: 'fatal',
} as const;

/**
 * Standard log fields
 */
export interface LogContext {
  correlation_id?: string;
  user_id?: string;
  org_id?: string;
  request_id?: string;
  [key: string]: any;
}

/**
 * Utility to redact sensitive fields from logs
 */
export function redactSensitiveFields(obj: any): any {
  const sensitiveFields = [
    'password',
    'token',
    'secret',
    'api_key',
    'apiKey',
    'authorization',
    'cookie',
    'session',
  ];

  if (typeof obj !== 'object' || obj === null) {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map(redactSensitiveFields);
  }

  const redacted: any = {};
  for (const [key, value] of Object.entries(obj)) {
    const lowerKey = key.toLowerCase();
    const isSensitive = sensitiveFields.some((field) => lowerKey.includes(field));

    if (isSensitive) {
      redacted[key] = '[REDACTED]';
    } else if (typeof value === 'object' && value !== null) {
      redacted[key] = redactSensitiveFields(value);
    } else {
      redacted[key] = value;
    }
  }

  return redacted;
}
