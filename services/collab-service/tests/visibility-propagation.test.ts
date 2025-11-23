/**
 * Visibility Propagation Tests
 *
 * Tests for automatic visibility propagation rules.
 * Part of Phase 4, Section H.3: Visibility Propagation Rules
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import * as Y from 'yjs';
import { DatabaseClient } from '../src/database/client';
import { VisibilityManager } from '../src/visibility/visibility-manager';
import { VisibilityPropagationEngine } from '../src/visibility/visibility-propagation';
import { UserRole } from '../src/types/auth';

describe('Visibility Propagation Engine', () => {
  let db: DatabaseClient;
  let visibilityManager: VisibilityManager;
  let propagationEngine: VisibilityPropagationEngine;

  const boardId = 'board-prop-test';
  const orgId = 'org-456';
  const teamId = 'team-789';
  const userId = 'user-001';

  beforeEach(async () => {
    db = new DatabaseClient();
    await db.initialize();
    visibilityManager = new VisibilityManager(db);
    propagationEngine = new VisibilityPropagationEngine(db, visibilityManager);

    // Clean up test data
    await db.query('DELETE FROM element_visibility WHERE board_id = $1', [boardId]);
    await db.query('DELETE FROM visibility_change_events WHERE board_id = $1', [boardId]);
  });

  afterEach(async () => {
    await db.close();
  });

  describe('Edge Cascade', () => {
    it('should cascade confidentiality to connected edges', async () => {
      const ydoc = new Y.Doc();
      const edgesArray = ydoc.getArray('edges');

      // Create edges connected to a goal
      edgesArray.push([
        {
          id: 'edge-001',
          from: 'goal-001',
          to: 'option-001',
          label: 'leads to',
        },
      ]);

      edgesArray.push([
        {
          id: 'edge-002',
          from: 'goal-001',
          to: 'option-002',
          label: 'another path',
        },
      ]);

      edgesArray.push([
        {
          id: 'edge-003',
          from: 'goal-002',
          to: 'option-003',
          label: 'unrelated',
        },
      ]);

      // Make goal-001 confidential
      const result = await propagationEngine.propagateVisibilityChange(
        boardId,
        orgId,
        teamId,
        'goal-001',
        'goal',
        'confidential',
        userId,
        UserRole.OWNER,
        ydoc
      );

      expect(result.affectedElements).toHaveLength(2);
      expect(result.affectedElements).toContain('edge-001');
      expect(result.affectedElements).toContain('edge-002');
      expect(result.affectedElements).not.toContain('edge-003');

      expect(result.summary.totalAffected).toBe(2);
      expect(result.summary.byType.edge).toBe(2);

      // Verify edges are now confidential
      const edge1Vis = await visibilityManager.getElementVisibility(boardId, 'edge-001');
      expect(edge1Vis?.visibility_mode).toBe('confidential');
      expect(edge1Vis?.rationale).toContain('Auto-propagated');
    });

    it('should not cascade to already confidential edges', async () => {
      const ydoc = new Y.Doc();
      const edgesArray = ydoc.getArray('edges');

      edgesArray.push([
        {
          id: 'edge-001',
          from: 'goal-001',
          to: 'option-001',
        },
      ]);

      // Manually set edge as confidential
      await visibilityManager.setElementVisibility(
        boardId,
        orgId,
        teamId,
        userId,
        UserRole.OWNER,
        {
          elementId: 'edge-001',
          elementType: 'edge',
          visibilityMode: 'confidential',
          rationale: 'Manually set',
        }
      );

      // Propagate from goal
      const result = await propagationEngine.propagateVisibilityChange(
        boardId,
        orgId,
        teamId,
        'goal-001',
        'goal',
        'confidential',
        userId,
        UserRole.OWNER,
        ydoc
      );

      // Should not re-set already confidential edge
      expect(result.affectedElements).toHaveLength(0);
    });
  });

  describe('Derived Element Propagation', () => {
    it('should propagate from goal to derived outcomes', async () => {
      const ydoc = new Y.Doc();
      const edgesArray = ydoc.getArray('edges');

      // Create goal → option → outcome chain
      edgesArray.push([
        {
          id: 'edge-001',
          from: 'goal-001',
          to: 'option-001',
        },
      ]);

      edgesArray.push([
        {
          id: 'edge-002',
          from: 'option-001',
          to: 'outcome-001',
        },
      ]);

      edgesArray.push([
        {
          id: 'edge-003',
          from: 'option-001',
          to: 'outcome-002',
        },
      ]);

      // Make goal confidential
      const result = await propagationEngine.propagateVisibilityChange(
        boardId,
        orgId,
        teamId,
        'goal-001',
        'goal',
        'confidential',
        userId,
        UserRole.OWNER,
        ydoc
      );

      // Should cascade to edges + derived outcomes
      expect(result.affectedElements).toContain('outcome-001');
      expect(result.affectedElements).toContain('outcome-002');
      expect(result.summary.byType.outcome).toBe(2);

      // Verify outcomes are confidential
      const outcome1Vis = await visibilityManager.getElementVisibility(
        boardId,
        'outcome-001'
      );
      expect(outcome1Vis?.visibility_mode).toBe('confidential');
      expect(outcome1Vis?.rationale).toContain('Derived from confidential goal');
    });

    it('should propagate from option to related assumptions', async () => {
      const ydoc = new Y.Doc();
      const edgesArray = ydoc.getArray('edges');

      // Create option ↔ assumption connections
      edgesArray.push([
        {
          id: 'edge-001',
          from: 'option-001',
          to: 'assumption-001',
        },
      ]);

      edgesArray.push([
        {
          id: 'edge-002',
          from: 'assumption-002',
          to: 'option-001',
        },
      ]);

      // Make option confidential
      const result = await propagationEngine.propagateVisibilityChange(
        boardId,
        orgId,
        teamId,
        'option-001',
        'option',
        'confidential',
        userId,
        UserRole.OWNER,
        ydoc
      );

      // Should cascade to related assumptions
      expect(result.affectedElements).toContain('assumption-001');
      expect(result.affectedElements).toContain('assumption-002');
      expect(result.summary.byType.assumption).toBe(2);

      const assumption1Vis = await visibilityManager.getElementVisibility(
        boardId,
        'assumption-001'
      );
      expect(assumption1Vis?.visibility_mode).toBe('confidential');
      expect(assumption1Vis?.rationale).toContain('Related to confidential option');
    });
  });

  describe('Inference Prevention', () => {
    it('should make isolated elements confidential to prevent inference', async () => {
      const ydoc = new Y.Doc();
      const edgesArray = ydoc.getArray('edges');

      // Create an isolated element only connected to the confidential one
      edgesArray.push([
        {
          id: 'edge-001',
          from: 'goal-001',
          to: 'option-001',
        },
      ]);

      // option-001 has no other connections - it's isolated
      // If goal-001 becomes confidential, showing option-001 alone
      // might reveal information about goal-001

      const result = await propagationEngine.propagateVisibilityChange(
        boardId,
        orgId,
        teamId,
        'goal-001',
        'goal',
        'confidential',
        userId,
        UserRole.OWNER,
        ydoc
      );

      // Should make isolated option confidential
      expect(result.affectedElements).toContain('option-001');

      const optionVis = await visibilityManager.getElementVisibility(
        boardId,
        'option-001'
      );
      expect(optionVis?.visibility_mode).toBe('confidential');
      expect(optionVis?.rationale).toContain('Prevents inference');
    });

    it('should not make non-isolated elements confidential', async () => {
      const ydoc = new Y.Doc();
      const edgesArray = ydoc.getArray('edges');

      // option-001 is connected to multiple elements
      edgesArray.push([
        {
          id: 'edge-001',
          from: 'goal-001',
          to: 'option-001',
        },
      ]);

      edgesArray.push([
        {
          id: 'edge-002',
          from: 'goal-002',
          to: 'option-001',
        },
      ]);

      // option-001 is NOT isolated - it has other connections

      const result = await propagationEngine.propagateVisibilityChange(
        boardId,
        orgId,
        teamId,
        'goal-001',
        'goal',
        'confidential',
        userId,
        UserRole.OWNER,
        ydoc
      );

      // Should NOT make option-001 confidential (not isolated)
      // Only edges should be cascaded
      const optionVisChanged = result.affectedElements.includes('option-001');
      expect(optionVisChanged).toBe(false);
    });
  });

  describe('Propagation Rules Management', () => {
    it('should have default rules enabled', () => {
      const rules = propagationEngine.getRules();

      expect(rules).toHaveLength(3);
      expect(rules.every((r) => r.enabled)).toBe(true);

      const edgeRule = rules.find((r) => r.type === 'edge_cascade');
      expect(edgeRule).toBeDefined();
      expect(edgeRule!.description).toContain('connected edges');
    });

    it('should allow disabling rules', () => {
      propagationEngine.setRuleEnabled('edge_cascade', false);

      const rules = propagationEngine.getRules();
      const edgeRule = rules.find((r) => r.type === 'edge_cascade');

      expect(edgeRule!.enabled).toBe(false);
    });

    it('should not cascade when rule is disabled', async () => {
      const ydoc = new Y.Doc();
      const edgesArray = ydoc.getArray('edges');

      edgesArray.push([
        {
          id: 'edge-001',
          from: 'goal-001',
          to: 'option-001',
        },
      ]);

      // Disable edge cascade
      propagationEngine.setRuleEnabled('edge_cascade', false);

      const result = await propagationEngine.propagateVisibilityChange(
        boardId,
        orgId,
        teamId,
        'goal-001',
        'goal',
        'confidential',
        userId,
        UserRole.OWNER,
        ydoc
      );

      // Should not cascade to edges when disabled
      expect(result.affectedElements).not.toContain('edge-001');
    });
  });

  describe('Reverse Propagation', () => {
    it('should reverse auto-propagated visibility when source becomes public', async () => {
      const ydoc = new Y.Doc();
      const edgesArray = ydoc.getArray('edges');

      edgesArray.push([
        {
          id: 'edge-001',
          from: 'goal-001',
          to: 'option-001',
        },
      ]);

      // Make goal confidential (cascades to edge)
      await propagationEngine.propagateVisibilityChange(
        boardId,
        orgId,
        teamId,
        'goal-001',
        'goal',
        'confidential',
        userId,
        UserRole.OWNER,
        ydoc
      );

      // Verify edge is confidential
      let edgeVis = await visibilityManager.getElementVisibility(boardId, 'edge-001');
      expect(edgeVis?.visibility_mode).toBe('confidential');

      // Reverse propagation
      const reversed = await propagationEngine.reversePropagation(boardId, 'goal-001');

      expect(reversed).toContain('edge-001');

      // Verify edge is now public (visibility deleted)
      edgeVis = await visibilityManager.getElementVisibility(boardId, 'edge-001');
      expect(edgeVis).toBeNull();
    });

    it('should not reverse manually set confidentiality', async () => {
      // Manually set edge as confidential
      await visibilityManager.setElementVisibility(
        boardId,
        orgId,
        teamId,
        userId,
        UserRole.OWNER,
        {
          elementId: 'edge-001',
          elementType: 'edge',
          visibilityMode: 'confidential',
          rationale: 'Manually set by user',
        }
      );

      // Try to reverse (should not affect manually set)
      const reversed = await propagationEngine.reversePropagation(boardId, 'goal-001');

      expect(reversed).toHaveLength(0);

      // Edge should still be confidential
      const edgeVis = await visibilityManager.getElementVisibility(boardId, 'edge-001');
      expect(edgeVis?.visibility_mode).toBe('confidential');
    });
  });

  describe('No Propagation for Public Changes', () => {
    it('should not propagate when making element public', async () => {
      const ydoc = new Y.Doc();
      const edgesArray = ydoc.getArray('edges');

      edgesArray.push([
        {
          id: 'edge-001',
          from: 'goal-001',
          to: 'option-001',
        },
      ]);

      const result = await propagationEngine.propagateVisibilityChange(
        boardId,
        orgId,
        teamId,
        'goal-001',
        'goal',
        'public',
        userId,
        UserRole.OWNER,
        ydoc
      );

      expect(result.affectedElements).toHaveLength(0);
      expect(result.summary.totalAffected).toBe(0);
    });
  });

  describe('Complex Propagation Scenarios', () => {
    it('should handle multi-level propagation', async () => {
      const ydoc = new Y.Doc();
      const edgesArray = ydoc.getArray('edges');

      // Create complex graph: goal → option → outcome
      edgesArray.push([
        {
          id: 'edge-001',
          from: 'goal-001',
          to: 'option-001',
        },
      ]);

      edgesArray.push([
        {
          id: 'edge-002',
          from: 'option-001',
          to: 'outcome-001',
        },
      ]);

      // With assumption linked to option
      edgesArray.push([
        {
          id: 'edge-003',
          from: 'option-001',
          to: 'assumption-001',
        },
      ]);

      const result = await propagationEngine.propagateVisibilityChange(
        boardId,
        orgId,
        teamId,
        'goal-001',
        'goal',
        'confidential',
        userId,
        UserRole.OWNER,
        ydoc
      );

      // Should cascade to:
      // - edge-001 (connected to goal)
      // - outcome-001 (derived from goal via option)
      // - edge-002 (connected to derived outcome)

      expect(result.affectedElements.length).toBeGreaterThan(0);
      expect(result.affectedElements).toContain('outcome-001');
    });

    it('should provide comprehensive summary', async () => {
      const ydoc = new Y.Doc();
      const edgesArray = ydoc.getArray('edges');

      // Create diverse connections
      edgesArray.push([
        { id: 'edge-001', from: 'goal-001', to: 'option-001' },
      ]);
      edgesArray.push([
        { id: 'edge-002', from: 'goal-001', to: 'option-002' },
      ]);
      edgesArray.push([
        { id: 'edge-003', from: 'option-001', to: 'outcome-001' },
      ]);
      edgesArray.push([
        { id: 'edge-004', from: 'option-001', to: 'assumption-001' },
      ]);

      const result = await propagationEngine.propagateVisibilityChange(
        boardId,
        orgId,
        teamId,
        'goal-001',
        'goal',
        'confidential',
        userId,
        UserRole.OWNER,
        ydoc
      );

      expect(result.propagatedChanges).toBeDefined();
      expect(result.propagatedChanges.length).toBeGreaterThan(0);

      result.propagatedChanges.forEach((change) => {
        expect(change.elementId).toBeDefined();
        expect(change.elementType).toBeDefined();
        expect(change.newVisibility).toBe('confidential');
        expect(change.reason).toBeDefined();
      });
    });
  });
});
