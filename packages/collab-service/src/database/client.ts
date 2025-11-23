/**
 * Database client for PostgreSQL
 */

import { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';
import { config } from '../config';
import { BoardDocument, BoardSnapshot } from '../types/board';
import { BoardSnapshotRecord } from '../types/snapshot';
import { Comment } from '../types/comments';
import {
  ElementVisibility,
  VisibilityPolicy,
  VisibilityChangeEvent,
  VisibilityStats,
} from '../types/visibility';
import { SnapshotDatabaseMethods } from './client-snapshots';
import { DatabaseClientCommentsExtension } from './client-comments';
import { DatabaseClientVisibilityExtension } from './client-visibility';
import { AccessRequestsDatabase } from './client-access-requests';
import { pino } from 'pino';

const logger = pino({ level: config.logging.level });

export class DatabaseClient {
  private pool: Pool;
  private snapshotMethods: SnapshotDatabaseMethods;
  private commentsMethods: DatabaseClientCommentsExtension;
  private visibilityMethods: DatabaseClientVisibilityExtension;
  public accessRequestsMethods: AccessRequestsDatabase;

  constructor() {
    this.pool = new Pool({
      connectionString: config.database.url,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
    });

    this.pool.on('error', (err) => {
      logger.error({ err }, 'Unexpected database error');
    });

    this.snapshotMethods = new SnapshotDatabaseMethods(this.pool);
    this.commentsMethods = new DatabaseClientCommentsExtension(this.pool);
    this.visibilityMethods = new DatabaseClientVisibilityExtension(this.pool);
    this.accessRequestsMethods = new AccessRequestsDatabase(this.pool);
  }

  async query<T extends QueryResultRow = any>(text: string, params?: any[]): Promise<QueryResult<T>> {
    const start = Date.now();
    try {
      const result = await this.pool.query<T>(text, params);
      const duration = Date.now() - start;
      logger.debug({ query: text, duration, rows: result.rowCount }, 'Query executed');
      return result;
    } catch (err) {
      logger.error({ err, query: text }, 'Query failed');
      throw err;
    }
  }

  async getClient(): Promise<PoolClient> {
    return this.pool.connect();
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  /**
   * Initialize database schema
   */
  async initialize(): Promise<void> {
    logger.info('Initializing database schema');

    await this.query(`
      CREATE TABLE IF NOT EXISTS boards (
        id UUID PRIMARY KEY,
        org_id UUID NOT NULL,
        team_id UUID NOT NULL,
        owner_id UUID NOT NULL,
        data JSONB NOT NULL,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);

    // Add team_id column if it doesn't exist (migration for existing tables)
    await this.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'boards' AND column_name = 'team_id'
        ) THEN
          ALTER TABLE boards ADD COLUMN team_id UUID;
        END IF;
      END $$;
    `);

    await this.query(`
      CREATE INDEX IF NOT EXISTS idx_boards_org_id ON boards(org_id);
    `);

    await this.query(`
      CREATE INDEX IF NOT EXISTS idx_boards_team_id ON boards(team_id);
    `);

    await this.query(`
      CREATE INDEX IF NOT EXISTS idx_boards_owner_id ON boards(owner_id);
    `);

    await this.query(`
      CREATE TABLE IF NOT EXISTS yjs_updates (
        id SERIAL PRIMARY KEY,
        board_id UUID NOT NULL,
        org_id UUID NOT NULL,
        clock INTEGER NOT NULL,
        update BYTEA NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    await this.query(`
      CREATE INDEX IF NOT EXISTS idx_yjs_updates_board_clock ON yjs_updates(board_id, clock);
    `);

    await this.query(`
      CREATE INDEX IF NOT EXISTS idx_yjs_updates_org_board ON yjs_updates(org_id, board_id);
    `);

    await this.query(`
      CREATE TABLE IF NOT EXISTS board_snapshots (
        id UUID PRIMARY KEY,
        board_id UUID NOT NULL,
        org_id UUID NOT NULL,
        version INTEGER NOT NULL,
        data JSONB NOT NULL,
        snapshot_type VARCHAR(20) NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    await this.query(`
      CREATE INDEX IF NOT EXISTS idx_board_snapshots_board_latest
      ON board_snapshots(board_id, created_at DESC);
    `);

    await this.query(`
      CREATE INDEX IF NOT EXISTS idx_board_snapshots_org_board
      ON board_snapshots(org_id, board_id);
    `);

    // New table for canonical snapshot records (Phase 2)
    await this.query(`
      CREATE TABLE IF NOT EXISTS snapshot_records (
        snapshot_id VARCHAR(255) PRIMARY KEY,
        snapshot_hash VARCHAR(64) NOT NULL,
        board_id UUID NOT NULL,
        org_id UUID NOT NULL,
        team_id UUID NOT NULL,
        created_at TIMESTAMP NOT NULL,
        created_by_user_id UUID NOT NULL,
        parent_snapshot_id VARCHAR(255),
        name TEXT,
        snapshot JSONB NOT NULL,
        is_immutable BOOLEAN DEFAULT FALSE
      );
    `);

    await this.query(`
      CREATE INDEX IF NOT EXISTS idx_snapshot_records_board
      ON snapshot_records(board_id, created_at DESC);
    `);

    await this.query(`
      CREATE INDEX IF NOT EXISTS idx_snapshot_records_hash
      ON snapshot_records(snapshot_hash);
    `);

    await this.query(`
      CREATE INDEX IF NOT EXISTS idx_snapshot_records_parent
      ON snapshot_records(parent_snapshot_id);
    `);

    // Audit log table for edit provenance (Phase 2)
    await this.query(`
      CREATE TABLE IF NOT EXISTS edit_audit_log (
        id SERIAL PRIMARY KEY,
        board_id UUID NOT NULL,
        snapshot_id VARCHAR(255),
        org_id UUID NOT NULL,
        team_id UUID NOT NULL,
        user_id UUID NOT NULL,
        operation_type VARCHAR(50) NOT NULL,
        entity_type VARCHAR(50),
        entity_id VARCHAR(255),
        old_value JSONB,
        new_value JSONB,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    await this.query(`
      CREATE INDEX IF NOT EXISTS idx_edit_audit_log_board
      ON edit_audit_log(board_id, created_at DESC);
    `);

    await this.query(`
      CREATE INDEX IF NOT EXISTS idx_edit_audit_log_snapshot
      ON edit_audit_log(snapshot_id);
    `);

    // Team memberships table for multi-tenant authorization (Phase 2 - Section 3)
    await this.query(`
      CREATE TABLE IF NOT EXISTS team_memberships (
        user_id UUID NOT NULL,
        team_id UUID NOT NULL,
        org_id UUID NOT NULL,
        role VARCHAR(50) NOT NULL,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW(),
        PRIMARY KEY (user_id, team_id)
      );
    `);

    await this.query(`
      CREATE INDEX IF NOT EXISTS idx_team_memberships_user
      ON team_memberships(user_id, org_id);
    `);

    await this.query(`
      CREATE INDEX IF NOT EXISTS idx_team_memberships_team
      ON team_memberships(team_id);
    `);

    // Comments table (Phase 2 - Section 6)
    await this.commentsMethods.initializeCommentsSchema();

    // Visibility tables (Phase 4 - Section H)
    await this.visibilityMethods.initializeVisibilitySchema();

    logger.info('Database schema initialized');
  }

  /**
   * Get board metadata
   */
  async getBoard(boardId: string): Promise<{ orgId: string; teamId: string; ownerId: string; data: BoardDocument } | null> {
    const result = await this.query<{ org_id: string; team_id: string; owner_id: string; data: BoardDocument }>(
      'SELECT org_id, team_id, owner_id, data FROM boards WHERE id = $1',
      [boardId]
    );

    if (result.rows.length === 0) {
      return null;
    }

    return {
      orgId: result.rows[0].org_id,
      teamId: result.rows[0].team_id,
      ownerId: result.rows[0].owner_id,
      data: result.rows[0].data,
    };
  }

  /**
   * Store Yjs update
   */
  async storeYjsUpdate(boardId: string, orgId: string, clock: number, update: Uint8Array): Promise<void> {
    await this.query(
      'INSERT INTO yjs_updates (board_id, org_id, clock, update) VALUES ($1, $2, $3, $4)',
      [boardId, orgId, clock, Buffer.from(update)]
    );
  }

  /**
   * Get all Yjs updates for a board
   */
  async getYjsUpdates(boardId: string): Promise<Uint8Array[]> {
    const result = await this.query<{ update: Buffer }>(
      'SELECT update FROM yjs_updates WHERE board_id = $1 ORDER BY clock ASC',
      [boardId]
    );

    return result.rows.map((row) => new Uint8Array(row.update));
  }

  /**
   * Get Yjs updates since a specific clock
   */
  async getYjsUpdatesSince(boardId: string, clock: number): Promise<Uint8Array[]> {
    const result = await this.query<{ update: Buffer }>(
      'SELECT update FROM yjs_updates WHERE board_id = $1 AND clock > $2 ORDER BY clock ASC',
      [boardId, clock]
    );

    return result.rows.map((row) => new Uint8Array(row.update));
  }

  /**
   * Store board snapshot
   */
  async storeSnapshot(snapshot: BoardSnapshot): Promise<void> {
    await this.query(
      `INSERT INTO board_snapshots (id, board_id, org_id, version, data, snapshot_type, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        snapshot.id,
        snapshot.boardId,
        snapshot.orgId,
        snapshot.version,
        JSON.stringify(snapshot.data),
        snapshot.snapshotType,
        snapshot.createdAt,
      ]
    );
  }

  /**
   * Get latest snapshot for a board
   */
  async getLatestSnapshot(boardId: string): Promise<BoardSnapshot | null> {
    const result = await this.query<{
      id: string;
      board_id: string;
      org_id: string;
      version: number;
      data: BoardDocument;
      snapshot_type: string;
      created_at: string;
    }>(
      `SELECT id, board_id, org_id, version, data, snapshot_type, created_at
       FROM board_snapshots
       WHERE board_id = $1
       ORDER BY created_at DESC
       LIMIT 1`,
      [boardId]
    );

    if (result.rows.length === 0) {
      return null;
    }

    const row = result.rows[0];
    return {
      id: row.id,
      boardId: row.board_id,
      orgId: row.org_id,
      version: row.version,
      data: row.data,
      snapshotType: row.snapshot_type as 'periodic' | 'on_run' | 'manual',
      createdAt: row.created_at,
    };
  }

  /**
   * Prune old Yjs updates (keep last N days)
   */
  async pruneOldUpdates(daysToKeep: number = 7): Promise<number> {
    // Validate input
    if (!Number.isInteger(daysToKeep) || daysToKeep < 1 || daysToKeep > 365) {
      throw new Error('daysToKeep must be an integer between 1 and 365');
    }

    const result = await this.query(
      `DELETE FROM yjs_updates
       WHERE created_at < NOW() - INTERVAL $1`,
      [`${daysToKeep} days`]
    );

    return result.rowCount || 0;
  }

  /**
   * Create or update board
   */
  async upsertBoard(board: BoardDocument): Promise<void> {
    await this.query(
      `INSERT INTO boards (id, org_id, owner_id, data, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (id) DO UPDATE SET
         data = $4,
         updated_at = $6`,
      [
        board.id,
        board.orgId,
        board.ownerId,
        JSON.stringify(board),
        board.createdAt,
        board.updatedAt,
      ]
    );
  }

  // Snapshot record methods (Phase 2)
  async storeSnapshotRecord(record: BoardSnapshotRecord): Promise<void> {
    return this.snapshotMethods.storeSnapshotRecord(record);
  }

  async getSnapshotRecord(snapshotId: string): Promise<BoardSnapshotRecord | null> {
    return this.snapshotMethods.getSnapshotRecord(snapshotId);
  }

  async getCurrentSnapshot(boardId: string): Promise<BoardSnapshotRecord | null> {
    return this.snapshotMethods.getCurrentSnapshot(boardId);
  }

  async markSnapshotImmutable(snapshotId: string): Promise<void> {
    return this.snapshotMethods.markSnapshotImmutable(snapshotId);
  }

  async listSnapshots(boardId: string, limit?: number): Promise<BoardSnapshotRecord[]> {
    return this.snapshotMethods.listSnapshots(boardId, limit);
  }

  async updateSnapshotName(snapshotId: string, name: string): Promise<void> {
    return this.snapshotMethods.updateSnapshotName(snapshotId, name);
  }

  async getEditStatsSinceSnapshot(
    boardId: string,
    parentSnapshotId?: string
  ): Promise<{ uniqueEditors: number; totalEdits: number }> {
    return this.snapshotMethods.getEditStatsSinceSnapshot(boardId, parentSnapshotId);
  }

  async logEdit(
    boardId: string,
    orgId: string,
    teamId: string,
    userId: string,
    operationType: string,
    entityType?: string,
    entityId?: string,
    oldValue?: any,
    newValue?: any,
    snapshotId?: string
  ): Promise<void> {
    return this.snapshotMethods.logEdit(
      boardId,
      orgId,
      teamId,
      userId,
      operationType,
      entityType,
      entityId,
      oldValue,
      newValue,
      snapshotId
    );
  }

  async getAuditLog(boardId: string, snapshotId?: string, limit?: number): Promise<any[]> {
    return this.snapshotMethods.getAuditLog(boardId, snapshotId, limit);
  }

  /**
   * Get user's team memberships
   * TODO: This is a placeholder implementation
   * In production, this should query a team_memberships table or call a team service
   */
  async getUserTeamMemberships(
    userId: string,
    orgId: string
  ): Promise<Array<{ teamId: string; role: import('../types/auth').UserRole }>> {
    try {
      // TODO: Replace with actual query to team_memberships table
      // For now, return empty array (will rely on fallback logic)
      // Expected schema:
      // CREATE TABLE team_memberships (
      //   user_id UUID NOT NULL,
      //   team_id UUID NOT NULL,
      //   org_id UUID NOT NULL,
      //   role VARCHAR(50) NOT NULL,
      //   PRIMARY KEY (user_id, team_id)
      // );

      const result = await this.query<{
        team_id: string;
        role: string;
      }>(
        `SELECT team_id, role FROM team_memberships
         WHERE user_id = $1 AND org_id = $2`,
        [userId, orgId]
      );

      return result.rows.map((row) => ({
        teamId: row.team_id,
        role: row.role as import('../types/auth').UserRole,
      }));
    } catch (err) {
      // Table may not exist yet - return empty array
      logger.warn(
        { err, userId, orgId },
        'Failed to get team memberships (table may not exist)'
      );
      return [];
    }
  }

  // ========== Comments Methods (Phase 2 - Section 6) ==========

  async createComment(comment: Comment, orgId: string, teamId: string): Promise<void> {
    return this.commentsMethods.createComment(comment, orgId, teamId);
  }

  async getComment(commentId: string): Promise<Comment | null> {
    return this.commentsMethods.getComment(commentId);
  }

  async updateComment(commentId: string, comment: Comment): Promise<void> {
    return this.commentsMethods.updateComment(commentId, comment);
  }

  async deleteComment(commentId: string): Promise<void> {
    return this.commentsMethods.deleteComment(commentId);
  }

  async getComments(
    boardId: string,
    options?: {
      entityId?: string;
      resolved?: boolean;
      includeDeleted?: boolean;
    }
  ): Promise<Comment[]> {
    return this.commentsMethods.getComments(boardId, options);
  }

  // ========== Visibility Methods (Phase 4 - Section H) ==========

  async setElementVisibility(
    visibility: ElementVisibility,
    orgId: string,
    teamId: string
  ): Promise<void> {
    return this.visibilityMethods.setElementVisibility(visibility, orgId, teamId);
  }

  async getElementVisibility(boardId: string, elementId: string): Promise<ElementVisibility | null> {
    return this.visibilityMethods.getElementVisibility(boardId, elementId);
  }

  async getBoardVisibility(boardId: string): Promise<ElementVisibility[]> {
    return this.visibilityMethods.getBoardVisibility(boardId);
  }

  async getConfidentialElements(boardId: string): Promise<ElementVisibility[]> {
    return this.visibilityMethods.getConfidentialElements(boardId);
  }

  async deleteElementVisibility(boardId: string, elementId: string): Promise<void> {
    return this.visibilityMethods.deleteElementVisibility(boardId, elementId);
  }

  async setVisibilityPolicy(policy: VisibilityPolicy): Promise<void> {
    return this.visibilityMethods.setVisibilityPolicy(policy);
  }

  async getVisibilityPolicy(boardId: string): Promise<VisibilityPolicy | null> {
    return this.visibilityMethods.getVisibilityPolicy(boardId);
  }

  async recordVisibilityChange(event: VisibilityChangeEvent): Promise<void> {
    return this.visibilityMethods.recordVisibilityChange(event);
  }

  async getVisibilityHistory(
    boardId: string,
    elementId?: string
  ): Promise<VisibilityChangeEvent[]> {
    return this.visibilityMethods.getVisibilityHistory(boardId, elementId);
  }

  async getVisibilityStats(boardId: string): Promise<VisibilityStats> {
    return this.visibilityMethods.getVisibilityStats(boardId);
  }
}
