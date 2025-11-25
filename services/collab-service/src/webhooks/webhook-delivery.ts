/**
 * Webhook Delivery Service (I.1)
 *
 * Handles webhook delivery with:
 * - HMAC signature generation
 * - Exponential backoff retries
 * - Timeout handling
 * - Failure tracking
 */

import { createHmac } from 'crypto';
import { pino } from 'pino';
import { WebhookSubscription, WebhookPayload, WebhookDeliveryAttempt } from './webhook-types';

const logger = pino();

export interface WebhookDeliveryConfig {
  maxRetries: number;
  timeoutMs: number;
  initialBackoffMs: number;
  maxBackoffMs: number;
}

export const DEFAULT_CONFIG: WebhookDeliveryConfig = {
  maxRetries: 3,
  timeoutMs: 10000, // 10 seconds
  initialBackoffMs: 1000, // 1 second
  maxBackoffMs: 60000, // 1 minute
};

export class WebhookDeliveryService {
  private deliveryAttempts: Map<string, WebhookDeliveryAttempt[]> = new Map();

  constructor(private config: WebhookDeliveryConfig = DEFAULT_CONFIG) {}

  /**
   * Deliver webhook with retries
   */
  async deliver(
    subscription: WebhookSubscription,
    payload: WebhookPayload
  ): Promise<WebhookDeliveryAttempt> {
    let attempt = 0;
    let lastAttempt: WebhookDeliveryAttempt | null = null;

    while (attempt < this.config.maxRetries) {
      attempt++;

      const attemptResult = await this.attemptDelivery(
        subscription,
        payload,
        attempt
      );

      lastAttempt = attemptResult;

      // Track attempt
      if (!this.deliveryAttempts.has(subscription.subscription_id)) {
        this.deliveryAttempts.set(subscription.subscription_id, []);
      }
      this.deliveryAttempts.get(subscription.subscription_id)!.push(attemptResult);

      // Success - no need to retry
      if (attemptResult.status === 'success') {
        logger.info(
          {
            subscriptionId: subscription.subscription_id,
            eventType: payload.event_type,
            attempt,
          },
          'Webhook delivered successfully'
        );
        return attemptResult;
      }

      // Failure - wait before retry
      if (attempt < this.config.maxRetries) {
        const backoff = this.calculateBackoff(attempt);
        logger.warn(
          {
            subscriptionId: subscription.subscription_id,
            eventType: payload.event_type,
            attempt,
            nextRetryMs: backoff,
          },
          'Webhook delivery failed, retrying'
        );
        await this.sleep(backoff);
      }
    }

    logger.error(
      {
        subscriptionId: subscription.subscription_id,
        eventType: payload.event_type,
        attempts: this.config.maxRetries,
      },
      'Webhook delivery failed after all retries'
    );

    return lastAttempt!;
  }

  /**
   * Attempt single webhook delivery
   */
  private async attemptDelivery(
    subscription: WebhookSubscription,
    payload: WebhookPayload,
    attemptNumber: number
  ): Promise<WebhookDeliveryAttempt> {
    const attempt: WebhookDeliveryAttempt = {
      attempt_id: `${payload.event_id}-${attemptNumber}`,
      subscription_id: subscription.subscription_id,
      payload,
      status: 'pending',
      attempt_number: attemptNumber,
      attempted_at: new Date().toISOString(),
    };

    const startTime = Date.now();

    try {
      // Generate HMAC signature
      const signature = this.generateSignature(payload, subscription.secret);

      // Create fetch request with timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.config.timeoutMs);

      const response = await fetch(subscription.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Webhook-Signature': signature,
          'X-Webhook-Event-Type': payload.event_type,
          'X-Webhook-Event-ID': payload.event_id,
          'User-Agent': 'Olumi-Collaboration-Service/1.0',
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      }).finally(() => clearTimeout(timeoutId));

      attempt.response_time_ms = Date.now() - startTime;
      attempt.http_status_code = response.status;

      // Check if successful (2xx status)
      if (response.ok) {
        attempt.status = 'success';
      } else {
        attempt.status = 'failure';
        attempt.error_message = `HTTP ${response.status}: ${response.statusText}`;
      }
    } catch (err: any) {
      attempt.response_time_ms = Date.now() - startTime;

      if (err.name === 'AbortError') {
        attempt.status = 'timeout';
        attempt.error_message = `Request timeout after ${this.config.timeoutMs}ms`;
      } else {
        attempt.status = 'failure';
        attempt.error_message = err.message || 'Unknown error';
      }
    }

    return attempt;
  }

  /**
   * Generate HMAC signature for webhook payload
   */
  private generateSignature(payload: WebhookPayload, secret: string): string {
    const payloadString = JSON.stringify(payload);
    const hmac = createHmac('sha256', secret);
    hmac.update(payloadString);
    return `sha256=${hmac.digest('hex')}`;
  }

  /**
   * Calculate exponential backoff
   */
  private calculateBackoff(attempt: number): number {
    const backoff = Math.min(
      this.config.initialBackoffMs * Math.pow(2, attempt - 1),
      this.config.maxBackoffMs
    );
    // Add jitter (±20%)
    const jitter = backoff * 0.2 * (Math.random() * 2 - 1);
    return Math.round(backoff + jitter);
  }

  /**
   * Sleep for specified milliseconds
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Get delivery attempts for a subscription
   */
  getDeliveryAttempts(subscriptionId: string): WebhookDeliveryAttempt[] {
    return this.deliveryAttempts.get(subscriptionId) || [];
  }

  /**
   * Get delivery stats
   */
  getStats(): {
    totalSubscriptions: number;
    totalAttempts: number;
    successfulAttempts: number;
    failedAttempts: number;
  } {
    let totalAttempts = 0;
    let successfulAttempts = 0;
    let failedAttempts = 0;

    for (const attempts of this.deliveryAttempts.values()) {
      totalAttempts += attempts.length;
      successfulAttempts += attempts.filter((a) => a.status === 'success').length;
      failedAttempts += attempts.filter((a) => a.status === 'failure' || a.status === 'timeout').length;
    }

    return {
      totalSubscriptions: this.deliveryAttempts.size,
      totalAttempts,
      successfulAttempts,
      failedAttempts,
    };
  }
}
