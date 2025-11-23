/**
 * Cryptographic hashing utilities
 */

import crypto from 'crypto';
import { CanonicalBoardSnapshot, serializeForHash } from '../types/snapshot';

/**
 * Compute SHA-256 hash of a canonical board snapshot
 * Returns deterministic hash for the same logical board state
 */
export function computeSnapshotHash(snapshot: CanonicalBoardSnapshot): string {
  const serialized = serializeForHash(snapshot);
  return crypto.createHash('sha256').update(serialized, 'utf8').digest('hex');
}

/**
 * Verify snapshot hash matches computed hash
 */
export function verifySnapshotHash(
  snapshot: CanonicalBoardSnapshot,
  expectedHash: string
): boolean {
  const computed = computeSnapshotHash(snapshot);
  return computed === expectedHash;
}

/**
 * Generate unique snapshot ID
 * Format: snap_<timestamp>_<random>
 */
export function generateSnapshotId(): string {
  const timestamp = Date.now();
  const random = crypto.randomBytes(8).toString('hex');
  return `snap_${timestamp}_${random}`;
}
