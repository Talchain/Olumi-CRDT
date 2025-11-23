/**
 * Snapshot manager - handles creation, lineage, and immutability
 */

import { pino } from 'pino';
import { DatabaseClient } from '../database/client';
import { BoardDocument } from '../types/board';
import {
  BoardSnapshotRecord,
  CreateSnapshotRequest,
  SnapshotProvenance,
  toCanonicalSnapshot,
} from '../types/snapshot';
import { computeSnapshotHash, generateSnapshotId } from '../utils/hash';
import { config } from '../config';

const logger = pino({ level: config.logging.level });

export class SnapshotManager {
  constructor(private db: DatabaseClient) {}

  /**
   * Create a new snapshot from current board state
   */
  async createSnapshot(
    board: BoardDocument,
    teamId: string,
    request: CreateSnapshotRequest
  ): Promise<BoardSnapshotRecord> {
    logger.info(
      { boardId: request.boardId, triggerType: request.triggerType },
      'Creating snapshot'
    );

    // Get current snapshot to establish lineage
    const currentSnapshot = await this.db.getCurrentSnapshot(request.boardId);

    // Convert to canonical form
    const canonicalSnapshot = toCanonicalSnapshot(board, teamId);

    // Compute hash
    const snapshotHash = computeSnapshotHash(canonicalSnapshot);

    // Check if we already have this exact snapshot
    if (currentSnapshot && currentSnapshot.snapshotHash === snapshotHash) {
      logger.debug({ snapshotHash }, 'Snapshot hash unchanged, reusing current');
      return currentSnapshot;
    }

    // Create new snapshot record
    const snapshotRecord: BoardSnapshotRecord = {
      snapshotId: generateSnapshotId(),
      snapshotHash,
      boardId: request.boardId,
      orgId: board.orgId,
      teamId,
      createdAt: new Date().toISOString(),
      createdByUserId: request.userId,
      parentSnapshotId: currentSnapshot?.snapshotId,
      name: request.name,
      snapshot: canonicalSnapshot,
      isImmutable: false, // Will be set to true when referenced by a run
    };

    // Persist to database
    await this.db.storeSnapshotRecord(snapshotRecord);

    logger.info(
      {
        snapshotId: snapshotRecord.snapshotId,
        snapshotHash,
        parentSnapshotId: snapshotRecord.parentSnapshotId,
      },
      'Snapshot created'
    );

    return snapshotRecord;
  }

  /**
   * Get snapshot by ID
   */
  async getSnapshot(snapshotId: string): Promise<BoardSnapshotRecord | null> {
    return this.db.getSnapshotRecord(snapshotId);
  }

  /**
   * Get current snapshot for a board
   */
  async getCurrentSnapshot(boardId: string): Promise<BoardSnapshotRecord | null> {
    return this.db.getCurrentSnapshot(boardId);
  }

  /**
   * Mark snapshot as immutable (referenced by a run)
   */
  async markSnapshotImmutable(snapshotId: string): Promise<void> {
    await this.db.markSnapshotImmutable(snapshotId);
    logger.info({ snapshotId }, 'Snapshot marked immutable');
  }

  /**
   * Get snapshot lineage (ancestry chain)
   */
  async getSnapshotLineage(snapshotId: string): Promise<BoardSnapshotRecord[]> {
    const lineage: BoardSnapshotRecord[] = [];
    let currentId: string | undefined = snapshotId;

    while (currentId) {
      const snapshot = await this.db.getSnapshotRecord(currentId);
      if (!snapshot) break;

      lineage.push(snapshot);
      currentId = snapshot.parentSnapshotId;

      // Safety limit
      if (lineage.length > 1000) {
        logger.warn({ snapshotId }, 'Lineage exceeds 1000 snapshots, truncating');
        break;
      }
    }

    return lineage;
  }

  /**
   * Get snapshot provenance metadata
   */
  async getSnapshotProvenance(snapshotId: string): Promise<SnapshotProvenance | null> {
    const snapshot = await this.db.getSnapshotRecord(snapshotId);
    if (!snapshot) return null;

    // Get edit stats since parent
    const editStats = await this.db.getEditStatsSinceSnapshot(
      snapshot.boardId,
      snapshot.parentSnapshotId
    );

    return {
      snapshotId: snapshot.snapshotId,
      snapshotHash: snapshot.snapshotHash,
      parentSnapshotId: snapshot.parentSnapshotId,
      uniqueEditorCount: editStats.uniqueEditors,
      editCount: editStats.totalEdits,
      createdAt: snapshot.createdAt,
      createdByUserId: snapshot.createdByUserId,
    };
  }

  /**
   * List snapshots for a board
   */
  async listSnapshots(
    boardId: string,
    limit: number = 50
  ): Promise<BoardSnapshotRecord[]> {
    return this.db.listSnapshots(boardId, limit);
  }

  /**
   * Update snapshot name
   */
  async updateSnapshotName(snapshotId: string, name: string): Promise<void> {
    await this.db.updateSnapshotName(snapshotId, name);
    logger.info({ snapshotId, name }, 'Snapshot name updated');
  }

  /**
   * Attempt to mutate immutable snapshot (should fail)
   */
  async canMutateSnapshot(snapshotId: string): Promise<boolean> {
    const snapshot = await this.db.getSnapshotRecord(snapshotId);
    if (!snapshot) return false;
    return !snapshot.isImmutable;
  }
}
