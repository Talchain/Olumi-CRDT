/**
 * Database operations for access requests
 */

import { Pool, QueryResult } from 'pg';
import { pino } from 'pino';
import { v4 as uuidv4 } from 'uuid';
import {
  AccessRequest,
  AccessRequestStatus,
  CreateAccessRequestParams,
  ApproveAccessRequestParams,
  DenyAccessRequestParams,
  AccessRequestWithRequester,
} from '../types/access-requests';

const logger = pino();

export class AccessRequestsDatabase {
  constructor(private pool: Pool) {}

  /**
   * Initialize access_requests table
   */
  async initialize(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS access_requests (
        request_id TEXT PRIMARY KEY,
        board_id TEXT NOT NULL,
        element_id TEXT NOT NULL,

        requester_user_id TEXT NOT NULL,
        requested_at TIMESTAMPTZ NOT NULL,
        rationale TEXT,

        status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'denied', 'expired')),

        approved_by_user_id TEXT,
        approved_at TIMESTAMPTZ,
        expires_at TIMESTAMPTZ,

        denied_by_user_id TEXT,
        denied_at TIMESTAMPTZ,
        denial_reason TEXT,

        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

        CONSTRAINT fk_board FOREIGN KEY (board_id) REFERENCES boards(id) ON DELETE CASCADE,
        CONSTRAINT unique_pending_request UNIQUE (board_id, element_id, requester_user_id, status)
      );

      CREATE INDEX IF NOT EXISTS idx_access_requests_board ON access_requests(board_id);
      CREATE INDEX IF NOT EXISTS idx_access_requests_requester ON access_requests(requester_user_id);
      CREATE INDEX IF NOT EXISTS idx_access_requests_status ON access_requests(status);
      CREATE INDEX IF NOT EXISTS idx_access_requests_expires ON access_requests(expires_at) WHERE status = 'approved';
      CREATE INDEX IF NOT EXISTS idx_access_requests_element ON access_requests(element_id);
    `);

    logger.info('Access requests table initialized');
  }

  /**
   * Create a new access request
   */
  async createAccessRequest(params: CreateAccessRequestParams): Promise<AccessRequest> {
    const request_id = uuidv4();
    const requested_at = new Date().toISOString();

    const result = await this.pool.query<AccessRequest>(
      `INSERT INTO access_requests (
        request_id, board_id, element_id,
        requester_user_id, requested_at, rationale,
        status, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
      ON CONFLICT (board_id, element_id, requester_user_id, status)
      WHERE status = 'pending'
      DO UPDATE SET
        requested_at = EXCLUDED.requested_at,
        rationale = EXCLUDED.rationale,
        updated_at = NOW()
      RETURNING *`,
      [
        request_id,
        params.board_id,
        params.element_id,
        params.requester_user_id,
        requested_at,
        params.rationale || null,
        'pending' as AccessRequestStatus,
      ]
    );

    return this.mapAccessRequest(result.rows[0]);
  }

  /**
   * Get access request by ID
   */
  async getAccessRequest(request_id: string): Promise<AccessRequest | null> {
    const result = await this.pool.query<AccessRequest>(
      'SELECT * FROM access_requests WHERE request_id = $1',
      [request_id]
    );

    return result.rows[0] ? this.mapAccessRequest(result.rows[0]) : null;
  }

  /**
   * Get pending access requests for a board (owner view)
   */
  async getPendingRequestsForBoard(board_id: string): Promise<AccessRequestWithRequester[]> {
    const result = await this.pool.query(
      `SELECT
        ar.*,
        u.name as requester_name,
        u.email as requester_email
      FROM access_requests ar
      LEFT JOIN users u ON ar.requester_user_id = u.id
      WHERE ar.board_id = $1 AND ar.status = 'pending'
      ORDER BY ar.requested_at DESC`,
      [board_id]
    );

    return result.rows.map((row) => ({
      ...this.mapAccessRequest(row),
      requester_name: row.requester_name || 'Unknown',
      requester_email: row.requester_email || '',
    }));
  }

  /**
   * Get user's own access requests across all boards
   */
  async getUserAccessRequests(user_id: string): Promise<AccessRequest[]> {
    const result = await this.pool.query<AccessRequest>(
      `SELECT * FROM access_requests
       WHERE requester_user_id = $1
       ORDER BY requested_at DESC
       LIMIT 100`,
      [user_id]
    );

    return result.rows.map(this.mapAccessRequest);
  }

  /**
   * Approve an access request
   */
  async approveAccessRequest(params: ApproveAccessRequestParams): Promise<AccessRequest> {
    const expires_in_days = Math.min(params.expires_in_days || 7, 90);
    const approved_at = new Date();
    const expires_at = new Date(approved_at);
    expires_at.setDate(expires_at.getDate() + expires_in_days);

    const result = await this.pool.query<AccessRequest>(
      `UPDATE access_requests SET
        status = 'approved',
        approved_by_user_id = $1,
        approved_at = $2,
        expires_at = $3,
        updated_at = NOW()
      WHERE request_id = $4 AND status = 'pending'
      RETURNING *`,
      [params.approved_by_user_id, approved_at.toISOString(), expires_at.toISOString(), params.request_id]
    );

    if (result.rows.length === 0) {
      throw new Error('Request not found or already processed');
    }

    return this.mapAccessRequest(result.rows[0]);
  }

  /**
   * Deny an access request
   */
  async denyAccessRequest(params: DenyAccessRequestParams): Promise<AccessRequest> {
    const denied_at = new Date().toISOString();

    const result = await this.pool.query<AccessRequest>(
      `UPDATE access_requests SET
        status = 'denied',
        denied_by_user_id = $1,
        denied_at = $2,
        denial_reason = $3,
        updated_at = NOW()
      WHERE request_id = $4 AND status = 'pending'
      RETURNING *`,
      [params.denied_by_user_id, denied_at, params.denial_reason || null, params.request_id]
    );

    if (result.rows.length === 0) {
      throw new Error('Request not found or already processed');
    }

    return this.mapAccessRequest(result.rows[0]);
  }

  /**
   * Find expired access requests
   */
  async findExpiredRequests(): Promise<AccessRequest[]> {
    const result = await this.pool.query<AccessRequest>(
      `SELECT * FROM access_requests
       WHERE status = 'approved'
       AND expires_at < NOW()`,
      []
    );

    return result.rows.map(this.mapAccessRequest);
  }

  /**
   * Mark request as expired
   */
  async markAsExpired(request_id: string): Promise<void> {
    await this.pool.query(
      `UPDATE access_requests SET
        status = 'expired',
        updated_at = NOW()
      WHERE request_id = $1`,
      [request_id]
    );
  }

  /**
   * Check if user has pending request for element
   */
  async hasPendingRequest(
    board_id: string,
    element_id: string,
    user_id: string
  ): Promise<boolean> {
    const result = await this.pool.query(
      `SELECT 1 FROM access_requests
       WHERE board_id = $1
       AND element_id = $2
       AND requester_user_id = $3
       AND status = 'pending'
       LIMIT 1`,
      [board_id, element_id, user_id]
    );

    return result.rows.length > 0;
  }

  /**
   * Count requests by user in time period (for rate limiting)
   */
  async countRecentRequests(
    user_id: string,
    board_id: string,
    hours: number = 24
  ): Promise<number> {
    const result = await this.pool.query(
      `SELECT COUNT(*) as count
       FROM access_requests
       WHERE requester_user_id = $1
       AND board_id = $2
       AND requested_at > NOW() - INTERVAL '${hours} hours'`,
      [user_id, board_id]
    );

    return parseInt(result.rows[0].count, 10);
  }

  /**
   * Map database row to AccessRequest object
   */
  private mapAccessRequest(row: any): AccessRequest {
    return {
      request_id: row.request_id,
      board_id: row.board_id,
      element_id: row.element_id,
      requester_user_id: row.requester_user_id,
      requested_at: row.requested_at,
      rationale: row.rationale || undefined,
      status: row.status,
      approved_by_user_id: row.approved_by_user_id || undefined,
      approved_at: row.approved_at || undefined,
      expires_at: row.expires_at || undefined,
      denied_by_user_id: row.denied_by_user_id || undefined,
      denied_at: row.denied_at || undefined,
      denial_reason: row.denial_reason || undefined,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }
}
