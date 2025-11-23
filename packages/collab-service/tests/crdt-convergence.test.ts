/**
 * CRDT Convergence Tests
 *
 * Tests that multiple clients editing simultaneously converge to the same state.
 * Ensures CRDT conflict-free replication works correctly under various scenarios.
 */

import * as Y from 'yjs';
import { DocumentManager } from '../src/collab/document-manager';
import { DatabaseClient } from '../src/database/client';
import { toCanonicalSnapshot } from '../src/types/snapshot';
import { computeSnapshotHash } from '../src/utils/hash';
import { BoardDocument } from '../src/types/board';

// Mock database client for testing
class MockDatabaseClient extends DatabaseClient {
  private mockBoards: Map<string, any> = new Map();
  private mockUpdates: Map<string, Uint8Array[]> = new Map();

  async getBoard(boardId: string) {
    return this.mockBoards.get(boardId) || null;
  }

  async storeBoard(boardId: string, orgId: string, ownerId: string, data: BoardDocument) {
    this.mockBoards.set(boardId, { orgId, teamId: 'team-test', ownerId, data });
  }

  async storeYjsUpdate(boardId: string, orgId: string, clock: number, update: Uint8Array) {
    if (!this.mockUpdates.has(boardId)) {
      this.mockUpdates.set(boardId, []);
    }
    this.mockUpdates.get(boardId)!.push(update);
  }

  async getYjsUpdates(boardId: string): Promise<Uint8Array[]> {
    return this.mockUpdates.get(boardId) || [];
  }

  async close() {
    // No-op for tests
  }
}

/**
 * Test client that wraps a Yjs document
 */
class TestClient {
  public ydoc: Y.Doc;
  private boardId: string;
  private goals: Y.Map<any>;
  private options: Y.Map<any>;
  private edges: Y.Array<any>;

  constructor(boardId: string) {
    this.boardId = boardId;
    this.ydoc = new Y.Doc();

    // Set up Yjs structures matching DocumentManager
    this.goals = this.ydoc.getMap('goals');
    this.options = this.ydoc.getMap('options');
    this.edges = this.ydoc.getArray('edges');
  }

  /**
   * Add a goal to the board
   */
  addGoal(goal: { id: string; content: string; priority?: string }) {
    this.ydoc.transact(() => {
      this.goals.set(goal.id, {
        id: goal.id,
        content: goal.content,
        priority: goal.priority || 'medium',
        position: { x: 100, y: 100 },
        createdBy: 'test-user',
        createdAt: new Date().toISOString(),
      });
    });
  }

  /**
   * Update a goal
   */
  updateGoal(goalId: string, updates: Partial<{ content: string; priority: string }>) {
    this.ydoc.transact(() => {
      const goal = this.goals.get(goalId);
      if (goal) {
        this.goals.set(goalId, { ...goal, ...updates });
      }
    });
  }

  /**
   * Delete a goal
   */
  deleteGoal(goalId: string) {
    this.ydoc.transact(() => {
      const goal = this.goals.get(goalId);
      if (goal) {
        this.goals.set(goalId, { ...goal, deleted: true });
      }
    });
  }

  /**
   * Add an option
   */
  addOption(option: { id: string; content: string }) {
    this.ydoc.transact(() => {
      this.options.set(option.id, {
        id: option.id,
        content: option.content,
        position: { x: 200, y: 200 },
        createdBy: 'test-user',
        createdAt: new Date().toISOString(),
      });
    });
  }

  /**
   * Add an edge
   */
  addEdge(edge: { id: string; source: string; target: string; type?: string }) {
    this.ydoc.transact(() => {
      this.edges.push([{
        id: edge.id,
        source: edge.source,
        target: edge.target,
        type: edge.type || 'supports',
        weight: 1.0,
        createdBy: 'test-user',
        createdAt: new Date().toISOString(),
      }]);
    });
  }

  /**
   * Apply an update from another client
   */
  applyUpdate(update: Uint8Array) {
    Y.applyUpdate(this.ydoc, update);
  }

  /**
   * Get document state as update
   */
  getStateAsUpdate(): Uint8Array {
    return Y.encodeStateAsUpdate(this.ydoc);
  }

  /**
   * Serialize to BoardDocument
   */
  serializeBoardDocument(): BoardDocument {
    const goals = Array.from(this.goals.values());
    const options = Array.from(this.options.values());
    const edges = this.edges.toArray();

    return {
      id: this.boardId,
      orgId: 'org-test',
      teamId: 'team-test',
      ownerId: 'user-test',
      version: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      title: 'Test Board',
      goals,
      options,
      outcomes: [],
      assumptions: [],
      evidence: [],
      edges,
      layout: {
        zoom: 1,
        panX: 0,
        panY: 0,
        viewportWidth: 1920,
        viewportHeight: 1080,
      },
      status: 'active',
    };
  }
}

/**
 * Sync all clients by exchanging updates
 */
async function syncClients(clients: TestClient[]): Promise<void> {
  // Collect all updates from all clients
  const updates = clients.map((client) => client.getStateAsUpdate());

  // Apply all updates to all clients (simulating full mesh sync)
  for (let i = 0; i < clients.length; i++) {
    for (let j = 0; j < updates.length; j++) {
      if (i !== j) {
        clients[i].applyUpdate(updates[j]);
      }
    }
  }

  // Small delay to ensure convergence
  await new Promise((resolve) => setTimeout(resolve, 10));
}

/**
 * Wait for all clients to converge (with timeout)
 */
async function waitForConvergence(
  clients: TestClient[],
  maxAttempts: number = 10
): Promise<void> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    await syncClients(clients);

    // Check if all states are identical
    const states = clients.map((c) => c.serializeBoardDocument());
    const hashes = states.map((s) => computeSnapshotHash(toCanonicalSnapshot(s, 'team-test')));

    if (new Set(hashes).size === 1) {
      return; // Converged!
    }
  }

  throw new Error('Clients failed to converge within timeout');
}

describe('CRDT Convergence', () => {
  describe('Multi-client Edits', () => {
    it('should converge after concurrent goal additions', async () => {
      const clients = [
        new TestClient('board-123'),
        new TestClient('board-123'),
        new TestClient('board-123'),
      ];

      // Each client adds a different goal simultaneously
      clients[0].addGoal({ id: 'goal-A', content: 'Goal A' });
      clients[1].addGoal({ id: 'goal-B', content: 'Goal B' });
      clients[2].addGoal({ id: 'goal-C', content: 'Goal C' });

      // Wait for convergence
      await waitForConvergence(clients);

      // All clients should have identical state
      const states = clients.map((c) => c.serializeBoardDocument());
      const hashes = states.map((s) => computeSnapshotHash(toCanonicalSnapshot(s, 'team-test')));

      expect(new Set(hashes).size).toBe(1);

      // Verify all goals are present
      const finalGoals = states[0].goals;
      expect(finalGoals).toHaveLength(3);
      expect(finalGoals.map((g) => g.id).sort()).toEqual(['goal-A', 'goal-B', 'goal-C']);
    });

    it('should converge after conflicting edits to same entity', async () => {
      const clients = [
        new TestClient('board-123'),
        new TestClient('board-123'),
      ];

      // Both clients start with the same goal
      clients[0].addGoal({ id: 'goal-1', content: 'Original' });
      await syncClients(clients);

      // Both clients update the same goal with different content
      clients[0].updateGoal('goal-1', { content: 'Modified by Client 0' });
      clients[1].updateGoal('goal-1', { content: 'Modified by Client 1' });

      // Wait for convergence
      await waitForConvergence(clients);

      // All clients should have identical state (one update wins)
      const states = clients.map((c) => c.serializeBoardDocument());
      const hashes = states.map((s) => computeSnapshotHash(toCanonicalSnapshot(s, 'team-test')));

      expect(new Set(hashes).size).toBe(1);

      // Both should have the same content (last write wins in Yjs Map)
      expect(states[0].goals[0].content).toBe(states[1].goals[0].content);
    });

    it('should handle concurrent additions and deletions', async () => {
      const clients = [
        new TestClient('board-123'),
        new TestClient('board-123'),
        new TestClient('board-123'),
      ];

      // Start with shared state
      clients[0].addGoal({ id: 'goal-1', content: 'Goal 1' });
      clients[0].addGoal({ id: 'goal-2', content: 'Goal 2' });
      await syncClients(clients);

      // Concurrent operations
      clients[0].addGoal({ id: 'goal-3', content: 'Goal 3' });
      clients[1].deleteGoal('goal-1');
      clients[2].updateGoal('goal-2', { content: 'Goal 2 Updated' });

      // Wait for convergence
      await waitForConvergence(clients);

      // All clients should have identical state
      const states = clients.map((c) => c.serializeBoardDocument());
      const hashes = states.map((s) => computeSnapshotHash(toCanonicalSnapshot(s, 'team-test')));

      expect(new Set(hashes).size).toBe(1);

      // Verify final state
      const activeGoals = states[0].goals.filter((g) => !g.deleted);
      expect(activeGoals).toHaveLength(2); // goal-2 and goal-3
    });
  });

  describe('Five-Client Stress Test', () => {
    it('should converge with 5 clients making diverse edits', async () => {
      const clients = Array.from({ length: 5 }, () => new TestClient('board-stress'));

      // Initial shared state
      clients[0].addGoal({ id: 'goal-shared', content: 'Shared Goal' });
      clients[0].addOption({ id: 'option-shared', content: 'Shared Option' });
      await syncClients(clients);

      // Each client makes different edits
      clients[0].addGoal({ id: 'goal-A', content: 'Goal A' });
      clients[1].addGoal({ id: 'goal-B', content: 'Goal B' });
      clients[2].updateGoal('goal-shared', { content: 'Updated Shared Goal' });
      clients[3].addOption({ id: 'option-C', content: 'Option C' });
      clients[4].addEdge({ id: 'edge-1', source: 'goal-A', target: 'option-shared' });

      // Wait for convergence
      await waitForConvergence(clients);

      // All clients should have identical state
      const states = clients.map((c) => c.serializeBoardDocument());
      const hashes = states.map((s) => computeSnapshotHash(toCanonicalSnapshot(s, 'team-test')));

      expect(new Set(hashes).size).toBe(1);

      // Verify all edits are present
      const finalGoals = states[0].goals;
      const finalOptions = states[0].options;
      const finalEdges = states[0].edges;

      expect(finalGoals).toHaveLength(3); // goal-shared, goal-A, goal-B
      expect(finalOptions).toHaveLength(2); // option-shared, option-C
      expect(finalEdges).toHaveLength(1); // edge-1
    });

    it('should converge after sequential rounds of concurrent edits', async () => {
      const clients = Array.from({ length: 5 }, () => new TestClient('board-sequential'));

      // Round 1: All add goals
      for (let i = 0; i < clients.length; i++) {
        clients[i].addGoal({ id: `goal-round1-${i}`, content: `Round 1 Goal ${i}` });
      }
      await waitForConvergence(clients);

      // Round 2: All update goals
      for (let i = 0; i < clients.length; i++) {
        clients[i].updateGoal(`goal-round1-${i}`, { content: `Updated Goal ${i}` });
      }
      await waitForConvergence(clients);

      // Round 3: Mix of additions and deletions
      clients[0].deleteGoal('goal-round1-0');
      clients[1].addGoal({ id: 'goal-round3-1', content: 'Round 3 Goal 1' });
      clients[2].updateGoal('goal-round1-2', { priority: 'high' });
      await waitForConvergence(clients);

      // All clients should have identical state
      const states = clients.map((c) => c.serializeBoardDocument());
      const hashes = states.map((s) => computeSnapshotHash(toCanonicalSnapshot(s, 'team-test')));

      expect(new Set(hashes).size).toBe(1);
    });
  });

  describe('Edge Cases', () => {
    it('should handle rapid successive edits from single client', async () => {
      const clients = [
        new TestClient('board-rapid'),
        new TestClient('board-rapid'),
      ];

      // Client 0 makes many rapid edits
      for (let i = 0; i < 10; i++) {
        clients[0].addGoal({ id: `goal-${i}`, content: `Goal ${i}` });
      }

      // Wait for convergence
      await waitForConvergence(clients);

      // All clients should have identical state
      const states = clients.map((c) => c.serializeBoardDocument());
      const hashes = states.map((s) => computeSnapshotHash(toCanonicalSnapshot(s, 'team-test')));

      expect(new Set(hashes).size).toBe(1);
      expect(states[0].goals).toHaveLength(10);
    });

    it('should converge when clients start with different initial states', async () => {
      const clients = [
        new TestClient('board-diverged'),
        new TestClient('board-diverged'),
      ];

      // Clients start with different initial states (simulating late join)
      clients[0].addGoal({ id: 'goal-early', content: 'Early Goal' });

      // Client 1 starts later
      await new Promise((resolve) => setTimeout(resolve, 5));
      clients[1].addGoal({ id: 'goal-late', content: 'Late Goal' });

      // Now sync them
      await waitForConvergence(clients);

      // Should converge to unified state
      const states = clients.map((c) => c.serializeBoardDocument());
      const hashes = states.map((s) => computeSnapshotHash(toCanonicalSnapshot(s, 'team-test')));

      expect(new Set(hashes).size).toBe(1);
      expect(states[0].goals).toHaveLength(2);
    });
  });

  describe('Determinism', () => {
    it('should produce deterministic hash regardless of sync order', async () => {
      // Create two sets of clients with same operations in different orders
      const setA = [new TestClient('board-A'), new TestClient('board-A')];
      const setB = [new TestClient('board-B'), new TestClient('board-B')];

      // Set A: Client 0 adds first, then Client 1
      setA[0].addGoal({ id: 'goal-1', content: 'Goal 1' });
      setA[1].addGoal({ id: 'goal-2', content: 'Goal 2' });
      await waitForConvergence(setA);

      // Set B: Client 1 adds first, then Client 0
      setB[1].addGoal({ id: 'goal-2', content: 'Goal 2' });
      setB[0].addGoal({ id: 'goal-1', content: 'Goal 1' });
      await waitForConvergence(setB);

      // Both sets should converge to same hash (canonical representation)
      const hashA = computeSnapshotHash(toCanonicalSnapshot(setA[0].serializeBoardDocument(), 'team-test'));
      const hashB = computeSnapshotHash(toCanonicalSnapshot(setB[0].serializeBoardDocument(), 'team-test'));

      expect(hashA).toBe(hashB);
    });
  });
});
