/**
 * Visibility Manager Tests
 *
 * Tests for element-level visibility and selective information sharing.
 * Part of Phase 4, Section H: Selective Information Sharing
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { DatabaseClient } from '../src/database/client';
import { VisibilityManager } from '../src/visibility/visibility-manager';
import { ElementType } from '../src/types/visibility';
import { UserRole } from '../src/types/auth';

describe('Visibility Manager', () => {
  let db: DatabaseClient;
  let visibilityManager: VisibilityManager;

  const boardId = 'board-123';
  const orgId = 'org-456';
  const teamId = 'team-789';
  const userId1 = 'user-001';
  const userId2 = 'user-002';
  const elementId1 = 'goal-001';
  const elementId2 = 'outcome-002';

  beforeEach(async () => {
    db = new DatabaseClient();
    await db.initialize();
    visibilityManager = new VisibilityManager(db);

    // Clean up test data
    await db.query('DELETE FROM element_visibility WHERE board_id = $1', [boardId]);
    await db.query('DELETE FROM visibility_policies WHERE board_id = $1', [boardId]);
    await db.query('DELETE FROM visibility_change_events WHERE board_id = $1', [boardId]);
  });

  afterEach(async () => {
    await db.close();
  });

  describe('Element Visibility', () => {
    it('should set element visibility to public', async () => {
      const visibility = await visibilityManager.setElementVisibility(
        boardId,
        orgId,
        teamId,
        userId1,
        UserRole.EDITOR,
        {
          elementId: elementId1,
          elementType: 'goal',
          visibilityMode: 'public',
        }
      );

      expect(visibility.element_id).toBe(elementId1);
      expect(visibility.element_type).toBe('goal');
      expect(visibility.visibility_mode).toBe('public');
      expect(visibility.set_by_user_id).toBe(userId1);
    });

    it('should set element visibility to confidential with whitelist', async () => {
      const visibility = await visibilityManager.setElementVisibility(
        boardId,
        orgId,
        teamId,
        userId1,
        UserRole.OWNER,
        {
          elementId: elementId1,
          elementType: 'goal',
          visibilityMode: 'confidential',
          viewerWhitelist: [userId1, userId2],
          rationale: 'Sensitive strategic goal',
        }
      );

      expect(visibility.element_id).toBe(elementId1);
      expect(visibility.visibility_mode).toBe('confidential');
      expect(visibility.viewer_whitelist).toEqual([userId1, userId2]);
      expect(visibility.rationale).toBe('Sensitive strategic goal');
    });

    it('should update existing element visibility', async () => {
      // First set
      await visibilityManager.setElementVisibility(
        boardId,
        orgId,
        teamId,
        userId1,
        UserRole.EDITOR,
        {
          elementId: elementId1,
          elementType: 'goal',
          visibilityMode: 'public',
        }
      );

      // Update
      const updated = await visibilityManager.setElementVisibility(
        boardId,
        orgId,
        teamId,
        userId1,
        UserRole.OWNER,
        {
          elementId: elementId1,
          elementType: 'goal',
          visibilityMode: 'confidential',
          viewerWhitelist: [userId1],
        }
      );

      expect(updated.visibility_mode).toBe('confidential');
      expect(updated.viewer_whitelist).toEqual([userId1]);
    });

    it('should get element visibility', async () => {
      await visibilityManager.setElementVisibility(
        boardId,
        orgId,
        teamId,
        userId1,
        UserRole.EDITOR,
        {
          elementId: elementId1,
          elementType: 'goal',
          visibilityMode: 'public',
        }
      );

      const visibility = await visibilityManager.getElementVisibility(boardId, elementId1);

      expect(visibility).not.toBeNull();
      expect(visibility!.element_id).toBe(elementId1);
      expect(visibility!.visibility_mode).toBe('public');
    });

    it('should return null for non-existent element visibility', async () => {
      const visibility = await visibilityManager.getElementVisibility(boardId, 'non-existent');

      expect(visibility).toBeNull();
    });

    it('should delete element visibility', async () => {
      await visibilityManager.setElementVisibility(
        boardId,
        orgId,
        teamId,
        userId1,
        UserRole.EDITOR,
        {
          elementId: elementId1,
          elementType: 'goal',
          visibilityMode: 'public',
        }
      );

      await visibilityManager.deleteElementVisibility(boardId, elementId1);

      const visibility = await visibilityManager.getElementVisibility(boardId, elementId1);
      expect(visibility).toBeNull();
    });
  });

  describe('Permission Checks', () => {
    it('should allow viewing public elements for all users', async () => {
      await visibilityManager.setElementVisibility(
        boardId,
        orgId,
        teamId,
        userId1,
        UserRole.EDITOR,
        {
          elementId: elementId1,
          elementType: 'goal',
          visibilityMode: 'public',
        }
      );

      const check = await visibilityManager.canViewElement(
        boardId,
        elementId1,
        userId2,
        UserRole.VIEWER
      );

      expect(check.can_view).toBe(true);
    });

    it('should allow viewing elements with no visibility record (default public)', async () => {
      const check = await visibilityManager.canViewElement(
        boardId,
        'element-without-record',
        userId2,
        UserRole.VIEWER
      );

      expect(check.can_view).toBe(true);
    });

    it('should allow owner to view confidential elements', async () => {
      await visibilityManager.setElementVisibility(
        boardId,
        orgId,
        teamId,
        userId1,
        UserRole.OWNER,
        {
          elementId: elementId1,
          elementType: 'goal',
          visibilityMode: 'confidential',
        }
      );

      const check = await visibilityManager.canViewElement(
        boardId,
        elementId1,
        userId1,
        UserRole.OWNER
      );

      expect(check.can_view).toBe(true);
      expect(check.can_edit_visibility).toBe(true);
    });

    it('should deny viewing confidential elements for non-whitelisted viewers', async () => {
      await visibilityManager.setElementVisibility(
        boardId,
        orgId,
        teamId,
        userId1,
        UserRole.OWNER,
        {
          elementId: elementId1,
          elementType: 'goal',
          visibilityMode: 'confidential',
          viewerWhitelist: [userId1],
        }
      );

      const check = await visibilityManager.canViewElement(
        boardId,
        elementId1,
        userId2,
        UserRole.VIEWER
      );

      expect(check.can_view).toBe(false);
      expect(check.reason).toBe('not_whitelisted');
    });

    it('should allow viewing confidential elements for whitelisted users', async () => {
      await visibilityManager.setElementVisibility(
        boardId,
        orgId,
        teamId,
        userId1,
        UserRole.OWNER,
        {
          elementId: elementId1,
          elementType: 'goal',
          visibilityMode: 'confidential',
          viewerWhitelist: [userId1, userId2],
        }
      );

      const check = await visibilityManager.canViewElement(
        boardId,
        elementId1,
        userId2,
        UserRole.VIEWER
      );

      expect(check.can_view).toBe(true);
      expect(check.can_edit_visibility).toBe(false);
    });

    it('should allow viewing confidential elements for role-based access', async () => {
      await visibilityManager.setElementVisibility(
        boardId,
        orgId,
        teamId,
        userId1,
        UserRole.OWNER,
        {
          elementId: elementId1,
          elementType: 'goal',
          visibilityMode: 'confidential',
          viewerRoles: ['editor', 'owner'],
        }
      );

      const check = await visibilityManager.canViewElement(
        boardId,
        elementId1,
        userId2,
        UserRole.EDITOR
      );

      expect(check.can_view).toBe(true);
      expect(check.can_edit_visibility).toBe(true);
    });

    it('should deny viewing confidential elements for insufficient role', async () => {
      await visibilityManager.setElementVisibility(
        boardId,
        orgId,
        teamId,
        userId1,
        UserRole.OWNER,
        {
          elementId: elementId1,
          elementType: 'goal',
          visibilityMode: 'confidential',
          viewerRoles: ['owner'],
        }
      );

      const check = await visibilityManager.canViewElement(
        boardId,
        elementId1,
        userId2,
        UserRole.VIEWER
      );

      expect(check.can_view).toBe(false);
      expect(check.reason).toBe('insufficient_role');
    });
  });

  describe('Bulk Operations', () => {
    beforeEach(async () => {
      // Set up multiple elements
      await visibilityManager.setElementVisibility(
        boardId,
        orgId,
        teamId,
        userId1,
        UserRole.OWNER,
        {
          elementId: 'elem-001',
          elementType: 'goal',
          visibilityMode: 'public',
        }
      );

      await visibilityManager.setElementVisibility(
        boardId,
        orgId,
        teamId,
        userId1,
        UserRole.OWNER,
        {
          elementId: 'elem-002',
          elementType: 'outcome',
          visibilityMode: 'confidential',
          viewerWhitelist: [userId1],
        }
      );

      await visibilityManager.setElementVisibility(
        boardId,
        orgId,
        teamId,
        userId1,
        UserRole.OWNER,
        {
          elementId: 'elem-003',
          elementType: 'option',
          visibilityMode: 'public',
        }
      );
    });

    it('should filter visible elements for user', async () => {
      const elementIds = ['elem-001', 'elem-002', 'elem-003'];

      const visible = await visibilityManager.filterVisibleElements(
        boardId,
        elementIds,
        userId2,
        UserRole.VIEWER
      );

      expect(visible).toHaveLength(2);
      expect(visible).toContain('elem-001');
      expect(visible).toContain('elem-003');
      expect(visible).not.toContain('elem-002');
    });

    it('should return all elements for whitelisted user', async () => {
      const elementIds = ['elem-001', 'elem-002', 'elem-003'];

      const visible = await visibilityManager.filterVisibleElements(
        boardId,
        elementIds,
        userId1,
        UserRole.OWNER
      );

      expect(visible).toHaveLength(3);
    });

    it('should perform bulk visibility checks', async () => {
      const elementIds = ['elem-001', 'elem-002', 'elem-003'];

      const results = await visibilityManager.bulkCheckVisibility(
        boardId,
        elementIds,
        userId2,
        UserRole.VIEWER
      );

      expect(results.size).toBe(3);
      expect(results.get('elem-001')!.can_view).toBe(true);
      expect(results.get('elem-002')!.can_view).toBe(false);
      expect(results.get('elem-003')!.can_view).toBe(true);
    });
  });

  describe('Board Visibility Queries', () => {
    beforeEach(async () => {
      await visibilityManager.setElementVisibility(
        boardId,
        orgId,
        teamId,
        userId1,
        UserRole.OWNER,
        {
          elementId: 'elem-001',
          elementType: 'goal',
          visibilityMode: 'public',
        }
      );

      await visibilityManager.setElementVisibility(
        boardId,
        orgId,
        teamId,
        userId1,
        UserRole.OWNER,
        {
          elementId: 'elem-002',
          elementType: 'outcome',
          visibilityMode: 'confidential',
        }
      );

      await visibilityManager.setElementVisibility(
        boardId,
        orgId,
        teamId,
        userId1,
        UserRole.OWNER,
        {
          elementId: 'elem-003',
          elementType: 'option',
          visibilityMode: 'confidential',
        }
      );
    });

    it('should get all visibility records for a board', async () => {
      const records = await visibilityManager.getBoardVisibility(boardId);

      expect(records).toHaveLength(3);
    });

    it('should get only confidential elements', async () => {
      const confidential = await visibilityManager.getConfidentialElements(boardId);

      expect(confidential).toHaveLength(2);
      expect(confidential.every((v) => v.visibility_mode === 'confidential')).toBe(true);
    });
  });

  describe('Visibility Policy', () => {
    it('should set visibility policy', async () => {
      const policy = await visibilityManager.setVisibilityPolicy(
        boardId,
        orgId,
        teamId,
        userId1,
        UserRole.OWNER,
        {
          default_visibility: 'confidential',
          allow_viewer_whitelist: true,
          require_owner_for_confidential: true,
        }
      );

      expect(policy.default_visibility).toBe('confidential');
      expect(policy.allow_viewer_whitelist).toBe(true);
      expect(policy.require_owner_for_confidential).toBe(true);
    });

    it('should reject policy setting by non-owner', async () => {
      await expect(
        visibilityManager.setVisibilityPolicy(
          boardId,
          orgId,
          teamId,
          userId2,
          UserRole.EDITOR,
          {
            default_visibility: 'confidential',
            allow_viewer_whitelist: true,
            require_owner_for_confidential: true,
          }
        )
      ).rejects.toThrow('Only board owners can set visibility policy');
    });

    it('should get default policy when none exists', async () => {
      const policy = await visibilityManager.getVisibilityPolicy(boardId);

      expect(policy.default_visibility).toBe('public');
      expect(policy.allow_viewer_whitelist).toBe(true);
      expect(policy.require_owner_for_confidential).toBe(false);
    });

    it('should enforce owner-only confidential policy', async () => {
      // Set strict policy
      await visibilityManager.setVisibilityPolicy(
        boardId,
        orgId,
        teamId,
        userId1,
        UserRole.OWNER,
        {
          default_visibility: 'public',
          allow_viewer_whitelist: true,
          require_owner_for_confidential: true,
        }
      );

      // Editor tries to set confidential
      await expect(
        visibilityManager.setElementVisibility(
          boardId,
          orgId,
          teamId,
          userId2,
          UserRole.EDITOR,
          {
            elementId: elementId1,
            elementType: 'goal',
            visibilityMode: 'confidential',
          }
        )
      ).rejects.toThrow('Only board owners can mark elements as confidential');
    });

    it('should enforce whitelist policy', async () => {
      // Set policy disallowing whitelists
      await visibilityManager.setVisibilityPolicy(
        boardId,
        orgId,
        teamId,
        userId1,
        UserRole.OWNER,
        {
          default_visibility: 'public',
          allow_viewer_whitelist: false,
          require_owner_for_confidential: false,
        }
      );

      // Try to set whitelist
      await expect(
        visibilityManager.setElementVisibility(
          boardId,
          orgId,
          teamId,
          userId1,
          UserRole.OWNER,
          {
            elementId: elementId1,
            elementType: 'goal',
            visibilityMode: 'confidential',
            viewerWhitelist: [userId1, userId2],
          }
        )
      ).rejects.toThrow('Viewer whitelisting is not allowed for this board');
    });
  });

  describe('Audit Trail', () => {
    it('should record visibility change event', async () => {
      await visibilityManager.setElementVisibility(
        boardId,
        orgId,
        teamId,
        userId1,
        UserRole.EDITOR,
        {
          elementId: elementId1,
          elementType: 'goal',
          visibilityMode: 'public',
        }
      );

      const history = await visibilityManager.getVisibilityHistory(boardId);

      expect(history).toHaveLength(1);
      expect(history[0].element_id).toBe(elementId1);
      expect(history[0].old_visibility).toBeNull();
      expect(history[0].new_visibility).toBe('public');
      expect(history[0].changed_by_user_id).toBe(userId1);
    });

    it('should record update event with old and new values', async () => {
      // Initial setting
      await visibilityManager.setElementVisibility(
        boardId,
        orgId,
        teamId,
        userId1,
        UserRole.EDITOR,
        {
          elementId: elementId1,
          elementType: 'goal',
          visibilityMode: 'public',
        }
      );

      // Update
      await visibilityManager.setElementVisibility(
        boardId,
        orgId,
        teamId,
        userId1,
        UserRole.OWNER,
        {
          elementId: elementId1,
          elementType: 'goal',
          visibilityMode: 'confidential',
          viewerWhitelist: [userId1],
          rationale: 'Strategic goal',
        }
      );

      const history = await visibilityManager.getVisibilityHistory(boardId, elementId1);

      expect(history).toHaveLength(2);
      expect(history[0].old_visibility).toBe('public');
      expect(history[0].new_visibility).toBe('confidential');
      expect(history[0].rationale).toBe('Strategic goal');
    });

    it('should filter history by element ID', async () => {
      await visibilityManager.setElementVisibility(
        boardId,
        orgId,
        teamId,
        userId1,
        UserRole.EDITOR,
        {
          elementId: elementId1,
          elementType: 'goal',
          visibilityMode: 'public',
        }
      );

      await visibilityManager.setElementVisibility(
        boardId,
        orgId,
        teamId,
        userId1,
        UserRole.EDITOR,
        {
          elementId: elementId2,
          elementType: 'outcome',
          visibilityMode: 'confidential',
        }
      );

      const history = await visibilityManager.getVisibilityHistory(boardId, elementId1);

      expect(history).toHaveLength(1);
      expect(history[0].element_id).toBe(elementId1);
    });
  });

  describe('Visibility Statistics', () => {
    beforeEach(async () => {
      await visibilityManager.setElementVisibility(
        boardId,
        orgId,
        teamId,
        userId1,
        UserRole.OWNER,
        {
          elementId: 'goal-001',
          elementType: 'goal',
          visibilityMode: 'public',
        }
      );

      await visibilityManager.setElementVisibility(
        boardId,
        orgId,
        teamId,
        userId1,
        UserRole.OWNER,
        {
          elementId: 'goal-002',
          elementType: 'goal',
          visibilityMode: 'confidential',
          viewerWhitelist: [userId1],
        }
      );

      await visibilityManager.setElementVisibility(
        boardId,
        orgId,
        teamId,
        userId1,
        UserRole.OWNER,
        {
          elementId: 'outcome-001',
          elementType: 'outcome',
          visibilityMode: 'confidential',
        }
      );

      await visibilityManager.setElementVisibility(
        boardId,
        orgId,
        teamId,
        userId1,
        UserRole.OWNER,
        {
          elementId: 'option-001',
          elementType: 'option',
          visibilityMode: 'public',
        }
      );
    });

    it('should calculate visibility statistics', async () => {
      const stats = await visibilityManager.getVisibilityStats(boardId);

      expect(stats.board_id).toBe(boardId);
      expect(stats.total_elements).toBe(4);
      expect(stats.confidential_elements).toBe(2);
      expect(stats.public_elements).toBe(2);
    });

    it('should count whitelisted elements', async () => {
      const stats = await visibilityManager.getVisibilityStats(boardId);

      expect(stats.whitelisted_elements).toBeGreaterThan(0);
    });

    it('should break down by element type', async () => {
      const stats = await visibilityManager.getVisibilityStats(boardId);

      expect(stats.confidential_by_type['goal']).toBe(1);
      expect(stats.confidential_by_type['outcome']).toBe(1);
      expect(stats.confidential_by_type['option']).toBe(0);
    });
  });

  describe('Redacted Elements', () => {
    it('should generate redacted element placeholder', () => {
      const redacted = visibilityManager.getRedactedElement('goal-001', 'goal');

      expect(redacted.element_id).toBe('goal-001');
      expect(redacted.element_type).toBe('goal');
      expect(redacted.redacted).toBe(true);
      expect(redacted.placeholder_text).toBe('[Confidential Goal]');
    });

    it('should generate redacted placeholders for different types', () => {
      const types: ElementType[] = ['goal', 'option', 'outcome', 'assumption', 'evidence', 'edge'];

      for (const type of types) {
        const redacted = visibilityManager.getRedactedElement('elem-001', type);
        expect(redacted.placeholder_text).toContain('Confidential');
        expect(redacted.element_type).toBe(type);
      }
    });
  });
});
