/**
 * Snapshot determinism and hashing tests
 */

import { BoardDocument } from '../src/types/board';
import { toCanonicalSnapshot, serializeForHash } from '../src/types/snapshot';
import { computeSnapshotHash } from '../src/utils/hash';

describe('Snapshot Determinism', () => {
  const createTestBoard = (): BoardDocument => ({
    id: 'board-123',
    orgId: 'org-456',
    ownerId: 'user-789',
    version: 1,
    createdAt: '2025-01-01T00:00:00Z',
    updatedAt: '2025-01-01T00:00:00Z',
    title: 'Test Board',
    description: 'A test decision board',
    goals: [
      {
        id: 'goal-1',
        content: 'Maximize revenue',
        priority: 'high',
        position: { x: 100, y: 200 },
        createdBy: 'user-1',
        createdAt: '2025-01-01T00:00:00Z',
      },
      {
        id: 'goal-2',
        content: 'Minimize cost',
        priority: 'medium',
        position: { x: 300, y: 200 },
        createdBy: 'user-2',
        createdAt: '2025-01-01T00:00:00Z',
      },
    ],
    options: [
      {
        id: 'option-1',
        content: 'Build new feature',
        description: 'Implement AI assistant',
        position: { x: 200, y: 400 },
        createdBy: 'user-1',
        createdAt: '2025-01-01T00:00:00Z',
      },
    ],
    outcomes: [
      {
        id: 'outcome-1',
        content: 'Increased user engagement',
        probability: 0.7,
        impact: 0.8,
        linkedOptionIds: ['option-1'],
        position: { x: 200, y: 600 },
        createdBy: 'user-1',
        createdAt: '2025-01-01T00:00:00Z',
      },
    ],
    assumptions: [
      {
        id: 'assumption-1',
        content: 'Users want AI features',
        confidence: 'high',
        linkedEntityIds: ['outcome-1'],
        position: { x: 400, y: 600 },
        createdBy: 'user-2',
        createdAt: '2025-01-01T00:00:00Z',
      },
    ],
    evidence: [
      {
        id: 'evidence-1',
        content: 'Survey shows 80% interest',
        source: 'User survey Q4 2024',
        credibility: 0.9,
        linkedAssumptionIds: ['assumption-1'],
        position: { x: 600, y: 600 },
        createdBy: 'user-3',
        createdAt: '2025-01-01T00:00:00Z',
      },
    ],
    edges: [
      {
        id: 'edge-1',
        source: 'option-1',
        target: 'outcome-1',
        type: 'supports',
        weight: 0.9,
        createdBy: 'user-1',
        createdAt: '2025-01-01T00:00:00Z',
      },
      {
        id: 'edge-2',
        source: 'goal-1',
        target: 'option-1',
        type: 'supports',
        weight: 0.8,
        createdBy: 'user-1',
        createdAt: '2025-01-01T00:00:00Z',
      },
    ],
    layout: {
      zoom: 1,
      panX: 0,
      panY: 0,
      viewportWidth: 1920,
      viewportHeight: 1080,
    },
    tags: ['strategy', 'product'],
    status: 'active',
  });

  describe('Canonical Representation', () => {
    it('should create canonical snapshot from board', () => {
      const board = createTestBoard();
      const snapshot = toCanonicalSnapshot(board, 'team-abc');

      expect(snapshot.board.id).toBe('board-123');
      expect(snapshot.board.orgId).toBe('org-456');
      expect(snapshot.board.teamId).toBe('team-abc');
      expect(snapshot.model.goals).toHaveLength(2);
      expect(snapshot.model.options).toHaveLength(1);
    });

    it('should sort arrays by ID for determinism', () => {
      const board = createTestBoard();
      const snapshot = toCanonicalSnapshot(board, 'team-abc');

      // Goals should be sorted by ID
      expect(snapshot.model.goals[0].id).toBe('goal-1');
      expect(snapshot.model.goals[1].id).toBe('goal-2');

      // Edges should be sorted by ID
      expect(snapshot.model.edges[0].id).toBe('edge-1');
      expect(snapshot.model.edges[1].id).toBe('edge-2');
    });

    it('should sort tags alphabetically', () => {
      const board = createTestBoard();
      board.tags = ['zebra', 'apple', 'banana'];

      const snapshot = toCanonicalSnapshot(board, 'team-abc');

      expect(snapshot.board.tags).toEqual(['apple', 'banana', 'zebra']);
    });

    it('should sort linked IDs in entities', () => {
      const board = createTestBoard();
      board.outcomes[0].linkedOptionIds = ['option-3', 'option-1', 'option-2'];

      const snapshot = toCanonicalSnapshot(board, 'team-abc');

      expect(snapshot.model.outcomes[0].linkedOptionIds).toEqual([
        'option-1',
        'option-2',
        'option-3',
      ]);
    });
  });

  describe('Hash Determinism', () => {
    it('should produce same hash for same board state', () => {
      const board1 = createTestBoard();
      const board2 = createTestBoard();

      const snapshot1 = toCanonicalSnapshot(board1, 'team-abc');
      const snapshot2 = toCanonicalSnapshot(board2, 'team-abc');

      const hash1 = computeSnapshotHash(snapshot1);
      const hash2 = computeSnapshotHash(snapshot2);

      expect(hash1).toBe(hash2);
    });

    it('should produce same hash regardless of array insertion order', () => {
      const board1 = createTestBoard();
      const board2 = createTestBoard();

      // Swap goal order in board2
      [board2.goals[0], board2.goals[1]] = [board2.goals[1], board2.goals[0]];

      const snapshot1 = toCanonicalSnapshot(board1, 'team-abc');
      const snapshot2 = toCanonicalSnapshot(board2, 'team-abc');

      const hash1 = computeSnapshotHash(snapshot1);
      const hash2 = computeSnapshotHash(snapshot2);

      // Hashes should be same because canonical form sorts by ID
      expect(hash1).toBe(hash2);
    });

    it('should produce different hash when content changes', () => {
      const board1 = createTestBoard();
      const board2 = createTestBoard();

      board2.goals[0].content = 'Different goal content';

      const snapshot1 = toCanonicalSnapshot(board1, 'team-abc');
      const snapshot2 = toCanonicalSnapshot(board2, 'team-abc');

      const hash1 = computeSnapshotHash(snapshot1);
      const hash2 = computeSnapshotHash(snapshot2);

      expect(hash1).not.toBe(hash2);
    });

    it('should produce different hash when entity added', () => {
      const board1 = createTestBoard();
      const board2 = createTestBoard();

      board2.goals.push({
        id: 'goal-3',
        content: 'New goal',
        priority: 'low',
        position: { x: 500, y: 200 },
        createdBy: 'user-3',
        createdAt: '2025-01-01T00:00:00Z',
      });

      const snapshot1 = toCanonicalSnapshot(board1, 'team-abc');
      const snapshot2 = toCanonicalSnapshot(board2, 'team-abc');

      const hash1 = computeSnapshotHash(snapshot1);
      const hash2 = computeSnapshotHash(snapshot2);

      expect(hash1).not.toBe(hash2);
    });

    it('should produce different hash when entity removed', () => {
      const board1 = createTestBoard();
      const board2 = createTestBoard();

      board2.goals = board2.goals.filter((g) => g.id !== 'goal-2');

      const snapshot1 = toCanonicalSnapshot(board1, 'team-abc');
      const snapshot2 = toCanonicalSnapshot(board2, 'team-abc');

      const hash1 = computeSnapshotHash(snapshot1);
      const hash2 = computeSnapshotHash(snapshot2);

      expect(hash1).not.toBe(hash2);
    });

    it('should produce same hash regardless of linked IDs order', () => {
      const board1 = createTestBoard();
      const board2 = createTestBoard();

      board1.outcomes[0].linkedOptionIds = ['option-1', 'option-2', 'option-3'];
      board2.outcomes[0].linkedOptionIds = ['option-3', 'option-1', 'option-2'];

      const snapshot1 = toCanonicalSnapshot(board1, 'team-abc');
      const snapshot2 = toCanonicalSnapshot(board2, 'team-abc');

      const hash1 = computeSnapshotHash(snapshot1);
      const hash2 = computeSnapshotHash(snapshot2);

      // Should be same because linked IDs are sorted
      expect(hash1).toBe(hash2);
    });
  });

  describe('Hash Characteristics', () => {
    it('should produce SHA-256 hash (64 hex characters)', () => {
      const board = createTestBoard();
      const snapshot = toCanonicalSnapshot(board, 'team-abc');
      const hash = computeSnapshotHash(snapshot);

      expect(hash).toMatch(/^[a-f0-9]{64}$/);
    });

    it('should be different from hash of slightly modified board', () => {
      const board1 = createTestBoard();
      const board2 = createTestBoard();

      // Very small change
      board2.goals[0].priority = 'medium'; // Changed from 'high'

      const snapshot1 = toCanonicalSnapshot(board1, 'team-abc');
      const snapshot2 = toCanonicalSnapshot(board2, 'team-abc');

      const hash1 = computeSnapshotHash(snapshot1);
      const hash2 = computeSnapshotHash(snapshot2);

      expect(hash1).not.toBe(hash2);
    });
  });

  describe('Serialization for Hash', () => {
    it('should produce deterministic JSON serialization', () => {
      const board = createTestBoard();
      const snapshot = toCanonicalSnapshot(board, 'team-abc');

      const serialized1 = serializeForHash(snapshot);
      const serialized2 = serializeForHash(snapshot);

      expect(serialized1).toBe(serialized2);
    });

    it('should be stable across multiple calls', () => {
      const board = createTestBoard();

      const hashes: string[] = [];
      for (let i = 0; i < 10; i++) {
        const snapshot = toCanonicalSnapshot(board, 'team-abc');
        const hash = computeSnapshotHash(snapshot);
        hashes.push(hash);
      }

      // All hashes should be identical
      expect(new Set(hashes).size).toBe(1);
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty board', () => {
      const board: BoardDocument = {
        id: 'board-empty',
        orgId: 'org-456',
        ownerId: 'user-789',
        version: 1,
        createdAt: '2025-01-01T00:00:00Z',
        updatedAt: '2025-01-01T00:00:00Z',
        title: 'Empty Board',
        goals: [],
        options: [],
        outcomes: [],
        assumptions: [],
        evidence: [],
        edges: [],
        layout: {
          zoom: 1,
          panX: 0,
          panY: 0,
          viewportWidth: 1920,
          viewportHeight: 1080,
        },
        status: 'draft',
      };

      const snapshot = toCanonicalSnapshot(board, 'team-abc');
      const hash = computeSnapshotHash(snapshot);

      expect(hash).toMatch(/^[a-f0-9]{64}$/);
      expect(snapshot.model.goals).toEqual([]);
    });

    it('should handle board with undefined optional fields', () => {
      const board = createTestBoard();
      board.description = undefined;
      board.tags = undefined;

      const snapshot = toCanonicalSnapshot(board, 'team-abc');
      const hash = computeSnapshotHash(snapshot);

      expect(hash).toMatch(/^[a-f0-9]{64}$/);
      expect(snapshot.board.description).toBeUndefined();
      expect(snapshot.board.tags).toEqual([]);
    });

    it('should handle entities with optional fields', () => {
      const board = createTestBoard();
      board.goals[0].priority = undefined;
      board.outcomes[0].probability = undefined;
      board.outcomes[0].impact = undefined;

      const snapshot = toCanonicalSnapshot(board, 'team-abc');
      const hash = computeSnapshotHash(snapshot);

      expect(hash).toMatch(/^[a-f0-9]{64}$/);
    });
  });
});
