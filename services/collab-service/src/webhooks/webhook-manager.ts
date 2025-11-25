/**
 * Webhook Manager (I.1)
 *
 * Manages webhook subscriptions and triggers deliveries.
 * In production, store subscriptions in database.
 */

import { v4 as uuidv4 } from 'uuid';
import { pino } from 'pino';
import {
  WebhookSubscription,
  WebhookPayload,
  WebhookEventType,
} from './webhook-types';
import { WebhookDeliveryService } from './webhook-delivery';

const logger = pino();

export class WebhookManager {
  private subscriptions: Map<string, WebhookSubscription> = new Map();
  private deliveryService: WebhookDeliveryService;

  constructor() {
    this.deliveryService = new WebhookDeliveryService();
  }

  /**
   * Create webhook subscription
   */
  createSubscription(params: {
    url: string;
    event_types: WebhookEventType[];
    secret: string;
    created_by_user_id: string;
  }): WebhookSubscription {
    const subscription: WebhookSubscription = {
      subscription_id: uuidv4(),
      url: params.url,
      event_types: params.event_types,
      secret: params.secret,
      active: true,
      created_by_user_id: params.created_by_user_id,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      failure_count: 0,
    };

    this.subscriptions.set(subscription.subscription_id, subscription);

    logger.info(
      {
        subscriptionId: subscription.subscription_id,
        url: params.url,
        eventTypes: params.event_types,
      },
      'Webhook subscription created'
    );

    return subscription;
  }

  /**
   * Get subscription by ID
   */
  getSubscription(subscriptionId: string): WebhookSubscription | undefined {
    return this.subscriptions.get(subscriptionId);
  }

  /**
   * List all subscriptions
   */
  listSubscriptions(): WebhookSubscription[] {
    return Array.from(this.subscriptions.values());
  }

  /**
   * Update subscription
   */
  updateSubscription(
    subscriptionId: string,
    updates: Partial<Pick<WebhookSubscription, 'url' | 'event_types' | 'active'>>
  ): WebhookSubscription | null {
    const subscription = this.subscriptions.get(subscriptionId);
    if (!subscription) return null;

    const updated: WebhookSubscription = {
      ...subscription,
      ...updates,
      updated_at: new Date().toISOString(),
    };

    this.subscriptions.set(subscriptionId, updated);
    return updated;
  }

  /**
   * Delete subscription
   */
  deleteSubscription(subscriptionId: string): boolean {
    return this.subscriptions.delete(subscriptionId);
  }

  /**
   * Trigger webhook event
   */
  async triggerEvent(eventType: WebhookEventType, data: Record<string, any>): Promise<void> {
    const payload: WebhookPayload = {
      event_id: uuidv4(),
      event_type: eventType,
      timestamp: new Date().toISOString(),
      data,
    };

    // Find subscriptions that match this event type
    const matchingSubscriptions = Array.from(this.subscriptions.values()).filter(
      (sub) => sub.active && sub.event_types.includes(eventType)
    );

    if (matchingSubscriptions.length === 0) {
      logger.debug({ eventType }, 'No active subscriptions for event');
      return;
    }

    logger.info(
      {
        eventType,
        eventId: payload.event_id,
        subscriptions: matchingSubscriptions.length,
      },
      'Triggering webhook event'
    );

    // Deliver to all matching subscriptions (in parallel)
    const deliveries = matchingSubscriptions.map(async (subscription) => {
      try {
        const attempt = await this.deliveryService.deliver(subscription, payload);

        // Update subscription metadata
        subscription.last_triggered_at = new Date().toISOString();

        if (attempt.status === 'success') {
          subscription.failure_count = 0;
        } else {
          subscription.failure_count++;

          // Disable subscription after too many failures
          if (subscription.failure_count >= 10) {
            subscription.active = false;
            logger.warn(
              { subscriptionId: subscription.subscription_id },
              'Webhook subscription disabled due to repeated failures'
            );
          }
        }

        this.subscriptions.set(subscription.subscription_id, subscription);
      } catch (err) {
        logger.error(
          { err, subscriptionId: subscription.subscription_id },
          'Failed to deliver webhook'
        );
      }
    });

    await Promise.allSettled(deliveries);
  }

  /**
   * Get webhook statistics
   */
  getStats(): {
    totalSubscriptions: number;
    activeSubscriptions: number;
    deliveryStats: ReturnType<WebhookDeliveryService['getStats']>;
  } {
    const subscriptions = Array.from(this.subscriptions.values());

    return {
      totalSubscriptions: subscriptions.length,
      activeSubscriptions: subscriptions.filter((s) => s.active).length,
      deliveryStats: this.deliveryService.getStats(),
    };
  }
}
