/**
 * Shared types for collaboration client
 */

export interface Position {
  x: number;
  y: number;
}

export interface BoardEntity {
  id: string;
  content: string;
  position: Position;
  createdBy: string;
  createdAt: string;
  deleted?: boolean;
}

export interface Goal extends BoardEntity {
  priority?: 'high' | 'medium' | 'low';
}

export interface Option extends BoardEntity {
  description?: string;
}

export interface Outcome extends BoardEntity {
  probability?: number;
  impact?: number;
  linkedOptionIds: string[];
}

export interface Assumption extends BoardEntity {
  confidence?: 'high' | 'medium' | 'low';
  linkedEntityIds: string[];
}

export interface Evidence extends BoardEntity {
  source?: string;
  credibility?: number;
  linkedAssumptionIds: string[];
}

export interface Edge {
  id: string;
  source: string;
  target: string;
  type: 'supports' | 'opposes' | 'relates' | 'influences';
  weight?: number;
  createdBy: string;
  createdAt: string;
  deleted?: boolean;
}

export interface LayoutData {
  zoom: number;
  panX: number;
  panY: number;
  viewportWidth: number;
  viewportHeight: number;
}

export interface BoardState {
  id: string;
  orgId: string;
  ownerId: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  title: string;
  description?: string;
  goals: Goal[];
  options: Option[];
  outcomes: Outcome[];
  assumptions: Assumption[];
  evidence: Evidence[];
  edges: Edge[];
  layout: LayoutData;
  tags?: string[];
  status: 'draft' | 'active' | 'archived';
}

export interface User {
  id: string;
  name: string;
  email: string;
  color: string;
  avatarUrl?: string;
}

export interface PresenceState {
  user: User;
  cursor?: {
    x: number;
    y: number;
    entityId?: string;
  };
  selection?: {
    entityIds: string[];
  };
  lastSeen: number;
}

export interface CollaborationConfig {
  serverUrl: string;
  boardId: string;
  authToken: string;
  currentUser: User;
  onError?: (error: Error) => void;
  onConnectionChange?: (connected: boolean) => void;
}

export enum ConnectionStatus {
  DISCONNECTED = 'disconnected',
  CONNECTING = 'connecting',
  CONNECTED = 'connected',
  RECONNECTING = 'reconnecting',
  ERROR = 'error',
}

export interface CollaborationState {
  status: ConnectionStatus;
  presence: Map<number, PresenceState>;
  errorMessage?: string;
}
