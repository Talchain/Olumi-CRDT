/**
 * Board data structures for Olumi decision boards
 */

export interface Position {
  x: number;
  y: number;
}

export interface Goal {
  id: string;
  content: string;
  priority?: 'high' | 'medium' | 'low';
  position: Position;
  createdBy: string;
  createdAt: string;
  deleted?: boolean;
}

export interface Option {
  id: string;
  content: string;
  description?: string;
  position: Position;
  createdBy: string;
  createdAt: string;
  deleted?: boolean;
}

export interface Outcome {
  id: string;
  content: string;
  probability?: number;
  impact?: number;
  position: Position;
  linkedOptionIds: string[];
  createdBy: string;
  createdAt: string;
  deleted?: boolean;
}

export interface Assumption {
  id: string;
  content: string;
  confidence?: 'high' | 'medium' | 'low';
  position: Position;
  linkedEntityIds: string[];
  createdBy: string;
  createdAt: string;
  deleted?: boolean;
}

export interface Evidence {
  id: string;
  content: string;
  source?: string;
  credibility?: number;
  position: Position;
  linkedAssumptionIds: string[];
  createdBy: string;
  createdAt: string;
  deleted?: boolean;
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

export interface BoardDocument {
  id: string;
  orgId: string;
  teamId: string; // Board belongs to a specific team
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

export interface BoardRunInput {
  boardId: string;
  snapshotVersion?: number;
  goals: Array<{
    id: string;
    content: string;
    priority?: string;
  }>;
  options: Array<{
    id: string;
    content: string;
    description?: string;
  }>;
  outcomes: Array<{
    id: string;
    content: string;
    probability?: number;
    impact?: number;
    linkedOptionIds: string[];
  }>;
  assumptions: Array<{
    id: string;
    content: string;
    confidence?: string;
    linkedEntityIds: string[];
  }>;
  evidence: Array<{
    id: string;
    content: string;
    source?: string;
    credibility?: number;
    linkedAssumptionIds: string[];
  }>;
  edges: Array<{
    id: string;
    source: string;
    target: string;
    type: string;
    weight?: number;
  }>;
}

export interface BoardSnapshot {
  id: string;
  boardId: string;
  orgId: string;
  version: number;
  data: BoardDocument;
  snapshotType: 'periodic' | 'on_run' | 'manual';
  createdAt: string;
}

export function transformToRunInput(board: BoardDocument): BoardRunInput {
  return {
    boardId: board.id,
    snapshotVersion: board.version,
    goals: board.goals
      .filter(g => !g.deleted)
      .map(g => ({
        id: g.id,
        content: g.content,
        priority: g.priority,
      })),
    options: board.options
      .filter(o => !o.deleted)
      .map(o => ({
        id: o.id,
        content: o.content,
        description: o.description,
      })),
    outcomes: board.outcomes
      .filter(o => !o.deleted)
      .map(o => ({
        id: o.id,
        content: o.content,
        probability: o.probability,
        impact: o.impact,
        linkedOptionIds: o.linkedOptionIds,
      })),
    assumptions: board.assumptions
      .filter(a => !a.deleted)
      .map(a => ({
        id: a.id,
        content: a.content,
        confidence: a.confidence,
        linkedEntityIds: a.linkedEntityIds,
      })),
    evidence: board.evidence
      .filter(e => !e.deleted)
      .map(e => ({
        id: e.id,
        content: e.content,
        source: e.source,
        credibility: e.credibility,
        linkedAssumptionIds: e.linkedAssumptionIds,
      })),
    edges: board.edges
      .filter(e => !e.deleted)
      .map(e => ({
        id: e.id,
        source: e.source,
        target: e.target,
        type: e.type,
        weight: e.weight,
      })),
  };
}
