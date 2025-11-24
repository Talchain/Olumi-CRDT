/**
 * Database methods for snapshot records
 * Extension to DatabaseClient
 */

import { Pool } from 'pg';
import { pino } from 'pino';
import { BoardSnapshotRecord } from '../types/snapshot';
import { verifySnapshotHash } from '../utils/hash';
import { config } from '../config';

const logger = pino({ level: config.logging.level });

export class SnapshotDatabaseMethods {
  constructor(private pool: Pool) {}

  /**
   * HIGH PRIORITY FIX #5: Verify snapshot hash integrity
   * Validates that stored snapshot hash matches computed hash
   * Prevents corrupted or tampered snapshots from being used
   */
  private verifySnapshotIntegrity(record: BoardSnapshotRecord): boolean {
    const isValid = verifySnapshotHash(record.snapshot, record.snapshotHash);

    if (!isValid) {
      logger.error(
        {
          snapshotId: record.snapshotId,
          boardId: record.boardId,
          storedHash: record.snapshotHash,
        },
        'CRITICAL: Snapshot hash verification failed - data integrity compromised'
      );
    }

    return isValid;
  }

  /**
   * Store a snapshot record
   */
  async storeSnapshotRecord(record: BoardSnapshotRecord): Promise<void> {
    await this.pool.query(
      `INSERT INTO snapshot_records (
        snapshot_id, snapshot_hash, board_id, org_id, team_id,
        created_at, created_by_user_id, parent_snapshot_id, name, snapshot, is_immutable
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        record.snapshotId,
        record.snapshotHash,
        record.boardId,
        record.orgId,
        record.teamId,
        record.createdAt,
        record.createdByUserId,
        record.parentSnapshotId || null,
        record.name || null,
        JSON.stringify(record.snapshot),
        record.isImmutable,
      ]
    );
  }

  /**
   * Get snapshot record by ID
   * HIGH PRIORITY FIX #5: Verifies hash integrity on retrieval
   */
  async getSnapshotRecord(snapshotId: string): Promise<BoardSnapshotRecord | null> {
    const result = await this.pool.query<{
      snapshot_id: string;
      snapshot_hash: string;
      board_id: string;
      org_id: string;
      team_id: string;
      created_at: string;
      created_by_user_id: string;
      parent_snapshot_id: string | null;
      name: string | null;
      snapshot: any;
      is_immutable: boolean;
    }>(
      'SELECT * FROM snapshot_records WHERE snapshot_id = $1',
      [snapshotId]
    );

    if (result.rows.length === 0) {
      return null;
    }

    const row = result.rows[0];
    const record: BoardSnapshotRecord = {
      snapshotId: row.snapshot_id,
      snapshotHash: row.snapshot_hash,
      boardId: row.board_id,
      orgId: row.org_id,
      teamId: row.team_id,
      createdAt: row.created_at,
      createdByUserId: row.created_by_user_id,
      parentSnapshotId: row.parent_snapshot_id || undefined,
      name: row.name || undefined,
      snapshot: row.snapshot,
      isImmutable: row.is_immutable,
    };

    // HIGH PRIORITY FIX #5: Verify hash integrity
    if (!this.verifySnapshotIntegrity(record)) {
      logger.warn(
        { snapshotId },
        'Rejecting snapshot due to hash verification failure'
      );
      return null;
    }

    return record;
  }

  /**
   * Get current (latest) snapshot for a board
   * HIGH PRIORITY FIX #5: Verifies hash integrity on retrieval
   */
  async getCurrentSnapshot(boardId: string): Promise<BoardSnapshotRecord | null> {
    const result = await this.pool.query<{
      snapshot_id: string;
      snapshot_hash: string;
      board_id: string;
      org_id: string;
      team_id: string;
      created_at: string;
      created_by_user_id: string;
      parent_snapshot_id: string | null;
      name: string | null;
      snapshot: any;
      is_immutable: boolean;
    }>(
      `SELECT * FROM snapshot_records
       WHERE board_id = $1
       ORDER BY created_at DESC
       LIMIT 1`,
      [boardId]
    );

    if (result.rows.length === 0) {
      return null;
    }

    const row = result.rows[0];
    const record: BoardSnapshotRecord = {
      snapshotId: row.snapshot_id,
      snapshotHash: row.snapshot_hash,
      boardId: row.board_id,
      orgId: row.org_id,
      teamId: row.team_id,
      createdAt: row.created_at,
      createdByUserId: row.created_by_user_id,
      parentSnapshotId: row.parent_snapshot_id || undefined,
      name: row.name || undefined,
      snapshot: row.snapshot,
      isImmutable: row.is_immutable,
    };

    // HIGH PRIORITY FIX #5: Verify hash integrity
    if (!this.verifySnapshotIntegrity(record)) {
      logger.warn(
        { boardId, snapshotId: record.snapshotId },
        'Rejecting current snapshot due to hash verification failure'
      );
      return null;
    }

    return record;
  }

  /**
   * Mark snapshot as immutable
   */
  async markSnapshotImmutable(snapshotId: string): Promise<void> {
    await this.pool.query(
      'UPDATE snapshot_records SET is_immutable = TRUE WHERE snapshot_id = $1',
      [snapshotId]
    );
  }

  /**
   * List snapshots for a board
   * HIGH PRIORITY FIX #5: Verifies hash integrity for all snapshots
   */
  async listSnapshots(boardId: string, limit: number = 50): Promise<BoardSnapshotRecord[]> {
    const result = await this.pool.query<{
      snapshot_id: string;
      snapshot_hash: string;
      board_id: string;
      org_id: string;
      team_id: string;
      created_at: string;
      created_by_user_id: string;
      parent_snapshot_id: string | null;
      name: string | null;
      snapshot: any;
      is_immutable: boolean;
    }>(
      `SELECT * FROM snapshot_records
       WHERE board_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [boardId, limit]
    );

    const records = result.rows.map((row) => ({
      snapshotId: row.snapshot_id,
      snapshotHash: row.snapshot_hash,
      boardId: row.board_id,
      orgId: row.org_id,
      teamId: row.team_id,
      createdAt: row.created_at,
      createdByUserId: row.created_by_user_id,
      parentSnapshotId: row.parent_snapshot_id || undefined,
      name: row.name || undefined,
      snapshot: row.snapshot,
      isImmutable: row.is_immutable,
    }));

    // HIGH PRIORITY FIX #5: Verify hash integrity for all snapshots
    const validRecords = records.filter((record) => {
      const isValid = this.verifySnapshotIntegrity(record);
      if (!isValid) {
        logger.warn(
          { boardId, snapshotId: record.snapshotId },
          'Excluding snapshot from list due to hash verification failure'
        );
      }
      return isValid;
    });

    if (validRecords.length < records.length) {
      logger.error(
        {
          boardId,
          totalSnapshots: records.length,
          validSnapshots: validRecords.length,
          corruptedSnapshots: records.length - validRecords.length,
        },
        'CRITICAL: Corrupted snapshots detected in database'
      );
    }

    return validRecords;
  }

  /**
   * Update snapshot name
   */
  async updateSnapshotName(snapshotId: string, name: string): Promise<void> {
    await this.pool.query(
      'UPDATE snapshot_records SET name = $1 WHERE snapshot_id = $2',
      [name, snapshotId]
    );
  }

  /**
   * Get edit stats since a snapshot (for provenance)
   */
  async getEditStatsSinceSnapshot(
    boardId: string,
    parentSnapshotId?: string
  ): Promise<{ uniqueEditors: number; totalEdits: number }> {
    const query = parentSnapshotId
      ? `SELECT COUNT(DISTINCT user_id) as unique_editors, COUNT(*) as total_edits
         FROM edit_audit_log
         WHERE board_id = $1 AND created_at > (
           SELECT created_at FROM snapshot_records WHERE snapshot_id = $2
         )`
      : `SELECT COUNT(DISTINCT user_id) as unique_editors, COUNT(*) as total_edits
         FROM edit_audit_log
         WHERE board_id = $1`;

    const params = parentSnapshotId ? [boardId, parentSnapshotId] : [boardId];

    const result = await this.pool.query<{
      unique_editors: string;
      total_edits: string;
    }>(query, params);

    if (result.rows.length === 0) {
      return { uniqueEditors: 0, totalEdits: 0 };
    }

    return {
      uniqueEditors: parseInt(result.rows[0].unique_editors, 10),
      totalEdits: parseInt(result.rows[0].total_edits, 10),
    };
  }

  /**
   * Log an edit operation for audit trail
   */
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
    await this.pool.query(
      `INSERT INTO edit_audit_log (
        board_id, snapshot_id, org_id, team_id, user_id,
        operation_type, entity_type, entity_id, old_value, new_value
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        boardId,
        snapshotId || null,
        orgId,
        teamId,
        userId,
        operationType,
        entityType || null,
        entityId || null,
        oldValue ? JSON.stringify(oldValue) : null,
        newValue ? JSON.stringify(newValue) : null,
      ]
    );
  }

  /**
   * Get audit log for a board or snapshot
   */
  async getAuditLog(
    boardId: string,
    snapshotId?: string,
    limit: number = 100
  ): Promise<any[]> {
    const query = snapshotId
      ? `SELECT * FROM edit_audit_log
         WHERE board_id = $1 AND snapshot_id = $2
         ORDER BY created_at DESC
         LIMIT $3`
      : `SELECT * FROM edit_audit_log
         WHERE board_id = $1
         ORDER BY created_at DESC
         LIMIT $2`;

    const params = snapshotId ? [boardId, snapshotId, limit] : [boardId, limit];

    const result = await this.pool.query(query, params);
    return result.rows;
  }
}
