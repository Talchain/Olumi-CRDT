/**
 * Canonical snapshot types and utilities
 */

import { BoardDocument } from './board';

/**
 * Canonical BoardSnapshot - deterministic, hashable representation
 * Field ordering is stable and normalized
 */
export interface CanonicalBoardSnapshot {
  // Metadata (excluded from hash)
  meta: {
    version: number;
    schemaVersion: string;
  };

  // Board identification
  board: {
    id: string;
    orgId: string;
    teamId: string;
    title: string;
    description?: string;
    status: 'draft' | 'active' | 'archived';
    tags: string[]; // Always sorted
  };

  // Decision model - all arrays sorted by ID for determinism
  model: {
    goals: Array<{
      id: string;
      content: string;
      priority?: 'high' | 'medium' | 'low';
      position: { x: number; y: number };
    }>;
    options: Array<{
      id: string;
      content: string;
      description?: string;
      position: { x: number; y: number };
    }>;
    outcomes: Array<{
      id: string;
      content: string;
      probability?: number;
      impact?: number;
      linkedOptionIds: string[]; // Sorted
      position: { x: number; y: number };
    }>;
    assumptions: Array<{
      id: string;
      content: string;
      confidence?: 'high' | 'medium' | 'low';
      linkedEntityIds: string[]; // Sorted
      position: { x: number; y: number };
    }>;
    evidence: Array<{
      id: string;
      content: string;
      source?: string;
      credibility?: number;
      linkedAssumptionIds: string[]; // Sorted
      position: { x: number; y: number };
    }>;
    edges: Array<{
      id: string;
      source: string;
      target: string;
      type: 'supports' | 'opposes' | 'relates' | 'influences';
      weight?: number;
    }>;
  };
}

/**
 * Snapshot record persisted in database
 */
export interface BoardSnapshotRecord {
  snapshotId: string;
  snapshotHash: string;
  boardId: string;
  orgId: string;
  teamId: string;
  createdAt: string;
  createdByUserId: string;
  parentSnapshotId?: string;
  name?: string; // User-provided name
  snapshot: CanonicalBoardSnapshot;
  isImmutable: boolean; // Set to true once referenced by a run
}

/**
 * Snapshot creation request
 */
export interface CreateSnapshotRequest {
  boardId: string;
  userId: string;
  name?: string;
  triggerType: 'manual' | 'run' | 'milestone';
}

/**
 * Snapshot metadata for provenance
 */
export interface SnapshotProvenance {
  snapshotId: string;
  snapshotHash: string;
  parentSnapshotId?: string;
  uniqueEditorCount: number;
  editCount: number;
  createdAt: string;
  createdByUserId: string;
}

/**
 * Convert BoardDocument to CanonicalBoardSnapshot
 */
export function toCanonicalSnapshot(
  board: BoardDocument,
  teamId: string
): CanonicalBoardSnapshot {
  // Sort helper
  const sortById = <T extends { id: string }>(arr: T[]): T[] => {
    return [...arr].sort((a, b) => a.id.localeCompare(b.id));
  };

  const sortStrings = (arr: string[]): string[] => {
    return [...arr].sort();
  };

  return {
    meta: {
      version: 1,
      schemaVersion: '2.0.0',
    },
    board: {
      id: board.id,
      orgId: board.orgId,
      teamId: teamId,
      title: board.title,
      description: board.description,
      status: board.status,
      tags: board.tags ? sortStrings(board.tags) : [],
    },
    model: {
      goals: sortById(
        board.goals.map((g) => ({
          id: g.id,
          content: g.content,
          priority: g.priority,
          position: { x: g.position.x, y: g.position.y },
        }))
      ),
      options: sortById(
        board.options.map((o) => ({
          id: o.id,
          content: o.content,
          description: o.description,
          position: { x: o.position.x, y: o.position.y },
        }))
      ),
      outcomes: sortById(
        board.outcomes.map((o) => ({
          id: o.id,
          content: o.content,
          probability: o.probability,
          impact: o.impact,
          linkedOptionIds: sortStrings(o.linkedOptionIds),
          position: { x: o.position.x, y: o.position.y },
        }))
      ),
      assumptions: sortById(
        board.assumptions.map((a) => ({
          id: a.id,
          content: a.content,
          confidence: a.confidence,
          linkedEntityIds: sortStrings(a.linkedEntityIds),
          position: { x: a.position.x, y: a.position.y },
        }))
      ),
      evidence: sortById(
        board.evidence.map((e) => ({
          id: e.id,
          content: e.content,
          source: e.source,
          credibility: e.credibility,
          linkedAssumptionIds: sortStrings(e.linkedAssumptionIds),
          position: { x: e.position.x, y: e.position.y },
        }))
      ),
      edges: sortById(
        board.edges.map((e) => ({
          id: e.id,
          source: e.source,
          target: e.target,
          type: e.type,
          weight: e.weight,
        }))
      ),
    },
  };
}

/**
 * Serialize canonical snapshot for hashing
 * Uses deterministic JSON serialization
 */
export function serializeForHash(snapshot: CanonicalBoardSnapshot): string {
  // Use JSON.stringify with sorted keys
  return JSON.stringify(snapshot.model, null, 0);
}
