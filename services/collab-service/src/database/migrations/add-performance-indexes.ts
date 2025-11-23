/**
 * Performance-Critical Index Migration
 * Addresses HIGH Priority Security Issue #1: Missing Database Indexes
 *
 * Adds indexes for common query patterns to prevent performance degradation at scale
 */

import { Pool } from 'pg';
import { pino } from 'pino';

const logger = pino();

export async function addPerformanceIndexes(pool: Pool): Promise<void> {
  logger.info('Adding performance-critical indexes...');

  try {
    await pool.query('BEGIN');

    // Composite index for visibility checks (most common query)
    await pool.query(`
      CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_element_visibility_board_element
      ON element_visibility(board_id, element_id)
    `);

    // Index for user-specific access requests (dashboard queries)
    await pool.query(`
      CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_access_requests_user_status
      ON access_requests(requester_user_id, status)
      WHERE status = 'pending'
    `);

    // Index for board-specific pending requests (owner dashboard)
    await pool.query(`
      CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_access_requests_board_pending
      ON access_requests(board_id, status, requested_at DESC)
      WHERE status = 'pending'
    `);

    // Index for audit log queries by time range (common analytics query)
    await pool.query(`
      CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_visibility_events_board_time
      ON visibility_change_events(board_id, changed_at DESC)
    `);

    // Index for security audit log queries
    await pool.query(`
      CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_security_audit_user_time
      ON security_audit_log(user_id, timestamp DESC)
      WHERE user_id IS NOT NULL
    `);

    // Index for recent board activity
    await pool.query(`
      CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_boards_updated
      ON boards(updated_at DESC)
    `);

    // Partial index for confidential elements only (faster filtering)
    await pool.query(`
      CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_element_visibility_confidential_board
      ON element_visibility(board_id)
      WHERE visibility_mode = 'confidential'
    `);

    // Index for cascade propagation queries
    await pool.query(`
      CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_visibility_events_actor
      ON visibility_change_events(actor_user_id, changed_at DESC)
      WHERE actor_user_id IS NOT NULL
    `);

    // Index for team-based queries
    await pool.query(`
      CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_boards_team_updated
      ON boards(team_id, updated_at DESC)
      WHERE team_id IS NOT NULL
    `);

    // Index for snapshot queries by version
    await pool.query(`
      CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_snapshot_records_board_version
      ON snapshot_records(board_id, snapshot_version DESC)
    `);

    await pool.query('COMMIT');

    logger.info('✅ Performance indexes added successfully');
  } catch (error) {
    await pool.query('ROLLBACK');
    logger.error({ error }, 'Failed to add performance indexes');
    throw error;
  }
}

export async function removePerformanceIndexes(pool: Pool): Promise<void> {
  logger.info('Removing performance indexes (rollback)...');

  const indexes = [
    'idx_element_visibility_board_element',
    'idx_access_requests_user_status',
    'idx_access_requests_board_pending',
    'idx_visibility_events_board_time',
    'idx_security_audit_user_time',
    'idx_boards_updated',
    'idx_element_visibility_confidential_board',
    'idx_visibility_events_actor',
    'idx_boards_team_updated',
    'idx_snapshot_records_board_version',
  ];

  try {
    await pool.query('BEGIN');

    for (const indexName of indexes) {
      await pool.query(`DROP INDEX CONCURRENTLY IF EXISTS ${indexName}`);
    }

    await pool.query('COMMIT');
    logger.info('✅ Performance indexes removed');
  } catch (error) {
    await pool.query('ROLLBACK');
    logger.error({ error }, 'Failed to remove performance indexes');
    throw error;
  }
}

/**
 * Query analysis recommendations:
 *
 * 1. Most impactful indexes (by query frequency):
 *    - idx_element_visibility_board_element (visibility checks)
 *    - idx_access_requests_board_pending (dashboard)
 *    - idx_boards_updated (recent activity)
 *
 * 2. Index maintenance:
 *    - CONCURRENTLY option allows zero-downtime deployment
 *    - Partial indexes (WHERE clauses) reduce index size
 *    - DESC indexes support ORDER BY queries
 *
 * 3. Monitoring:
 *    - Run EXPLAIN ANALYZE on slow queries
 *    - Check pg_stat_user_indexes for unused indexes
 *    - Monitor index bloat with pg_stat_all_indexes
 */
