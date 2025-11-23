/**
 * Visibility Manager
 *
 * Manages element-level visibility for confidential board elements.
 * Enables selective information sharing in collaborative environments.
 *
 * Part of Phase 4, Section H: Selective Information Sharing
 */

import { pino } from 'pino';
import { DatabaseClient } from '../database/client';
import {
  ElementVisibility,
  VisibilityPolicy,
  VisibilityChangeEvent,
  VisibilityCheckResult,
  VisibilityStats,
  ElementType,
  VisibilityMode,
  RedactedElement,
} from '../types/visibility';
import { UserRole } from '../types/auth';

const logger = pino({ name: 'visibility-manager' });

export class VisibilityManager {
  constructor(private db: DatabaseClient) {}

  /**
   * Set visibility for an element
   *
   * SECURITY FIX (#9): Uses database transactions with row-level locking
   * to prevent race conditions and ensure atomic updates
   */
  async setElementVisibility(
    boardId: string,
    orgId: string,
    teamId: string,
    userId: string,
    userRole: UserRole,
    element: {
      elementId: string;
      elementType: ElementType;
      visibilityMode: VisibilityMode;
      viewerWhitelist?: string[];
      viewerRoles?: string[];
      rationale?: string;
    }
  ): Promise<ElementVisibility> {
    // SECURITY FIX: Use transaction with row-level locking
    const client = await this.db.getClient();

    try {
      await client.query('BEGIN');

      // Check board policy
      const policy = await this.db.getVisibilityPolicy(boardId);

      // Verify user has permission to set confidential
      if (element.visibilityMode === 'confidential') {
        if (policy?.require_owner_for_confidential && userRole !== 'owner') {
          throw new Error('Only board owners can mark elements as confidential');
        }
      }

      // Verify whitelisting is allowed
      if (element.viewerWhitelist && element.viewerWhitelist.length > 0) {
        if (policy && !policy.allow_viewer_whitelist) {
          throw new Error('Viewer whitelisting is not allowed for this board');
        }
      }

      // SECURITY FIX: Lock the row for update to prevent concurrent modifications
      const lockResult = await client.query(
        `SELECT * FROM element_visibility
         WHERE board_id = $1 AND element_id = $2
         FOR UPDATE`,
        [boardId, element.elementId]
      );

      const oldVisibility = lockResult.rows[0]
        ? this.mapElementVisibility(lockResult.rows[0])
        : null;

      const visibilityId = `vis_${Date.now()}_${Math.random().toString(36).substring(7)}`;
      const now = new Date().toISOString();

      const newVisibility: ElementVisibility = {
        visibility_id: visibilityId,
        board_id: boardId,
        element_id: element.elementId,
        element_type: element.elementType,
        visibility_mode: element.visibilityMode,
        viewer_whitelist: element.viewerWhitelist || [],
        viewer_roles: element.viewerRoles || [],
        set_by_user_id: userId,
        set_at: now,
        rationale: element.rationale,
        created_at: now,
        updated_at: now,
      };

      // Perform the update within the transaction
      await client.query(
        `INSERT INTO element_visibility (
          visibility_id, board_id, element_id, element_type,
          visibility_mode, viewer_whitelist, viewer_roles,
          set_by_user_id, set_at, rationale, created_at, updated_at, org_id, team_id
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
        ON CONFLICT (board_id, element_id)
        DO UPDATE SET
          visibility_mode = EXCLUDED.visibility_mode,
          viewer_whitelist = EXCLUDED.viewer_whitelist,
          viewer_roles = EXCLUDED.viewer_roles,
          set_by_user_id = EXCLUDED.set_by_user_id,
          set_at = EXCLUDED.set_at,
          rationale = EXCLUDED.rationale,
          updated_at = EXCLUDED.updated_at`,
        [
          newVisibility.visibility_id,
          newVisibility.board_id,
          newVisibility.element_id,
          newVisibility.element_type,
          newVisibility.visibility_mode,
          JSON.stringify(newVisibility.viewer_whitelist),
          JSON.stringify(newVisibility.viewer_roles),
          newVisibility.set_by_user_id,
          newVisibility.set_at,
          newVisibility.rationale || null,
          newVisibility.created_at,
          newVisibility.updated_at,
          orgId,
          teamId,
        ]
      );

      // Record change event for audit trail (within same transaction)
      const changeEvent: VisibilityChangeEvent = {
        event_id: `evt_${Date.now()}_${Math.random().toString(36).substring(7)}`,
        board_id: boardId,
        element_id: element.elementId,
        element_type: element.elementType,
        changed_by_user_id: userId,
        changed_at: now,
        old_visibility: oldVisibility?.visibility_mode || null,
        new_visibility: element.visibilityMode,
        old_viewer_whitelist: oldVisibility?.viewer_whitelist,
        new_viewer_whitelist: element.viewerWhitelist,
        rationale: element.rationale,
        cascaded_elements: [], // TODO: Implement edge cascading
      };

      await client.query(
        `INSERT INTO visibility_change_events (
          event_id, board_id, element_id, element_type,
          changed_by_user_id, changed_at, old_visibility, new_visibility,
          old_viewer_whitelist, new_viewer_whitelist, rationale, cascaded_elements
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [
          changeEvent.event_id,
          changeEvent.board_id,
          changeEvent.element_id,
          changeEvent.element_type,
          changeEvent.changed_by_user_id,
          changeEvent.changed_at,
          changeEvent.old_visibility,
          changeEvent.new_visibility,
          JSON.stringify(changeEvent.old_viewer_whitelist),
          JSON.stringify(changeEvent.new_viewer_whitelist),
          changeEvent.rationale || null,
          JSON.stringify(changeEvent.cascaded_elements),
        ]
      );

      // SECURITY FIX: Commit the transaction
      await client.query('COMMIT');

      logger.info(
        {
          boardId,
          elementId: element.elementId,
          userId,
          oldMode: oldVisibility?.visibility_mode,
          newMode: element.visibilityMode,
        },
        'Element visibility changed (atomic transaction)'
      );

      return newVisibility;
    } catch (error) {
      // SECURITY FIX: Rollback on any error
      await client.query('ROLLBACK');
      logger.error({ error, boardId, elementId: element.elementId }, 'Failed to set element visibility, transaction rolled back');
      throw error;
    } finally {
      // Release the client back to the pool
      client.release();
    }
  }

  /**
   * Check if a user can view an element
   */
  async canViewElement(
    boardId: string,
    elementId: string,
    userId: string,
    userRole: UserRole
  ): Promise<VisibilityCheckResult> {
    const visibility = await this.db.getElementVisibility(boardId, elementId);

    // If no visibility record, element is public by default
    if (!visibility) {
      return {
        can_view: true,
        can_edit_visibility: userRole === 'owner' || userRole === 'editor',
      };
    }

    // Public elements are visible to everyone
    if (visibility.visibility_mode === 'public') {
      return {
        can_view: true,
        can_edit_visibility: userRole === 'owner' || userRole === 'editor',
      };
    }

    // Confidential elements require permission checks
    if (visibility.visibility_mode === 'confidential') {
      // Owner can always view
      if (userRole === 'owner') {
        return {
          can_view: true,
          can_edit_visibility: true,
        };
      }

      // Check role-based access
      if (visibility.viewer_roles && visibility.viewer_roles.length > 0) {
        if (visibility.viewer_roles.includes(userRole)) {
          return {
            can_view: true,
            can_edit_visibility: userRole === 'editor',
          };
        }
      }

      // Check whitelist
      if (visibility.viewer_whitelist && visibility.viewer_whitelist.length > 0) {
        if (visibility.viewer_whitelist.includes(userId)) {
          return {
            can_view: true,
            can_edit_visibility: false,
          };
        }

        return {
          can_view: false,
          reason: 'not_whitelisted',
          can_edit_visibility: false,
        };
      }

      // No whitelist - role check failed
      return {
        can_view: false,
        reason: 'insufficient_role',
        can_edit_visibility: false,
      };
    }

    // Default deny
    return {
      can_view: false,
      reason: 'confidential',
      can_edit_visibility: false,
    };
  }

  /**
   * Filter elements based on visibility
   * Returns list of visible element IDs
   *
   * PERFORMANCE: Batch loads all visibility records to avoid N+1 queries
   */
  async filterVisibleElements(
    boardId: string,
    elementIds: string[],
    userId: string,
    userRole: UserRole
  ): Promise<string[]> {
    if (elementIds.length === 0) {
      return [];
    }

    // Batch load all visibility records for the board (single query)
    const visibilityRecords = await this.db.getBoardVisibility(boardId);
    const visibilityMap = new Map(
      visibilityRecords.map((v) => [v.element_id, v])
    );

    const visibleIds: string[] = [];

    // Check each element using in-memory data
    for (const elementId of elementIds) {
      const check = this.canViewElementSync(boardId, elementId, userId, userRole, visibilityMap);
      if (check.can_view) {
        visibleIds.push(elementId);
      }
    }

    return visibleIds;
  }

  /**
   * Synchronous version of canViewElement using pre-loaded visibility map
   * Used for batch operations to avoid N+1 queries
   */
  private canViewElementSync(
    _boardId: string,
    elementId: string,
    userId: string,
    userRole: UserRole,
    visibilityMap: Map<string, any>
  ): VisibilityCheckResult {
    const visibility = visibilityMap.get(elementId);

    // If no visibility record, element is public by default
    if (!visibility) {
      return {
        can_view: true,
        can_edit_visibility: userRole === 'owner' || userRole === 'editor',
      };
    }

    // Public elements are visible to everyone
    if (visibility.visibility_mode === 'public') {
      return {
        can_view: true,
        can_edit_visibility: userRole === 'owner' || userRole === 'editor',
      };
    }

    // Confidential elements require permission checks
    if (visibility.visibility_mode === 'confidential') {
      // Owner can always view
      if (userRole === 'owner') {
        return {
          can_view: true,
          can_edit_visibility: true,
        };
      }

      // Check role-based access
      if (visibility.viewer_roles && visibility.viewer_roles.length > 0) {
        if (visibility.viewer_roles.includes(userRole)) {
          return {
            can_view: true,
            can_edit_visibility: userRole === 'editor',
          };
        }
      }

      // Check whitelist
      if (visibility.viewer_whitelist && visibility.viewer_whitelist.length > 0) {
        if (visibility.viewer_whitelist.includes(userId)) {
          return {
            can_view: true,
            can_edit_visibility: false,
          };
        }

        return {
          can_view: false,
          reason: 'not_whitelisted',
          can_edit_visibility: false,
        };
      }

      // No whitelist - role check failed
      return {
        can_view: false,
        reason: 'insufficient_role',
        can_edit_visibility: false,
      };
    }

    // Default deny
    return {
      can_view: false,
      reason: 'confidential',
      can_edit_visibility: false,
    };
  }

  /**
   * Get redacted element placeholder
   */
  getRedactedElement(elementId: string, elementType: ElementType): RedactedElement {
    const typeLabels: Record<ElementType, string> = {
      goal: 'Goal',
      option: 'Option',
      outcome: 'Outcome',
      assumption: 'Assumption',
      evidence: 'Evidence',
      edge: 'Connection',
    };

    return {
      element_id: elementId,
      element_type: elementType,
      redacted: true,
      placeholder_text: `[Confidential ${typeLabels[elementType]}]`,
    };
  }

  /**
   * Create or update visibility policy for a board
   */
  async setVisibilityPolicy(
    boardId: string,
    orgId: string,
    teamId: string,
    userId: string,
    userRole: UserRole,
    policy: {
      default_visibility: VisibilityMode;
      allow_viewer_whitelist: boolean;
      require_owner_for_confidential: boolean;
    }
  ): Promise<VisibilityPolicy> {
    // Only owners can set policy
    if (userRole !== 'owner') {
      throw new Error('Only board owners can set visibility policy');
    }

    const policyId = `policy_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    const now = new Date().toISOString();

    const newPolicy: VisibilityPolicy = {
      policy_id: policyId,
      board_id: boardId,
      org_id: orgId,
      team_id: teamId,
      default_visibility: policy.default_visibility,
      allow_viewer_whitelist: policy.allow_viewer_whitelist,
      require_owner_for_confidential: policy.require_owner_for_confidential,
      created_at: now,
      updated_at: now,
    };

    await this.db.setVisibilityPolicy(newPolicy);

    logger.info(
      {
        boardId,
        userId,
        defaultVisibility: policy.default_visibility,
      },
      'Visibility policy updated'
    );

    return newPolicy;
  }

  /**
   * Get visibility policy for a board (or default)
   */
  async getVisibilityPolicy(boardId: string): Promise<VisibilityPolicy> {
    const policy = await this.db.getVisibilityPolicy(boardId);

    if (policy) {
      return policy;
    }

    // Return default policy
    return {
      policy_id: 'default',
      board_id: boardId,
      org_id: '',
      team_id: '',
      default_visibility: 'public',
      allow_viewer_whitelist: true,
      require_owner_for_confidential: false,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
  }

  /**
   * Get all visibility records for a board
   */
  async getBoardVisibility(boardId: string): Promise<ElementVisibility[]> {
    return this.db.getBoardVisibility(boardId);
  }

  /**
   * Get visibility for a specific element
   */
  async getElementVisibility(boardId: string, elementId: string): Promise<ElementVisibility | null> {
    return this.db.getElementVisibility(boardId, elementId);
  }

  /**
   * Get confidential elements for a board
   */
  async getConfidentialElements(boardId: string): Promise<ElementVisibility[]> {
    return this.db.getConfidentialElements(boardId);
  }

  /**
   * Delete element visibility (when element is deleted)
   */
  async deleteElementVisibility(boardId: string, elementId: string): Promise<void> {
    await this.db.deleteElementVisibility(boardId, elementId);

    logger.info({ boardId, elementId }, 'Element visibility deleted');
  }

  /**
   * Get visibility change history
   */
  async getVisibilityHistory(
    boardId: string,
    elementId?: string
  ): Promise<VisibilityChangeEvent[]> {
    return this.db.getVisibilityHistory(boardId, elementId);
  }

  /**
   * Get visibility statistics for a board
   */
  async getVisibilityStats(boardId: string): Promise<VisibilityStats> {
    return this.db.getVisibilityStats(boardId);
  }

  /**
   * Bulk check visibility for multiple elements
   * Returns map of elementId -> VisibilityCheckResult
   */
  async bulkCheckVisibility(
    boardId: string,
    elementIds: string[],
    userId: string,
    userRole: UserRole
  ): Promise<Map<string, VisibilityCheckResult>> {
    const results = new Map<string, VisibilityCheckResult>();

    for (const elementId of elementIds) {
      const check = await this.canViewElement(boardId, elementId, userId, userRole);
      results.set(elementId, check);
    }

    return results;
  }

  /**
   * Map database row to ElementVisibility object
   * Helper method for transaction-based visibility updates
   */
  private mapElementVisibility(row: any): ElementVisibility {
    return {
      visibility_id: row.visibility_id,
      board_id: row.board_id,
      element_id: row.element_id,
      element_type: row.element_type,
      visibility_mode: row.visibility_mode,
      viewer_whitelist: Array.isArray(row.viewer_whitelist)
        ? row.viewer_whitelist
        : JSON.parse(row.viewer_whitelist || '[]'),
      viewer_roles: Array.isArray(row.viewer_roles)
        ? row.viewer_roles
        : JSON.parse(row.viewer_roles || '[]'),
      set_by_user_id: row.set_by_user_id,
      set_at: row.set_at,
      rationale: row.rationale || undefined,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }
}
