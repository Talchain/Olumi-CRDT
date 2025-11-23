/**
 * WebSocket message types
 */

export enum MessageType {
  SYNC = 0x00,
  AWARENESS = 0x01,
  CONTROL = 0x02,
  PING = 0x03,
  PONG = 0x04,
}

export enum SyncMessageType {
  SYNC_STEP1 = 0x00,
  SYNC_STEP2 = 0x01,
  UPDATE = 0x02,
}

export enum ControlAction {
  USER_JOINED = 'user_joined',
  USER_LEFT = 'user_left',
  SNAPSHOT_CREATED = 'snapshot_created',
  BOARD_LOCKED = 'board_locked',
  BOARD_UNLOCKED = 'board_unlocked',
}

export enum ErrorCode {
  AUTH_INVALID = 'AUTH_INVALID',
  AUTH_FORBIDDEN = 'AUTH_FORBIDDEN',
  BOARD_NOT_FOUND = 'BOARD_NOT_FOUND',
  BOARD_LOCKED = 'BOARD_LOCKED',
  ORG_MISMATCH = 'ORG_MISMATCH',
  RATE_LIMIT_EXCEEDED = 'RATE_LIMIT_EXCEEDED',
  PAYLOAD_TOO_LARGE = 'PAYLOAD_TOO_LARGE',
  INVALID_MESSAGE = 'INVALID_MESSAGE',
  SYNC_FAILED = 'SYNC_FAILED',
  SERVER_ERROR = 'SERVER_ERROR',
}

export interface ControlMessage {
  type: 'control';
  action: ControlAction;
  data: Record<string, any>;
}

export interface ErrorMessage {
  type: 'error';
  code: ErrorCode;
  message: string;
  details?: any;
}

export interface PingMessage {
  type: 'ping';
  timestamp: number;
}

export interface PongMessage {
  type: 'pong';
  timestamp: number;
}
