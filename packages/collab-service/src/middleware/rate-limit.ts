/**
 * SECURITY FIX: Rate limiting middleware for REST API endpoints
 * Prevents DoS attacks and resource exhaustion
 */

import { FastifyRequest, FastifyReply } from 'fastify';
import { TokenBucket } from '../utils/throttle';
import { pino } from 'pino';
import { config } from '../config';

const logger = pino({ level: config.logging.level });

export interface RateLimitConfig {
  /** Maximum number of requests in the time window */
  max: number;
  /** Time window in milliseconds */
  windowMs: number;
  /** Custom key generator (default: user ID or IP) */
  keyGenerator?: (request: FastifyRequest) => string;
  /** Message to send when rate limit is exceeded */
  message?: string;
  /** Status code to send when rate limit is exceeded (default: 429) */
  statusCode?: number;
  /** Skip rate limiting if this function returns true */
  skip?: (request: FastifyRequest) => boolean;
}

/**
 * Rate limiter using token bucket algorithm
 * Tracks limits per user/IP and resets over time
 */
export class RateLimiter {
  private buckets: Map<string, TokenBucket> = new Map();
  private config: Required<RateLimitConfig>;

  constructor(config: RateLimitConfig) {
    this.config = {
      max: config.max,
      windowMs: config.windowMs,
      keyGenerator: config.keyGenerator || this.defaultKeyGenerator,
      message: config.message || 'Too many requests, please try again later',
      statusCode: config.statusCode || 429,
      skip: config.skip || (() => false),
    };

    // Cleanup old buckets periodically
    setInterval(() => this.cleanup(), this.config.windowMs);
  }

  /**
   * Default key generator: use user ID from JWT or fall back to IP address
   */
  private defaultKeyGenerator(request: FastifyRequest): string {
    // Try to get user ID from authenticated user
    const user = (request as any).user;
    if (user && user.userId) {
      return `user:${user.userId}`;
    }

    // Fall back to IP address
    const ip =
      request.headers['x-forwarded-for'] ||
      request.headers['x-real-ip'] ||
      request.ip ||
      'unknown';
    return `ip:${ip}`;
  }

  /**
   * Create Fastify middleware function
   */
  middleware() {
    return async (request: FastifyRequest, reply: FastifyReply) => {
      // Skip if configured to skip
      if (this.config.skip(request)) {
        return;
      }

      const key = this.config.keyGenerator(request);

      // Get or create token bucket for this key
      let bucket = this.buckets.get(key);
      if (!bucket) {
        // Create new bucket with capacity = max requests
        // Refill rate = max requests per window (converted to per second)
        const refillRate = this.config.max / (this.config.windowMs / 1000);
        bucket = new TokenBucket(this.config.max, refillRate, 1000);
        this.buckets.set(key, bucket);
      }

      // Try to consume a token
      if (!bucket.tryConsume(1)) {
        logger.warn(
          {
            key,
            endpoint: request.url,
            method: request.method,
            remainingTokens: bucket.getTokenCount(),
          },
          'Rate limit exceeded'
        );

        reply.code(this.config.statusCode).send({
          success: false,
          error: this.config.message,
          retryAfter: Math.ceil(this.config.windowMs / 1000), // seconds
        });
        return;
      }

      // Request allowed
      const remaining = bucket.getTokenCount();
      reply.header('X-RateLimit-Limit', this.config.max.toString());
      reply.header('X-RateLimit-Remaining', remaining.toString());
      reply.header(
        'X-RateLimit-Reset',
        new Date(Date.now() + this.config.windowMs).toISOString()
      );
    };
  }

  /**
   * Cleanup old buckets
   */
  private cleanup(): void {
    const now = Date.now();
    let cleaned = 0;

    for (const [key, bucket] of this.buckets.entries()) {
      // If bucket is full (hasn't been used recently), remove it
      if (bucket.getTokenCount() >= this.config.max) {
        this.buckets.delete(key);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      logger.debug({ cleaned, total: this.buckets.size }, 'Cleaned up rate limit buckets');
    }
  }

  /**
   * Get current state for monitoring
   */
  getStats(): { totalBuckets: number; buckets: Array<{ key: string; remaining: number }> } {
    const buckets = Array.from(this.buckets.entries()).map(([key, bucket]) => ({
      key,
      remaining: bucket.getTokenCount(),
    }));

    return {
      totalBuckets: this.buckets.size,
      buckets,
    };
  }

  /**
   * Reset all rate limits (useful for testing)
   */
  reset(): void {
    this.buckets.clear();
    logger.info('Rate limiter reset');
  }
}

/**
 * Create a rate limiting middleware with default config
 */
export function createRateLimitMiddleware(config?: Partial<RateLimitConfig>): RateLimiter {
  const defaultConfig: RateLimitConfig = {
    max: 100, // 100 requests per window
    windowMs: 60 * 1000, // 1 minute window
    ...config,
  };

  return new RateLimiter(defaultConfig);
}

/**
 * Strict rate limit for sensitive operations (visibility changes, policy updates)
 */
export function createStrictRateLimitMiddleware(): RateLimiter {
  return new RateLimiter({
    max: 20, // 20 requests per window
    windowMs: 60 * 1000, // 1 minute window
    message: 'Too many requests to sensitive endpoint, please try again later',
  });
}

/**
 * Permissive rate limit for read operations
 */
export function createPermissiveRateLimitMiddleware(): RateLimiter {
  return new RateLimiter({
    max: 300, // 300 requests per window
    windowMs: 60 * 1000, // 1 minute window
  });
}
