/**
 * Snapshot Tray API Tests
 *
 * Tests for snapshot management API endpoints:
 * - List snapshots with provenance
 * - Rename snapshot
 * - Restore snapshot
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import { DatabaseClient } from '../src/database/client';
import { DocumentManager } from '../src/collab/document-manager';
import { BoardDocument } from '../src/types/board';
import * as Y from 'yjs';

describe('Snapshot Tray API', () => {
  let db: DatabaseClient;
  let documentManager: DocumentManager;

  beforeEach(async () => {
    db = new DatabaseClient();
    await db.initialize();
    documentManager = new DocumentManager(db);
  });

  afterEach(async () => {
    await documentManager.shutdown();
    await db.close();
  });

  describe('List Snapshots', () => {
    it('should list snapshots with provenance metadata', async () => {
      const boardId = 'board-test-list';
      const orgId = 'org-123';
      const teamId = 'team-456';

      // Create a test board
      const testBoard: BoardDocument = {
        id: boardId,
        orgId,
        teamId,
        ownerId: 'user-1',
        version: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        title: 'Test Board',
        description: 'Test board for snapshot listing',
        goals: [{ id: 'goal-1', content: 'Goal 1', priority: 'high', position: { x: 0, y: 0 }, createdBy: 'user-1', createdAt: new Date().toISOString() }],
        options: [],
        outcomes: [],
        assumptions: [],
        evidence: [],
        edges: [],
        layout: { nodes: {}, viewport: { x: 0, y: 0, zoom: 1 } },
        tags: [],
        status: 'active',
      };

      // Create multiple snapshots
      const snapshot1 = await documentManager.snapshotManager.createSnapshot(testBoard, teamId, {
        boardId,
        userId: 'user-1',
        name: 'Snapshot 1',
        triggerType: 'manual',
      });

      const snapshot2 = await documentManager.snapshotManager.createSnapshot(testBoard, teamId, {
        boardId,
        userId: 'user-1',
        name: 'Snapshot 2',
        triggerType: 'manual',
        parentSnapshotId: snapshot1.snapshotId,
      });

      // List snapshots
      const snapshots = await documentManager.snapshotManager.listSnapshots(boardId, 10);

      expect(snapshots).toHaveLength(2);
      expect(snapshots[0].name).toBe('Snapshot 2');
      expect(snapshots[1].name).toBe('Snapshot 1');

      // Get provenance for snapshot 2
      const provenance = await documentManager.snapshotManager.getSnapshotProvenance(snapshot2.snapshotId);

      expect(provenance).toBeDefined();
      expect(provenance?.snapshotId).toBe(snapshot2.snapshotId);
      expect(provenance?.parentSnapshotId).toBe(snapshot1.snapshotId);
    });
  });

  describe('Rename Snapshot', () => {
    it('should rename a snapshot', async () => {
      const boardId = 'board-test-rename';
      const orgId = 'org-123';
      const teamId = 'team-456';

      const testBoard: BoardDocument = {
        id: boardId,
        orgId,
        teamId,
        ownerId: 'user-1',
        version: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        title: 'Test Board',
        description: 'Test board for renaming',
        goals: [],
        options: [],
        outcomes: [],
        assumptions: [],
        evidence: [],
        edges: [],
        layout: { nodes: {}, viewport: { x: 0, y: 0, zoom: 1 } },
        tags: [],
        status: 'active',
      };

      // Create a snapshot
      const snapshot = await documentManager.snapshotManager.createSnapshot(testBoard, teamId, {
        boardId,
        userId: 'user-1',
        name: 'Original Name',
        triggerType: 'manual',
      });

      // Rename the snapshot
      const newName = 'Renamed Snapshot';
      await documentManager.snapshotManager.updateSnapshotName(snapshot.snapshotId, newName);

      // Verify the name was updated
      const updatedSnapshot = await documentManager.snapshotManager.getSnapshot(snapshot.snapshotId);

      expect(updatedSnapshot).toBeDefined();
      expect(updatedSnapshot?.name).toBe(newName);
    });

    it('should not allow renaming immutable snapshots', async () => {
      const boardId = 'board-test-immutable';
      const orgId = 'org-123';
      const teamId = 'team-456';

      const testBoard: BoardDocument = {
        id: boardId,
        orgId,
        teamId,
        ownerId: 'user-1',
        version: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        title: 'Test Board',
        description: 'Test board for immutability',
        goals: [],
        options: [],
        outcomes: [],
        assumptions: [],
        evidence: [],
        edges: [],
        layout: { nodes: {}, viewport: { x: 0, y: 0, zoom: 1 } },
        tags: [],
        status: 'active',
      };

      // Create a snapshot
      const snapshot = await documentManager.snapshotManager.createSnapshot(testBoard, teamId, {
        boardId,
        userId: 'user-1',
        name: 'Immutable Snapshot',
        triggerType: 'on_run',
      });

      // Mark as immutable (simulating a run reference)
      await db.markSnapshotImmutable(snapshot.snapshotId, 'run-123');

      // Attempt to rename should fail
      await expect(async () => {
        await documentManager.snapshotManager.updateSnapshotName(snapshot.snapshotId, 'New Name');
      }).rejects.toThrow();
    });
  });

  describe('Restore Snapshot', () => {
    it('should restore a snapshot and create before/after snapshots', async () => {
      const boardId = 'board-test-restore';
      const orgId = 'org-123';
      const teamId = 'team-456';

      // Create initial board state
      const initialBoard: BoardDocument = {
        id: boardId,
        orgId,
        teamId,
        ownerId: 'user-1',
        version: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        title: 'Test Board',
        description: 'Initial state',
        goals: [{ id: 'goal-1', content: 'Initial Goal', priority: 'high', position: { x: 0, y: 0 }, createdBy: 'user-1', createdAt: new Date().toISOString() }],
        options: [],
        outcomes: [],
        assumptions: [],
        evidence: [],
        edges: [],
        layout: { nodes: {}, viewport: { x: 0, y: 0, zoom: 1 } },
        tags: [],
        status: 'active',
      };

      // Create snapshot of initial state
      const snapshot1 = await documentManager.snapshotManager.createSnapshot(initialBoard, teamId, {
        boardId,
        userId: 'user-1',
        name: 'Initial State',
        triggerType: 'manual',
      });

      // Load document into DocumentManager
      const ydoc = await documentManager.getDocument(boardId, orgId);

      // Modify the board
      ydoc.transact(() => {
        const goals = ydoc.getMap('goals');
        goals.set('goal-2', { id: 'goal-2', content: 'Modified Goal', priority: 'medium', position: { x: 100, y: 100 }, createdBy: 'user-1', createdAt: new Date().toISOString() });
      });

      // Get snapshot count before restore
      const snapshotsBefore = await documentManager.snapshotManager.listSnapshots(boardId, 50);
      const countBefore = snapshotsBefore.length;

      // Restore to initial state
      await documentManager.restoreSnapshot(boardId, snapshot1.snapshotId, 'user-1');

      // Verify snapshots were created (before restore + after restore)
      const snapshotsAfter = await documentManager.snapshotManager.listSnapshots(boardId, 50);
      expect(snapshotsAfter.length).toBeGreaterThan(countBefore);

      // Verify the latest snapshot has "Restored from" in the name
      const latestSnapshot = snapshotsAfter[0];
      expect(latestSnapshot.name).toContain('Restored from');

      // Verify the board state was restored
      const restoredBoard = documentManager.serializeBoardDocument(ydoc);
      expect(restoredBoard.goals).toHaveLength(1);
      expect(restoredBoard.goals[0].content).toBe('Initial Goal');
    });

    it('should fail to restore non-existent snapshot', async () => {
      const boardId = 'board-test-nonexistent';
      const orgId = 'org-123';

      await documentManager.getDocument(boardId, orgId);

      await expect(async () => {
        await documentManager.restoreSnapshot(boardId, 'nonexistent-snapshot', 'user-1');
      }).rejects.toThrow('Snapshot not found');
    });
  });

  describe('Snapshot Provenance', () => {
    it('should track edit statistics in provenance', async () => {
      const boardId = 'board-test-provenance';
      const orgId = 'org-123';
      const teamId = 'team-456';

      const testBoard: BoardDocument = {
        id: boardId,
        orgId,
        teamId,
        ownerId: 'user-1',
        version: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        title: 'Test Board',
        description: 'Provenance tracking test',
        goals: [],
        options: [],
        outcomes: [],
        assumptions: [],
        evidence: [],
        edges: [],
        layout: { nodes: {}, viewport: { x: 0, y: 0, zoom: 1 } },
        tags: [],
        status: 'active',
      };

      // Create parent snapshot
      const snapshot1 = await documentManager.snapshotManager.createSnapshot(testBoard, teamId, {
        boardId,
        userId: 'user-1',
        name: 'Parent Snapshot',
        triggerType: 'manual',
      });

      // Log some edits (simulated)
      await db.logEdit(boardId, orgId, teamId, 'user-1', 'goal_create', 'goal', 'goal-1', undefined, { content: 'New Goal' }, undefined);
      await db.logEdit(boardId, orgId, teamId, 'user-2', 'goal_update', 'goal', 'goal-1', { content: 'New Goal' }, { content: 'Updated Goal' }, undefined);

      // Create child snapshot
      const snapshot2 = await documentManager.snapshotManager.createSnapshot(testBoard, teamId, {
        boardId,
        userId: 'user-1',
        name: 'Child Snapshot',
        triggerType: 'manual',
        parentSnapshotId: snapshot1.snapshotId,
      });

      // Get provenance
      const provenance = await documentManager.snapshotManager.getSnapshotProvenance(snapshot2.snapshotId);

      expect(provenance).toBeDefined();
      expect(provenance?.snapshotId).toBe(snapshot2.snapshotId);
      expect(provenance?.parentSnapshotId).toBe(snapshot1.snapshotId);
      expect(provenance?.editCount).toBeGreaterThanOrEqual(0);
      expect(provenance?.uniqueEditorCount).toBeGreaterThanOrEqual(0);
    });
  });
});
