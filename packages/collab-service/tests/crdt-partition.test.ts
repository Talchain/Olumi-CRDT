/**
 * CRDT Network Partition Tests
 *
 * Tests that clients can recover from network partitions and
 * merge their states correctly after reconnection.
 */

import * as Y from 'yjs';
import { toCanonicalSnapshot } from '../src/types/snapshot';
import { computeSnapshotHash } from '../src/utils/hash';
import { BoardDocument } from '../src/types/board';

/**
 * Partitioned test client with network simulation
 */
class PartitionedClient {
  public ydoc: Y.Doc;
  public clientId: string;
  private boardId: string;
  private goals: Y.Map<any>;
  private options: Y.Map<any>;
  private edges: Y.Array<any>;
  private canCommunicateWith: Set<string> = new Set();

  constructor(clientId: string, boardId: string) {
    this.clientId = clientId;
    this.boardId = boardId;
    this.ydoc = new Y.Doc();

    this.goals = this.ydoc.getMap('goals');
    this.options = this.ydoc.getMap('options');
    this.edges = this.ydoc.getArray('edges');
  }

  /**
   * Set which clients this client can communicate with
   */
  setNetwork(allowedClients: Set<string>) {
    this.canCommunicateWith = allowedClients;
  }

  /**
   * Check if can communicate with another client
   */
  canCommunicate(otherClientId: string): boolean {
    return this.canCommunicateWith.has(otherClientId);
  }

  /**
   * Add a goal
   */
  addGoal(goal: { id: string; content: string; priority?: string }) {
    this.ydoc.transact(() => {
      this.goals.set(goal.id, {
        id: goal.id,
        content: goal.content,
        priority: goal.priority || 'medium',
        position: { x: 100, y: 100 },
        createdBy: this.clientId,
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
        createdBy: this.clientId,
        createdAt: new Date().toISOString(),
      });
    });
  }

  /**
   * Apply an update from another client (if network allows)
   */
  receiveUpdate(fromClientId: string, update: Uint8Array): boolean {
    if (!this.canCommunicate(fromClientId)) {
      return false; // Network partition blocks this
    }

    Y.applyUpdate(this.ydoc, update);
    return true;
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
 * Simulate network sync with partition awareness
 */
async function syncWithNetwork(clients: PartitionedClient[]): Promise<void> {
  // Collect updates from all clients
  const updates: Array<{ fromClientId: string; update: Uint8Array }> = clients.map((client) => ({
    fromClientId: client.clientId,
    update: client.getStateAsUpdate(),
  }));

  // Try to apply each update to each client (respecting network partitions)
  for (const client of clients) {
    for (const { fromClientId, update } of updates) {
      if (client.clientId !== fromClientId) {
        client.receiveUpdate(fromClientId, update);
      }
    }
  }

  await new Promise((resolve) => setTimeout(resolve, 10));
}

/**
 * Create a network partition (two groups cannot communicate)
 */
function createPartition(groupA: PartitionedClient[], groupB: PartitionedClient[]): void {
  // Group A can only communicate within itself
  const groupAIds = new Set(groupA.map((c) => c.clientId));
  for (const client of groupA) {
    client.setNetwork(groupAIds);
  }

  // Group B can only communicate within itself
  const groupBIds = new Set(groupB.map((c) => c.clientId));
  for (const client of groupB) {
    client.setNetwork(groupBIds);
  }
}

/**
 * Heal the partition (all clients can communicate)
 */
function healPartition(allClients: PartitionedClient[]): void {
  const allIds = new Set(allClients.map((c) => c.clientId));
  for (const client of allClients) {
    client.setNetwork(allIds);
  }
}

/**
 * Wait for convergence across all clients
 */
async function waitForConvergence(
  clients: PartitionedClient[],
  maxAttempts: number = 10
): Promise<void> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    await syncWithNetwork(clients);

    // Check if all states are identical
    const states = clients.map((c) => c.serializeBoardDocument());
    const hashes = states.map((s) => computeSnapshotHash(toCanonicalSnapshot(s, 'team-test')));

    if (new Set(hashes).size === 1) {
      return; // Converged!
    }
  }

  throw new Error('Clients failed to converge within timeout');
}

describe('Network Partitions', () => {
  describe('Two-group Partitions', () => {
    it('should merge correctly after partition heals', async () => {
      // Create two groups of clients
      const groupA = [
        new PartitionedClient('client-A1', 'board-123'),
        new PartitionedClient('client-A2', 'board-123'),
      ];

      const groupB = [
        new PartitionedClient('client-B1', 'board-123'),
        new PartitionedClient('client-B2', 'board-123'),
      ];

      const allClients = [...groupA, ...groupB];

      // Start with shared state
      healPartition(allClients);
      groupA[0].addGoal({ id: 'goal-initial', content: 'Initial Goal' });
      await waitForConvergence(allClients);

      // Create partition
      createPartition(groupA, groupB);

      // Each group makes edits while partitioned
      groupA[0].addGoal({ id: 'goal-partition-A', content: 'Goal from Group A' });
      groupA[1].addOption({ id: 'option-A', content: 'Option from Group A' });

      groupB[0].addGoal({ id: 'goal-partition-B', content: 'Goal from Group B' });
      groupB[1].updateGoal('goal-initial', { content: 'Updated by Group B' });

      // Sync within partitions
      await syncWithNetwork(groupA);
      await syncWithNetwork(groupB);

      // Verify groups have diverged
      const hashA = computeSnapshotHash(toCanonicalSnapshot(groupA[0].serializeBoardDocument(), 'team-test'));
      const hashB = computeSnapshotHash(toCanonicalSnapshot(groupB[0].serializeBoardDocument(), 'team-test'));
      expect(hashA).not.toBe(hashB);

      // Heal partition
      healPartition(allClients);

      // Wait for convergence
      await waitForConvergence(allClients);

      // All clients should now have identical state
      const states = allClients.map((c) => c.serializeBoardDocument());
      const hashes = states.map((s) => computeSnapshotHash(toCanonicalSnapshot(s, 'team-test')));

      expect(new Set(hashes).size).toBe(1);

      // Verify merged state includes edits from both groups
      const finalGoals = states[0].goals;
      const finalOptions = states[0].options;

      expect(finalGoals.some((g) => g.id === 'goal-partition-A')).toBe(true);
      expect(finalGoals.some((g) => g.id === 'goal-partition-B')).toBe(true);
      expect(finalOptions.some((o) => o.id === 'option-A')).toBe(true);
    });

    it('should handle conflicting edits during partition', async () => {
      const groupA = [new PartitionedClient('client-A', 'board-conflict')];
      const groupB = [new PartitionedClient('client-B', 'board-conflict')];
      const allClients = [...groupA, ...groupB];

      // Start with shared state
      healPartition(allClients);
      groupA[0].addGoal({ id: 'goal-1', content: 'Original Content' });
      await waitForConvergence(allClients);

      // Create partition
      createPartition(groupA, groupB);

      // Both groups update the same goal with different content
      groupA[0].updateGoal('goal-1', { content: 'Modified by Group A' });
      groupB[0].updateGoal('goal-1', { content: 'Modified by Group B' });

      // Heal partition
      healPartition(allClients);

      // Wait for convergence
      await waitForConvergence(allClients);

      // Should converge without crashes (one update wins)
      const states = allClients.map((c) => c.serializeBoardDocument());
      const hashes = states.map((s) => computeSnapshotHash(toCanonicalSnapshot(s, 'team-test')));

      expect(new Set(hashes).size).toBe(1);
      expect(states[0].goals[0].content).toBe(states[1].goals[0].content);
    });
  });

  describe('Three-way Partitions', () => {
    it('should merge correctly after three-way partition heals', async () => {
      const groupA = [new PartitionedClient('client-A', 'board-3way')];
      const groupB = [new PartitionedClient('client-B', 'board-3way')];
      const groupC = [new PartitionedClient('client-C', 'board-3way')];

      const allClients = [...groupA, ...groupB, ...groupC];

      // Start with shared state
      healPartition(allClients);
      groupA[0].addGoal({ id: 'goal-shared', content: 'Shared' });
      await waitForConvergence(allClients);

      // Create three-way partition
      groupA[0].setNetwork(new Set(['client-A']));
      groupB[0].setNetwork(new Set(['client-B']));
      groupC[0].setNetwork(new Set(['client-C']));

      // Each group makes different edits
      groupA[0].addGoal({ id: 'goal-A', content: 'From A' });
      groupB[0].addGoal({ id: 'goal-B', content: 'From B' });
      groupC[0].addGoal({ id: 'goal-C', content: 'From C' });

      // Heal partition
      healPartition(allClients);

      // Wait for convergence
      await waitForConvergence(allClients);

      // All should converge
      const states = allClients.map((c) => c.serializeBoardDocument());
      const hashes = states.map((s) => computeSnapshotHash(toCanonicalSnapshot(s, 'team-test')));

      expect(new Set(hashes).size).toBe(1);

      // All goals should be present
      const finalGoals = states[0].goals;
      expect(finalGoals).toHaveLength(4); // shared + A + B + C
    });
  });

  describe('Sequential Partitions', () => {
    it('should handle multiple partition/heal cycles', async () => {
      const groupA = [new PartitionedClient('client-A', 'board-seq')];
      const groupB = [new PartitionedClient('client-B', 'board-seq')];
      const allClients = [...groupA, ...groupB];

      // Cycle 1: Partition, edit, heal
      createPartition(groupA, groupB);
      groupA[0].addGoal({ id: 'goal-cycle1-A', content: 'Cycle 1 A' });
      groupB[0].addGoal({ id: 'goal-cycle1-B', content: 'Cycle 1 B' });
      healPartition(allClients);
      await waitForConvergence(allClients);

      // Cycle 2: Partition again, edit, heal
      createPartition(groupA, groupB);
      groupA[0].addGoal({ id: 'goal-cycle2-A', content: 'Cycle 2 A' });
      groupB[0].addGoal({ id: 'goal-cycle2-B', content: 'Cycle 2 B' });
      healPartition(allClients);
      await waitForConvergence(allClients);

      // Should converge with all edits from both cycles
      const states = allClients.map((c) => c.serializeBoardDocument());
      const hashes = states.map((s) => computeSnapshotHash(toCanonicalSnapshot(s, 'team-test')));

      expect(new Set(hashes).size).toBe(1);
      expect(states[0].goals).toHaveLength(4);
    });
  });

  describe('Partition with Deletions', () => {
    it('should handle deletion in one partition and update in another', async () => {
      const groupA = [new PartitionedClient('client-A', 'board-del')];
      const groupB = [new PartitionedClient('client-B', 'board-del')];
      const allClients = [...groupA, ...groupB];

      // Start with shared state
      healPartition(allClients);
      groupA[0].addGoal({ id: 'goal-1', content: 'Original' });
      await waitForConvergence(allClients);

      // Create partition
      createPartition(groupA, groupB);

      // Group A deletes, Group B updates
      groupA[0].deleteGoal('goal-1');
      groupB[0].updateGoal('goal-1', { content: 'Updated' });

      // Heal partition
      healPartition(allClients);

      // Wait for convergence
      await waitForConvergence(allClients);

      // Should converge (with deleted flag or updated content, depending on CRDT semantics)
      const states = allClients.map((c) => c.serializeBoardDocument());
      const hashes = states.map((s) => computeSnapshotHash(toCanonicalSnapshot(s, 'team-test')));

      expect(new Set(hashes).size).toBe(1);

      // Both clients should have same view of goal-1
      const goal1A = states[0].goals.find((g) => g.id === 'goal-1');
      const goal1B = states[1].goals.find((g) => g.id === 'goal-1');

      expect(goal1A).toEqual(goal1B);
    });
  });

  describe('Asymmetric Partitions', () => {
    it('should handle one-way communication failures', async () => {
      const clientA = new PartitionedClient('client-A', 'board-asym');
      const clientB = new PartitionedClient('client-B', 'board-asym');

      // Asymmetric partition: A can send to B, but B cannot send to A
      clientA.setNetwork(new Set(['client-A', 'client-B']));
      clientB.setNetwork(new Set(['client-B'])); // Can't reach A

      clientA.addGoal({ id: 'goal-A', content: 'From A' });
      clientB.addGoal({ id: 'goal-B', content: 'From B' });

      // Sync (A's updates reach B, but not vice versa)
      await syncWithNetwork([clientA, clientB]);

      // B should have both goals, A should only have its own
      const stateA = clientA.serializeBoardDocument();
      const stateB = clientB.serializeBoardDocument();

      expect(stateA.goals).toHaveLength(1);
      expect(stateB.goals).toHaveLength(2);

      // Heal partition (now B can send to A)
      healPartition([clientA, clientB]);

      // Wait for convergence
      await waitForConvergence([clientA, clientB]);

      // Now both should converge
      const finalStates = [clientA, clientB].map((c) => c.serializeBoardDocument());
      const finalHashes = finalStates.map((s) =>
        computeSnapshotHash(toCanonicalSnapshot(s, 'team-test'))
      );

      expect(new Set(finalHashes).size).toBe(1);
      expect(finalStates[0].goals).toHaveLength(2);
    });
  });

  describe('Partition Recovery Stress Test', () => {
    it('should handle partition with many edits on both sides', async () => {
      const groupA = [new PartitionedClient('client-A', 'board-stress')];
      const groupB = [new PartitionedClient('client-B', 'board-stress')];
      const allClients = [...groupA, ...groupB];

      // Create partition
      createPartition(groupA, groupB);

      // Group A makes many edits
      for (let i = 0; i < 10; i++) {
        groupA[0].addGoal({ id: `goal-A-${i}`, content: `Goal A ${i}` });
      }

      // Group B makes many edits
      for (let i = 0; i < 10; i++) {
        groupB[0].addGoal({ id: `goal-B-${i}`, content: `Goal B ${i}` });
      }

      // Heal partition
      healPartition(allClients);

      // Wait for convergence
      await waitForConvergence(allClients);

      // Should converge with all 20 goals
      const states = allClients.map((c) => c.serializeBoardDocument());
      const hashes = states.map((s) => computeSnapshotHash(toCanonicalSnapshot(s, 'team-test')));

      expect(new Set(hashes).size).toBe(1);
      expect(states[0].goals).toHaveLength(20);
    });
  });
});
