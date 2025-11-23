/**
 * Database Client - Visibility Extension
 *
 * Database operations for element-level visibility management.
 * Supports selective information sharing for confidential board elements.
 */

import { Pool } from 'pg';
import {
  ElementVisibility,
  VisibilityPolicy,
  VisibilityChangeEvent,
  VisibilityStats,
  ElementType,
  VisibilityMode,
} from '../types/visibility';

export class DatabaseClientVisibilityExtension {
  constructor(private pool: Pool) {}

  /**
   * Create visibility tables if not exists
   */
  async initializeVisibilitySchema(): Promise<void> {
    await this.pool.query(`
      -- Element-level visibility records
      CREATE TABLE IF NOT EXISTS element_visibility (
        visibility_id TEXT PRIMARY KEY,
        board_id TEXT NOT NULL,
        org_id TEXT NOT NULL,
        team_id TEXT NOT NULL,
        element_id TEXT NOT NULL,
        element_type TEXT NOT NULL,
        visibility_mode TEXT NOT NULL CHECK (visibility_mode IN ('public', 'confidential')),
        viewer_whitelist JSONB DEFAULT '[]'::jsonb,
        viewer_roles JSONB DEFAULT '[]'::jsonb,
        set_by_user_id TEXT NOT NULL,
        set_at TIMESTAMPTZ NOT NULL,
        rationale TEXT,
        created_at TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL,

        -- Unique constraint: one visibility record per element
        CONSTRAINT unique_element_visibility UNIQUE (board_id, element_id),

        -- Foreign key to boards table
        CONSTRAINT fk_board FOREIGN KEY (board_id) REFERENCES boards(id) ON DELETE CASCADE
      );

      -- Board-level visibility policies
      CREATE TABLE IF NOT EXISTS visibility_policies (
        policy_id TEXT PRIMARY KEY,
        board_id TEXT NOT NULL UNIQUE,
        org_id TEXT NOT NULL,
        team_id TEXT NOT NULL,
        default_visibility TEXT NOT NULL CHECK (default_visibility IN ('public', 'confidential')),
        allow_viewer_whitelist BOOLEAN DEFAULT TRUE,
        require_owner_for_confidential BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL,

        -- Foreign key to boards table
        CONSTRAINT fk_policy_board FOREIGN KEY (board_id) REFERENCES boards(id) ON DELETE CASCADE
      );

      -- Visibility change audit trail
      CREATE TABLE IF NOT EXISTS visibility_change_events (
        event_id TEXT PRIMARY KEY,
        board_id TEXT NOT NULL,
        element_id TEXT NOT NULL,
        element_type TEXT NOT NULL,
        changed_by_user_id TEXT NOT NULL,
        changed_at TIMESTAMPTZ NOT NULL,
        old_visibility TEXT CHECK (old_visibility IN ('public', 'confidential') OR old_visibility IS NULL),
        new_visibility TEXT NOT NULL CHECK (new_visibility IN ('public', 'confidential')),
        old_viewer_whitelist JSONB,
        new_viewer_whitelist JSONB,
        rationale TEXT,
        cascaded_elements JSONB DEFAULT '[]'::jsonb,

        -- Foreign key to boards table
        CONSTRAINT fk_event_board FOREIGN KEY (board_id) REFERENCES boards(id) ON DELETE CASCADE
      );

      -- Indexes for fast lookups
      CREATE INDEX IF NOT EXISTS idx_element_visibility_board_id ON element_visibility(board_id);
      CREATE INDEX IF NOT EXISTS idx_element_visibility_element_id ON element_visibility(element_id);
      CREATE INDEX IF NOT EXISTS idx_element_visibility_org_team ON element_visibility(org_id, team_id);
      CREATE INDEX IF NOT EXISTS idx_element_visibility_mode ON element_visibility(visibility_mode) WHERE visibility_mode = 'confidential';

      CREATE INDEX IF NOT EXISTS idx_visibility_policies_board_id ON visibility_policies(board_id);
      CREATE INDEX IF NOT EXISTS idx_visibility_policies_org_team ON visibility_policies(org_id, team_id);

      CREATE INDEX IF NOT EXISTS idx_visibility_events_board_id ON visibility_change_events(board_id);
      CREATE INDEX IF NOT EXISTS idx_visibility_events_element_id ON visibility_change_events(element_id);
      CREATE INDEX IF NOT EXISTS idx_visibility_events_changed_at ON visibility_change_events(changed_at DESC);
    `);
  }

  /**
   * Set element visibility
   */
  async setElementVisibility(
    visibility: ElementVisibility,
    orgId: string,
    teamId: string
  ): Promise<void> {
    // Check if visibility record already exists
    const existing = await this.getElementVisibility(visibility.board_id, visibility.element_id);

    if (existing) {
      // Update existing
      await this.pool.query(
        `
        UPDATE element_visibility
        SET
          visibility_mode = $1,
          viewer_whitelist = $2,
          viewer_roles = $3,
          set_by_user_id = $4,
          set_at = $5,
          rationale = $6,
          updated_at = $7
        WHERE board_id = $8 AND element_id = $9
      `,
        [
          visibility.visibility_mode,
          JSON.stringify(visibility.viewer_whitelist || []),
          JSON.stringify(visibility.viewer_roles || []),
          visibility.set_by_user_id,
          visibility.set_at,
          visibility.rationale || null,
          visibility.updated_at,
          visibility.board_id,
          visibility.element_id,
        ]
      );
    } else {
      // Insert new
      await this.pool.query(
        `
        INSERT INTO element_visibility (
          visibility_id, board_id, org_id, team_id, element_id, element_type,
          visibility_mode, viewer_whitelist, viewer_roles,
          set_by_user_id, set_at, rationale, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      `,
        [
          visibility.visibility_id,
          visibility.board_id,
          orgId,
          teamId,
          visibility.element_id,
          visibility.element_type,
          visibility.visibility_mode,
          JSON.stringify(visibility.viewer_whitelist || []),
          JSON.stringify(visibility.viewer_roles || []),
          visibility.set_by_user_id,
          visibility.set_at,
          visibility.rationale || null,
          visibility.created_at,
          visibility.updated_at,
        ]
      );
    }
  }

  /**
   * Get visibility for a specific element
   */
  async getElementVisibility(boardId: string, elementId: string): Promise<ElementVisibility | null> {
    const result = await this.pool.query(
      `
      SELECT * FROM element_visibility
      WHERE board_id = $1 AND element_id = $2
    `,
      [boardId, elementId]
    );

    if (result.rows.length === 0) {
      return null;
    }

    return this.rowToElementVisibility(result.rows[0]);
  }

  /**
   * Get all visibility records for a board
   */
  async getBoardVisibility(boardId: string): Promise<ElementVisibility[]> {
    const result = await this.pool.query(
      `
      SELECT * FROM element_visibility
      WHERE board_id = $1
      ORDER BY created_at DESC
    `,
      [boardId]
    );

    return result.rows.map((row) => this.rowToElementVisibility(row));
  }

  /**
   * Get confidential elements for a board
   */
  async getConfidentialElements(boardId: string): Promise<ElementVisibility[]> {
    const result = await this.pool.query(
      `
      SELECT * FROM element_visibility
      WHERE board_id = $1 AND visibility_mode = 'confidential'
      ORDER BY created_at DESC
    `,
      [boardId]
    );

    return result.rows.map((row) => this.rowToElementVisibility(row));
  }

  /**
   * Delete element visibility (when element is deleted)
   */
  async deleteElementVisibility(boardId: string, elementId: string): Promise<void> {
    await this.pool.query(
      `
      DELETE FROM element_visibility
      WHERE board_id = $1 AND element_id = $2
    `,
      [boardId, elementId]
    );
  }

  /**
   * Create or update visibility policy for a board
   */
  async setVisibilityPolicy(policy: VisibilityPolicy): Promise<void> {
    const existing = await this.getVisibilityPolicy(policy.board_id);

    if (existing) {
      // Update existing
      await this.pool.query(
        `
        UPDATE visibility_policies
        SET
          default_visibility = $1,
          allow_viewer_whitelist = $2,
          require_owner_for_confidential = $3,
          updated_at = $4
        WHERE board_id = $5
      `,
        [
          policy.default_visibility,
          policy.allow_viewer_whitelist,
          policy.require_owner_for_confidential,
          policy.updated_at,
          policy.board_id,
        ]
      );
    } else {
      // Insert new
      await this.pool.query(
        `
        INSERT INTO visibility_policies (
          policy_id, board_id, org_id, team_id,
          default_visibility, allow_viewer_whitelist, require_owner_for_confidential,
          created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      `,
        [
          policy.policy_id,
          policy.board_id,
          policy.org_id,
          policy.team_id,
          policy.default_visibility,
          policy.allow_viewer_whitelist,
          policy.require_owner_for_confidential,
          policy.created_at,
          policy.updated_at,
        ]
      );
    }
  }

  /**
   * Get visibility policy for a board
   */
  async getVisibilityPolicy(boardId: string): Promise<VisibilityPolicy | null> {
    const result = await this.pool.query(
      `
      SELECT * FROM visibility_policies
      WHERE board_id = $1
    `,
      [boardId]
    );

    if (result.rows.length === 0) {
      return null;
    }

    return this.rowToVisibilityPolicy(result.rows[0]);
  }

  /**
   * Record a visibility change event
   */
  async recordVisibilityChange(event: VisibilityChangeEvent): Promise<void> {
    await this.pool.query(
      `
      INSERT INTO visibility_change_events (
        event_id, board_id, element_id, element_type,
        changed_by_user_id, changed_at,
        old_visibility, new_visibility,
        old_viewer_whitelist, new_viewer_whitelist,
        rationale, cascaded_elements
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
    `,
      [
        event.event_id,
        event.board_id,
        event.element_id,
        event.element_type,
        event.changed_by_user_id,
        event.changed_at,
        event.old_visibility || null,
        event.new_visibility,
        event.old_viewer_whitelist ? JSON.stringify(event.old_viewer_whitelist) : null,
        event.new_viewer_whitelist ? JSON.stringify(event.new_viewer_whitelist) : null,
        event.rationale || null,
        JSON.stringify(event.cascaded_elements || []),
      ]
    );
  }

  /**
   * Get visibility change history for an element
   */
  async getVisibilityHistory(
    boardId: string,
    elementId?: string
  ): Promise<VisibilityChangeEvent[]> {
    let query = `
      SELECT * FROM visibility_change_events
      WHERE board_id = $1
    `;
    const params: any[] = [boardId];

    if (elementId) {
      query += ` AND element_id = $2`;
      params.push(elementId);
    }

    query += ` ORDER BY changed_at DESC LIMIT 100`;

    const result = await this.pool.query(query, params);

    return result.rows.map((row) => this.rowToVisibilityChangeEvent(row));
  }

  /**
   * Get visibility statistics for a board
   */
  async getVisibilityStats(boardId: string): Promise<VisibilityStats> {
    const result = await this.pool.query(
      `
      SELECT
        COUNT(*) as total_elements,
        SUM(CASE WHEN visibility_mode = 'confidential' THEN 1 ELSE 0 END) as confidential_elements,
        SUM(CASE WHEN visibility_mode = 'public' THEN 1 ELSE 0 END) as public_elements,
        SUM(CASE WHEN jsonb_array_length(viewer_whitelist) > 0 THEN 1 ELSE 0 END) as whitelisted_elements,
        element_type,
        SUM(CASE WHEN visibility_mode = 'confidential' THEN 1 ELSE 0 END) as confidential_count
      FROM element_visibility
      WHERE board_id = $1
      GROUP BY element_type
    `,
      [boardId]
    );

    const stats: VisibilityStats = {
      board_id: boardId,
      total_elements: 0,
      confidential_elements: 0,
      public_elements: 0,
      confidential_by_type: {} as Record<ElementType, number>,
      whitelisted_elements: 0,
    };

    // Aggregate results
    let totalWhitelisted = 0;

    for (const row of result.rows) {
      stats.total_elements += parseInt(row.total_elements, 10);
      stats.confidential_elements += parseInt(row.confidential_elements, 10);
      stats.public_elements += parseInt(row.public_elements, 10);
      totalWhitelisted += parseInt(row.whitelisted_elements, 10);

      const elementType = row.element_type as ElementType;
      stats.confidential_by_type[elementType] = parseInt(row.confidential_count, 10);
    }

    stats.whitelisted_elements = totalWhitelisted;

    return stats;
  }

  /**
   * Convert database row to ElementVisibility
   */
  private rowToElementVisibility(row: any): ElementVisibility {
    return {
      visibility_id: row.visibility_id,
      board_id: row.board_id,
      element_id: row.element_id,
      element_type: row.element_type as ElementType,
      visibility_mode: row.visibility_mode as VisibilityMode,
      viewer_whitelist: JSON.parse(row.viewer_whitelist || '[]'),
      viewer_roles: JSON.parse(row.viewer_roles || '[]'),
      set_by_user_id: row.set_by_user_id,
      set_at: row.set_at.toISOString(),
      rationale: row.rationale,
      created_at: row.created_at.toISOString(),
      updated_at: row.updated_at.toISOString(),
    };
  }

  /**
   * Convert database row to VisibilityPolicy
   */
  private rowToVisibilityPolicy(row: any): VisibilityPolicy {
    return {
      policy_id: row.policy_id,
      board_id: row.board_id,
      org_id: row.org_id,
      team_id: row.team_id,
      default_visibility: row.default_visibility as VisibilityMode,
      allow_viewer_whitelist: row.allow_viewer_whitelist,
      require_owner_for_confidential: row.require_owner_for_confidential,
      created_at: row.created_at.toISOString(),
      updated_at: row.updated_at.toISOString(),
    };
  }

  /**
   * Convert database row to VisibilityChangeEvent
   */
  private rowToVisibilityChangeEvent(row: any): VisibilityChangeEvent {
    return {
      event_id: row.event_id,
      board_id: row.board_id,
      element_id: row.element_id,
      element_type: row.element_type as ElementType,
      changed_by_user_id: row.changed_by_user_id,
      changed_at: row.changed_at.toISOString(),
      old_visibility: row.old_visibility as VisibilityMode | null,
      new_visibility: row.new_visibility as VisibilityMode,
      old_viewer_whitelist: row.old_viewer_whitelist
        ? JSON.parse(row.old_viewer_whitelist)
        : undefined,
      new_viewer_whitelist: row.new_viewer_whitelist
        ? JSON.parse(row.new_viewer_whitelist)
        : undefined,
      rationale: row.rationale,
      cascaded_elements: JSON.parse(row.cascaded_elements || '[]'),
    };
  }
}
