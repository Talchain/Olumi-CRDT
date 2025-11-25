/**
 * Webhook System Types (I.1)
 *
 * Enables external integrations to receive real-time events from the collaboration service.
 */

export type WebhookEventType =
  | 'board.created'
  | 'board.updated'
  | 'board.deleted'
  | 'snapshot.created'
  | 'review.requested'
  | 'review.completed'
  | 'comment.added'
  | 'visibility.changed';

export interface WebhookSubscription {
  subscription_id: string;
  url: string;
  event_types: WebhookEventType[];
  secret: string; // For HMAC signature verification
  active: boolean;
  created_by_user_id: string;
  created_at: string;
  updated_at: string;
  last_triggered_at?: string;
  failure_count: number;
}

export interface WebhookPayload {
  event_id: string;
  event_type: WebhookEventType;
  timestamp: string;
  data: Record<string, any>;
}

export interface WebhookDeliveryAttempt {
  attempt_id: string;
  subscription_id: string;
  payload: WebhookPayload;
  status: 'pending' | 'success' | 'failure' | 'timeout';
  http_status_code?: number;
  error_message?: string;
  attempt_number: number;
  attempted_at: string;
  response_time_ms?: number;
}
