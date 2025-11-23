/**
 * Shared Event Type Definitions for Olumi Event Bus
 * Used by all services to publish and consume events
 */

/**
 * Base event interface that all events must implement
 */
export interface BaseEvent {
  event_id: string;
  event_type: string;
  timestamp: string;
  source_service: string;
  correlation_id?: string;
  user_id?: string;
  org_id?: string;
}

// ============================================================================
// COLLABORATION EVENTS (from collab-service)
// ============================================================================

export interface BoardCreatedEvent extends BaseEvent {
  event_type: 'BOARD_CREATED';
  board_id: string;
  board_name: string;
  created_by: string;
  team_id: string;
}

export interface BoardDeletedEvent extends BaseEvent {
  event_type: 'BOARD_DELETED';
  board_id: string;
  deleted_by: string;
  team_id: string;
}

export interface ElementVisibilityChangedEvent extends BaseEvent {
  event_type: 'ELEMENT_VISIBILITY_CHANGED';
  board_id: string;
  element_id: string;
  element_type: string;
  visibility_mode: 'public' | 'confidential';
  changed_by: string;
  rationale?: string;
}

// ============================================================================
// ACCESS REQUEST EVENTS
// ============================================================================

export interface AccessRequestCreatedEvent extends BaseEvent {
  event_type: 'ACCESS_REQUEST_CREATED';
  request_id: string;
  board_id: string;
  element_id: string;
  element_type: string;
  requester_id: string;
  requester_email: string;
  reason: string;
  status: 'pending';
}

export interface AccessRequestApprovedEvent extends BaseEvent {
  event_type: 'ACCESS_REQUEST_APPROVED';
  request_id: string;
  board_id: string;
  element_id: string;
  requester_id: string;
  requester_email: string;
  approved_by: string;
  approved_by_email: string;
  duration_days: number;
  expires_at: string;
}

export interface AccessRequestDeniedEvent extends BaseEvent {
  event_type: 'ACCESS_REQUEST_DENIED';
  request_id: string;
  board_id: string;
  element_id: string;
  requester_id: string;
  requester_email: string;
  denied_by: string;
  denied_by_email: string;
  denial_reason?: string;
}

export interface AccessRequestExpiredEvent extends BaseEvent {
  event_type: 'ACCESS_REQUEST_EXPIRED';
  request_id: string;
  board_id: string;
  element_id: string;
  requester_id: string;
  requester_email: string;
  expired_at: string;
}

export interface AccessRequestRevokedEvent extends BaseEvent {
  event_type: 'ACCESS_REQUEST_REVOKED';
  request_id: string;
  board_id: string;
  element_id: string;
  requester_id: string;
  requester_email: string;
  revoked_by: string;
  revoked_by_email: string;
  revocation_reason: string;
}

// ============================================================================
// USER EVENTS
// ============================================================================

export interface UserCreatedEvent extends BaseEvent {
  event_type: 'USER_CREATED';
  user_email: string;
  user_role: string;
}

export interface UserRoleChangedEvent extends BaseEvent {
  event_type: 'USER_ROLE_CHANGED';
  user_email: string;
  old_role: string;
  new_role: string;
  changed_by: string;
}

// ============================================================================
// NOTIFICATION EVENTS (consumed by notification-service)
// ============================================================================

export interface NotificationRequestedEvent extends BaseEvent {
  event_type: 'NOTIFICATION_REQUESTED';
  notification_type: 'ACCESS_REQUEST_CREATED' | 'ACCESS_REQUEST_APPROVED' | 'ACCESS_REQUEST_DENIED' | 'ACCESS_REQUEST_EXPIRED' | 'ACCESS_REQUEST_EXPIRING_SOON';
  recipient_user_id: string;
  recipient_email: string;
  subject: string;
  message: string;
  metadata?: Record<string, any>;
  channels?: Array<'email' | 'in_app' | 'slack'>;
}

// ============================================================================
// UNION TYPE OF ALL EVENTS
// ============================================================================

export type OlumiEvent =
  | BoardCreatedEvent
  | BoardDeletedEvent
  | ElementVisibilityChangedEvent
  | AccessRequestCreatedEvent
  | AccessRequestApprovedEvent
  | AccessRequestDeniedEvent
  | AccessRequestExpiredEvent
  | AccessRequestRevokedEvent
  | UserCreatedEvent
  | UserRoleChangedEvent
  | NotificationRequestedEvent;

// ============================================================================
// EVENT TYPE CONSTANTS
// ============================================================================

export const EVENT_TYPES = {
  // Collaboration
  BOARD_CREATED: 'BOARD_CREATED',
  BOARD_DELETED: 'BOARD_DELETED',
  ELEMENT_VISIBILITY_CHANGED: 'ELEMENT_VISIBILITY_CHANGED',

  // Access Requests
  ACCESS_REQUEST_CREATED: 'ACCESS_REQUEST_CREATED',
  ACCESS_REQUEST_APPROVED: 'ACCESS_REQUEST_APPROVED',
  ACCESS_REQUEST_DENIED: 'ACCESS_REQUEST_DENIED',
  ACCESS_REQUEST_EXPIRED: 'ACCESS_REQUEST_EXPIRED',
  ACCESS_REQUEST_REVOKED: 'ACCESS_REQUEST_REVOKED',

  // Users
  USER_CREATED: 'USER_CREATED',
  USER_ROLE_CHANGED: 'USER_ROLE_CHANGED',

  // Notifications
  NOTIFICATION_REQUESTED: 'NOTIFICATION_REQUESTED',
} as const;

export type EventType = typeof EVENT_TYPES[keyof typeof EVENT_TYPES];
