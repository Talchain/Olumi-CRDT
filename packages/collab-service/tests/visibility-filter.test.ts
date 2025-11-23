/**
 * Visibility Filter Tests
 *
 * Tests for document filtering based on visibility permissions.
 * Part of Phase 4, Section H.2: Redacted Views and UI Treatment
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import * as Y from 'yjs';
import { DatabaseClient } from '../src/database/client';
import { VisibilityManager } from '../src/visibility/visibility-manager';
import { VisibilityFilter } from '../src/visibility/visibility-filter';
import { UserRole } from '../src/types/auth';

describe('Visibility Filter', () => {
  let db: DatabaseClient;
  let visibilityManager: VisibilityManager;
  let visibilityFilter: VisibilityFilter;

  const boardId = 'board-filter-test';
  const orgId = 'org-456';
  const teamId = 'team-789';
  const ownerUserId = 'owner-001';
  const viewerUserId = 'viewer-002';

  beforeEach(async () => {
    db = new DatabaseClient();
    await db.initialize();
    visibilityManager = new VisibilityManager(db);
    visibilityFilter = new VisibilityFilter(visibilityManager);

    // Clean up test data
    await db.query('DELETE FROM element_visibility WHERE board_id = $1', [boardId]);
    await db.query('DELETE FROM visibility_policies WHERE board_id = $1', [boardId]);
  });

  afterEach(async () => {
    await db.close();
  });

  describe('Document Filtering', () => {
    it('should filter document and redact confidential goals', async () => {
      // Create a document with goals
      const sourceDoc = new Y.Doc();
      const goalsMap = sourceDoc.getMap('goals');

      goalsMap.set('goal-001', {
        id: 'goal-001',
        type: 'goal',
        text: 'Public goal',
        createdAt: new Date().toISOString(),
      });

      goalsMap.set('goal-002', {
        id: 'goal-002',
        type: 'goal',
        text: 'Confidential strategic goal',
        createdAt: new Date().toISOString(),
      });

      // Mark goal-002 as confidential
      await visibilityManager.setElementVisibility(
        boardId,
        orgId,
        teamId,
        ownerUserId,
        UserRole.OWNER,
        {
          elementId: 'goal-002',
          elementType: 'goal',
          visibilityMode: 'confidential',
          viewerWhitelist: [ownerUserId],
        }
      );

      // Filter as viewer (should not see goal-002)
      const result = await visibilityFilter.filterDocument(
        sourceDoc,
        boardId,
        viewerUserId,
        UserRole.VIEWER
      );

      const filteredGoals = result.filteredDoc.getMap('goals');

      // Public goal should be visible
      const goal1 = filteredGoals.get('goal-001');
      expect(goal1).toBeDefined();
      expect(goal1.text).toBe('Public goal');

      // Confidential goal should be redacted
      const goal2 = filteredGoals.get('goal-002');
      expect(goal2).toBeDefined();
      expect(goal2.redacted).toBe(true);
      expect(goal2.text).toContain('Confidential');

      // Check summary
      expect(result.redactionSummary.totalElements).toBe(2);
      expect(result.redactionSummary.visibleElements).toBe(1);
      expect(result.redactionSummary.redactedElements).toBe(1);
      expect(result.redactionSummary.redactedByType.goal).toBe(1);
    });

    it('should show all elements to whitelisted user', async () => {
      const sourceDoc = new Y.Doc();
      const goalsMap = sourceDoc.getMap('goals');

      goalsMap.set('goal-001', {
        id: 'goal-001',
        type: 'goal',
        text: 'Public goal',
        createdAt: new Date().toISOString(),
      });

      goalsMap.set('goal-002', {
        id: 'goal-002',
        type: 'goal',
        text: 'Confidential goal',
        createdAt: new Date().toISOString(),
      });

      // Mark goal-002 as confidential with viewer in whitelist
      await visibilityManager.setElementVisibility(
        boardId,
        orgId,
        teamId,
        ownerUserId,
        UserRole.OWNER,
        {
          elementId: 'goal-002',
          elementType: 'goal',
          visibilityMode: 'confidential',
          viewerWhitelist: [ownerUserId, viewerUserId],
        }
      );

      // Filter as viewer (should see goal-002 because whitelisted)
      const result = await visibilityFilter.filterDocument(
        sourceDoc,
        boardId,
        viewerUserId,
        UserRole.VIEWER
      );

      const filteredGoals = result.filteredDoc.getMap('goals');

      const goal1 = filteredGoals.get('goal-001');
      expect(goal1.text).toBe('Public goal');
      expect(goal1.redacted).toBeUndefined();

      const goal2 = filteredGoals.get('goal-002');
      expect(goal2.text).toBe('Confidential goal');
      expect(goal2.redacted).toBeUndefined();

      expect(result.redactionSummary.redactedElements).toBe(0);
    });

    it('should filter multiple element types', async () => {
      const sourceDoc = new Y.Doc();

      // Add goals
      const goalsMap = sourceDoc.getMap('goals');
      goalsMap.set('goal-001', { id: 'goal-001', type: 'goal', text: 'Goal 1' });
      goalsMap.set('goal-002', { id: 'goal-002', type: 'goal', text: 'Goal 2' });

      // Add options
      const optionsMap = sourceDoc.getMap('options');
      optionsMap.set('option-001', { id: 'option-001', type: 'option', text: 'Option 1' });
      optionsMap.set('option-002', { id: 'option-002', type: 'option', text: 'Option 2' });

      // Add outcomes
      const outcomesMap = sourceDoc.getMap('outcomes');
      outcomesMap.set('outcome-001', { id: 'outcome-001', type: 'outcome', text: 'Outcome 1' });

      // Mark some as confidential
      await visibilityManager.setElementVisibility(
        boardId,
        orgId,
        teamId,
        ownerUserId,
        UserRole.OWNER,
        {
          elementId: 'goal-002',
          elementType: 'goal',
          visibilityMode: 'confidential',
        }
      );

      await visibilityManager.setElementVisibility(
        boardId,
        orgId,
        teamId,
        ownerUserId,
        UserRole.OWNER,
        {
          elementId: 'option-002',
          elementType: 'option',
          visibilityMode: 'confidential',
        }
      );

      // Filter
      const result = await visibilityFilter.filterDocument(
        sourceDoc,
        boardId,
        viewerUserId,
        UserRole.VIEWER
      );

      expect(result.redactionSummary.totalElements).toBe(5);
      expect(result.redactionSummary.visibleElements).toBe(3);
      expect(result.redactionSummary.redactedElements).toBe(2);
      expect(result.redactionSummary.redactedByType.goal).toBe(1);
      expect(result.redactionSummary.redactedByType.option).toBe(1);
    });

    it('should handle edges (connections) filtering', async () => {
      const sourceDoc = new Y.Doc();
      const edgesArray = sourceDoc.getArray('edges');

      edgesArray.push([
        {
          id: 'edge-001',
          type: 'edge',
          from: 'goal-001',
          to: 'option-001',
          label: 'connects to',
        },
      ]);

      edgesArray.push([
        {
          id: 'edge-002',
          type: 'edge',
          from: 'goal-002',
          to: 'option-002',
          label: 'confidential connection',
        },
      ]);

      // Mark edge-002 as confidential
      await visibilityManager.setElementVisibility(
        boardId,
        orgId,
        teamId,
        ownerUserId,
        UserRole.OWNER,
        {
          elementId: 'edge-002',
          elementType: 'edge',
          visibilityMode: 'confidential',
        }
      );

      const result = await visibilityFilter.filterDocument(
        sourceDoc,
        boardId,
        viewerUserId,
        UserRole.VIEWER
      );

      const filteredEdges = result.filteredDoc.getArray('edges');

      expect(filteredEdges.length).toBe(2);

      const edge1 = filteredEdges.get(0);
      expect(edge1.label).toBe('connects to');

      const edge2 = filteredEdges.get(1);
      expect(edge2.redacted).toBe(true);
      expect(edge2.label).toContain('Confidential');

      expect(result.redactionSummary.redactedByType.edge).toBe(1);
    });

    it('should copy metadata to filtered document', async () => {
      const sourceDoc = new Y.Doc();
      const metaMap = sourceDoc.getMap('metadata');

      metaMap.set('boardId', boardId);
      metaMap.set('orgId', orgId);
      metaMap.set('teamId', teamId);
      metaMap.set('createdAt', '2025-01-01T00:00:00Z');

      const result = await visibilityFilter.filterDocument(
        sourceDoc,
        boardId,
        viewerUserId,
        UserRole.VIEWER
      );

      const filteredMeta = result.filteredDoc.getMap('metadata');

      expect(filteredMeta.get('boardId')).toBe(boardId);
      expect(filteredMeta.get('orgId')).toBe(orgId);
      expect(filteredMeta.get('teamId')).toBe(teamId);
      expect(filteredMeta.get('filteredAt')).toBeDefined();
      expect(filteredMeta.get('filteredForUser')).toBe(viewerUserId);
    });
  });

  describe('Redaction Preview', () => {
    it('should provide quick redaction preview', async () => {
      // Set up some confidential elements
      await visibilityManager.setElementVisibility(
        boardId,
        orgId,
        teamId,
        ownerUserId,
        UserRole.OWNER,
        {
          elementId: 'elem-001',
          elementType: 'goal',
          visibilityMode: 'confidential',
          viewerWhitelist: [ownerUserId],
        }
      );

      await visibilityManager.setElementVisibility(
        boardId,
        orgId,
        teamId,
        ownerUserId,
        UserRole.OWNER,
        {
          elementId: 'elem-002',
          elementType: 'outcome',
          visibilityMode: 'confidential',
          viewerWhitelist: [ownerUserId, viewerUserId],
        }
      );

      const preview = await visibilityFilter.getRedactionPreview(
        boardId,
        viewerUserId,
        UserRole.VIEWER
      );

      expect(preview.hasRedactions).toBe(true);
      expect(preview.confidentialCount).toBe(2);
      expect(preview.accessibleCount).toBe(1); // elem-002 is accessible
      expect(preview.inaccessibleCount).toBe(1); // elem-001 is not accessible
    });

    it('should show no redactions for owner', async () => {
      await visibilityManager.setElementVisibility(
        boardId,
        orgId,
        teamId,
        ownerUserId,
        UserRole.OWNER,
        {
          elementId: 'elem-001',
          elementType: 'goal',
          visibilityMode: 'confidential',
        }
      );

      const preview = await visibilityFilter.getRedactionPreview(
        boardId,
        ownerUserId,
        UserRole.OWNER
      );

      expect(preview.hasRedactions).toBe(false);
      expect(preview.confidentialCount).toBe(1);
      expect(preview.accessibleCount).toBe(1);
      expect(preview.inaccessibleCount).toBe(0);
    });
  });

  describe('In-Place Filtering', () => {
    it('should redact document in-place', async () => {
      const doc = new Y.Doc();
      const goalsMap = doc.getMap('goals');

      goalsMap.set('goal-001', {
        id: 'goal-001',
        text: 'Public goal',
      });

      goalsMap.set('goal-002', {
        id: 'goal-002',
        text: 'Secret goal',
      });

      await visibilityManager.setElementVisibility(
        boardId,
        orgId,
        teamId,
        ownerUserId,
        UserRole.OWNER,
        {
          elementId: 'goal-002',
          elementType: 'goal',
          visibilityMode: 'confidential',
        }
      );

      const result = await visibilityFilter.applyFilterInPlace(
        doc,
        boardId,
        viewerUserId,
        UserRole.VIEWER
      );

      expect(result.redactedCount).toBe(1);

      // Check that original document was modified
      const goal2 = goalsMap.get('goal-002');
      expect(goal2.redacted).toBe(true);
      expect(goal2.text).toContain('Confidential');
    });

    it('should handle empty document gracefully', async () => {
      const doc = new Y.Doc();

      const result = await visibilityFilter.applyFilterInPlace(
        doc,
        boardId,
        viewerUserId,
        UserRole.VIEWER
      );

      expect(result.redactedCount).toBe(0);
      expect(result.redactedElements).toHaveLength(0);
    });
  });

  describe('Performance', () => {
    it('should filter large documents efficiently', async () => {
      const sourceDoc = new Y.Doc();
      const goalsMap = sourceDoc.getMap('goals');

      // Create 100 goals
      for (let i = 0; i < 100; i++) {
        goalsMap.set(`goal-${i}`, {
          id: `goal-${i}`,
          text: `Goal ${i}`,
          type: 'goal',
        });
      }

      // Mark 20 as confidential
      for (let i = 0; i < 20; i++) {
        await visibilityManager.setElementVisibility(
          boardId,
          orgId,
          teamId,
          ownerUserId,
          UserRole.OWNER,
          {
            elementId: `goal-${i * 5}`,
            elementType: 'goal',
            visibilityMode: 'confidential',
          }
        );
      }

      const startTime = Date.now();

      const result = await visibilityFilter.filterDocument(
        sourceDoc,
        boardId,
        viewerUserId,
        UserRole.VIEWER
      );

      const duration = Date.now() - startTime;

      expect(result.redactionSummary.totalElements).toBe(100);
      expect(result.redactionSummary.redactedElements).toBe(20);
      expect(result.redactionSummary.visibleElements).toBe(80);

      // Should complete in reasonable time (< 1 second for 100 elements)
      expect(duration).toBeLessThan(1000);
    });
  });
});
