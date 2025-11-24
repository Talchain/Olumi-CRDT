/**
 * HIGH PRIORITY FIX #7: Add CASCADE Cleanup on Board Deletion
 *
 * Ensures all related data is properly cleaned up when a board is deleted
 * to prevent orphaned records and data bloat.
 */

import { Pool } from 'pg';
import { pino } from 'pino';

const logger = pino();

export async function addCascadeConstraints(pool: Pool): Promise<void> {
  logger.info('Adding CASCADE constraints for board deletion cleanup...');

  try {
    await pool.query('BEGIN');

    // Element visibility - CASCADE delete when board is deleted
    await pool.query(`
      ALTER TABLE element_visibility
      DROP CONSTRAINT IF EXISTS element_visibility_board_fkey;

      ALTER TABLE element_visibility
      ADD CONSTRAINT element_visibility_board_fkey
      FOREIGN KEY (board_id)
      REFERENCES boards(id)
      ON DELETE CASCADE;
    `);

    // Visibility policies - CASCADE delete when board is deleted
    await pool.query(`
      ALTER TABLE visibility_policies
      DROP CONSTRAINT IF EXISTS visibility_policies_board_fkey;

      ALTER TABLE visibility_policies
      ADD CONSTRAINT visibility_policies_board_fkey
      FOREIGN KEY (board_id)
      REFERENCES boards(id)
      ON DELETE CASCADE;
    `);

    // Visibility change events - CASCADE delete when board is deleted
    await pool.query(`
      ALTER TABLE visibility_change_events
      DROP CONSTRAINT IF EXISTS visibility_change_events_board_fkey;

      ALTER TABLE visibility_change_events
      ADD CONSTRAINT visibility_change_events_board_fkey
      FOREIGN KEY (board_id)
      REFERENCES boards(id)
      ON DELETE CASCADE;
    `);

    // Board comments - CASCADE delete when board is deleted
    await pool.query(`
      ALTER TABLE board_comments
      DROP CONSTRAINT IF EXISTS board_comments_board_fkey;

      ALTER TABLE board_comments
      ADD CONSTRAINT board_comments_board_fkey
      FOREIGN KEY (board_id)
      REFERENCES boards(id)
      ON DELETE CASCADE;
    `);

    // Board snapshots - CASCADE delete when board is deleted
    await pool.query(`
      ALTER TABLE board_snapshots
      DROP CONSTRAINT IF EXISTS board_snapshots_board_fkey;

      ALTER TABLE board_snapshots
      ADD CONSTRAINT board_snapshots_board_fkey
      FOREIGN KEY (board_id)
      REFERENCES boards(id)
      ON DELETE CASCADE;
    `);

    // Snapshot records - CASCADE delete when board is deleted
    await pool.query(`
      ALTER TABLE snapshot_records
      DROP CONSTRAINT IF EXISTS snapshot_records_board_fkey;

      ALTER TABLE snapshot_records
      ADD CONSTRAINT snapshot_records_board_fkey
      FOREIGN KEY (board_id)
      REFERENCES boards(id)
      ON DELETE CASCADE;
    `);

    // YJS updates - CASCADE delete when board is deleted
    await pool.query(`
      ALTER TABLE yjs_updates
      DROP CONSTRAINT IF EXISTS yjs_updates_board_fkey;

      ALTER TABLE yjs_updates
      ADD CONSTRAINT yjs_updates_board_fkey
      FOREIGN KEY (board_id)
      REFERENCES boards(id)
      ON DELETE CASCADE;
    `);

    // Edit audit log - CASCADE delete when board is deleted
    await pool.query(`
      ALTER TABLE edit_audit_log
      DROP CONSTRAINT IF EXISTS edit_audit_log_board_fkey;

      ALTER TABLE edit_audit_log
      ADD CONSTRAINT edit_audit_log_board_fkey
      FOREIGN KEY (board_id)
      REFERENCES boards(id)
      ON DELETE CASCADE;
    `);

    // Access requests - CASCADE delete when board is deleted
    await pool.query(`
      ALTER TABLE access_requests
      DROP CONSTRAINT IF EXISTS access_requests_board_fkey;

      ALTER TABLE access_requests
      ADD CONSTRAINT access_requests_board_fkey
      FOREIGN KEY (board_id)
      REFERENCES boards(id)
      ON DELETE CASCADE;
    `);

    await pool.query('COMMIT');

    logger.info('✅ CASCADE constraints added successfully');
    logger.info('All related data will now be automatically cleaned up when a board is deleted');
  } catch (error) {
    await pool.query('ROLLBACK');
    logger.error({ error }, 'Failed to add CASCADE constraints');
    throw error;
  }
}

export async function removeCascadeConstraints(pool: Pool): Promise<void> {
  logger.info('Removing CASCADE constraints (rollback)...');

  const tables = [
    'element_visibility',
    'visibility_policies',
    'visibility_change_events',
    'board_comments',
    'board_snapshots',
    'snapshot_records',
    'yjs_updates',
    'edit_audit_log',
    'access_requests',
  ];

  try {
    await pool.query('BEGIN');

    // Restore constraints without CASCADE
    for (const table of tables) {
      await pool.query(`
        ALTER TABLE ${table}
        DROP CONSTRAINT IF EXISTS ${table}_board_fkey;

        ALTER TABLE ${table}
        ADD CONSTRAINT ${table}_board_fkey
        FOREIGN KEY (board_id)
        REFERENCES boards(id);
      `);
    }

    await pool.query('COMMIT');
    logger.info('✅ CASCADE constraints removed');
  } catch (error) {
    await pool.query('ROLLBACK');
    logger.error({ error }, 'Failed to remove CASCADE constraints');
    throw error;
  }
}

/**
 * Benefits of CASCADE constraints:
 *
 * 1. Data Integrity: Prevents orphaned records
 * 2. Storage Efficiency: Automatic cleanup reduces bloat
 * 3. Performance: Bulk deletion faster than application-level cleanup
 * 4. Consistency: Guarantees all related data is cleaned up
 * 5. Reduced Complexity: No need for manual cleanup logic
 *
 * Affected Tables (9 total):
 * - element_visibility
 * - visibility_policies
 * - visibility_change_events
 * - board_comments
 * - board_snapshots
 * - snapshot_records
 * - yjs_updates
 * - edit_audit_log
 * - access_requests
 */
