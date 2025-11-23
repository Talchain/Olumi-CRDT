/**
 * Database client for PostgreSQL
 */

import { Pool, PoolClient, QueryResult } from 'pg';
import { config } from '../config';
import { BoardDocument, BoardSnapshot } from '../types/board';
import { pino } from 'pino';

const logger = pino({ level: config.logging.level });

export class DatabaseClient {
  private pool: Pool;

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
  }

  async query<T = any>(text: string, params?: any[]): Promise<QueryResult<T>> {
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
        owner_id UUID NOT NULL,
        data JSONB NOT NULL,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);

    await this.query(`
      CREATE INDEX IF NOT EXISTS idx_boards_org_id ON boards(org_id);
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

    logger.info('Database schema initialized');
  }

  /**
   * Get board metadata
   */
  async getBoard(boardId: string): Promise<{ orgId: string; ownerId: string; data: BoardDocument } | null> {
    const result = await this.query<{ org_id: string; owner_id: string; data: BoardDocument }>(
      'SELECT org_id, owner_id, data FROM boards WHERE id = $1',
      [boardId]
    );

    if (result.rows.length === 0) {
      return null;
    }

    return {
      orgId: result.rows[0].org_id,
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
    const result = await this.query(
      `DELETE FROM yjs_updates
       WHERE created_at < NOW() - INTERVAL '${daysToKeep} days'`
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
}
