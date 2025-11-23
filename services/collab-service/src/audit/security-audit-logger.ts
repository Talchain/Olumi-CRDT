/**
 * Security Audit Logger - Append-only logging for security events
 * Tracks all security-critical operations for compliance and forensics
 *
 * Features:
 * - Append-only (immutable audit trail)
 * - Tamper-evident (checksums/hashing)
 * - Comprehensive event types
 * - Structured logging format
 * - Compliance-ready (SOC2, GDPR, HIPAA)
 */

import { Pool } from 'pg';
import { pino } from 'pino';
import { config } from '../config';
import { createHash } from 'crypto';

const logger = pino({ level: config.logging.level });

export type SecurityEventType =
  // Authentication events
  | 'AUTH_LOGIN_SUCCESS'
  | 'AUTH_LOGIN_FAILURE'
  | 'AUTH_LOGOUT'
  | 'AUTH_TOKEN_REFRESH'
  | 'AUTH_TOKEN_EXPIRED'
  // Authorization events
  | 'AUTHZ_ACCESS_GRANTED'
  | 'AUTHZ_ACCESS_DENIED'
  | 'AUTHZ_PRIVILEGE_ESCALATION_ATTEMPT'
  // Visibility events
  | 'VISIBILITY_ELEMENT_VIEWED'
  | 'VISIBILITY_ELEMENT_REDACTED'
  | 'VISIBILITY_CONFIG_CHANGED'
  | 'VISIBILITY_WHITELIST_MODIFIED'
  // Access request events
  | 'ACCESS_REQUEST_CREATED'
  | 'ACCESS_REQUEST_APPROVED'
  | 'ACCESS_REQUEST_DENIED'
  | 'ACCESS_REQUEST_EXPIRED'
  | 'ACCESS_REQUEST_REVOKED'
  // Data modification events
  | 'DATA_CREATED'
  | 'DATA_MODIFIED'
  | 'DATA_DELETED'
  | 'DATA_EXPORTED'
  // Administrative events
  | 'ADMIN_USER_ROLE_CHANGED'
  | 'ADMIN_PERMISSION_CHANGED'
  | 'ADMIN_CONFIG_CHANGED'
  // Security events
  | 'SECURITY_RATE_LIMIT_EXCEEDED'
  | 'SECURITY_SUSPICIOUS_ACTIVITY'
  | 'SECURITY_INTRUSION_ATTEMPT'
  | 'SECURITY_DATA_BREACH_DETECTED'
  | 'UNAUTHORIZED_ACCESS_BLOCKED'
  | 'UNAUTHORIZED_REST_ACCESS'
  | 'UNAUTHORIZED_OWNER_ACCESS'
  | 'RATE_LIMIT_EXCEEDED';

export type SecurityEventSeverity = 'info' | 'warning' | 'critical';

export interface SecurityEvent {
  event_id: string;
  timestamp: string;
  event_type: SecurityEventType;
  severity: SecurityEventSeverity;

  // Actor (who performed the action)
  user_id?: string;
  user_email?: string;
  user_role?: string;
  ip_address?: string;
  user_agent?: string;

  // Target (what was affected)
  org_id?: string;
  team_id?: string;
  board_id?: string;
  element_id?: string;
  resource_id?: string;
  resource_type?: string;

  // Event details
  action: string;
  description: string;
  outcome: 'success' | 'failure' | 'denied';
  error_message?: string;

  // Context
  request_id?: string;
  session_id?: string;
  metadata?: Record<string, any>;

  // Tamper detection
  checksum?: string;
  previous_event_checksum?: string;
}

export interface AuditLogQuery {
  startDate?: Date;
  endDate?: Date;
  userId?: string;
  boardId?: string;
  eventType?: SecurityEventType;
  severity?: SecurityEventSeverity;
  limit?: number;
  offset?: number;
}

/**
 * SecurityAuditLogger provides append-only audit logging
 * for all security-critical operations
 */
export class SecurityAuditLogger {
  private lastEventChecksum: string | null = null;

  constructor(private pool: Pool) {}

  /**
   * Initialize security_audit_log table
   */
  async initialize(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS security_audit_log (
        event_id TEXT PRIMARY KEY,
        timestamp TIMESTAMPTZ NOT NULL,
        event_type TEXT NOT NULL,
        severity TEXT NOT NULL CHECK (severity IN ('info', 'warning', 'critical')),

        -- Actor
        user_id TEXT,
        user_email TEXT,
        user_role TEXT,
        ip_address TEXT,
        user_agent TEXT,

        -- Target
        org_id TEXT,
        team_id TEXT,
        board_id TEXT,
        element_id TEXT,
        resource_id TEXT,
        resource_type TEXT,

        -- Event details
        action TEXT NOT NULL,
        description TEXT NOT NULL,
        outcome TEXT NOT NULL CHECK (outcome IN ('success', 'failure', 'denied')),
        error_message TEXT,

        -- Context
        request_id TEXT,
        session_id TEXT,
        metadata JSONB,

        -- Tamper detection
        checksum TEXT NOT NULL,
        previous_event_checksum TEXT,

        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      -- Indexes for efficient querying
      CREATE INDEX IF NOT EXISTS idx_security_audit_log_timestamp
        ON security_audit_log(timestamp DESC);

      CREATE INDEX IF NOT EXISTS idx_security_audit_log_user
        ON security_audit_log(user_id, timestamp DESC);

      CREATE INDEX IF NOT EXISTS idx_security_audit_log_board
        ON security_audit_log(board_id, timestamp DESC);

      CREATE INDEX IF NOT EXISTS idx_security_audit_log_event_type
        ON security_audit_log(event_type, timestamp DESC);

      CREATE INDEX IF NOT EXISTS idx_security_audit_log_severity
        ON security_audit_log(severity, timestamp DESC)
        WHERE severity IN ('warning', 'critical');

      -- Prevent updates and deletes (append-only)
      CREATE OR REPLACE FUNCTION prevent_audit_log_modification()
      RETURNS TRIGGER AS $$
      BEGIN
        RAISE EXCEPTION 'Audit log is append-only. Modifications are not allowed.';
      END;
      $$ LANGUAGE plpgsql;

      DROP TRIGGER IF EXISTS prevent_audit_log_update ON security_audit_log;
      CREATE TRIGGER prevent_audit_log_update
        BEFORE UPDATE ON security_audit_log
        FOR EACH ROW
        EXECUTE FUNCTION prevent_audit_log_modification();

      DROP TRIGGER IF EXISTS prevent_audit_log_delete ON security_audit_log;
      CREATE TRIGGER prevent_audit_log_delete
        BEFORE DELETE ON security_audit_log
        FOR EACH ROW
        EXECUTE FUNCTION prevent_audit_log_modification();
    `);

    logger.info('Security audit log initialized (append-only)');
  }

  /**
   * Log a security event
   */
  async logEvent(event: Omit<SecurityEvent, 'event_id' | 'timestamp' | 'checksum' | 'previous_event_checksum'>): Promise<void> {
    try {
      const eventId = this.generateEventId();
      const timestamp = new Date().toISOString();

      // Calculate checksum for tamper detection
      const eventData = {
        event_id: eventId,
        timestamp,
        ...event,
        previous_event_checksum: this.lastEventChecksum || undefined,
      };

      const checksum = this.calculateChecksum(eventData);
      this.lastEventChecksum = checksum;

      const fullEvent: SecurityEvent = {
        ...eventData,
        checksum,
      };

      await this.pool.query(
        `INSERT INTO security_audit_log (
          event_id, timestamp, event_type, severity,
          user_id, user_email, user_role, ip_address, user_agent,
          org_id, team_id, board_id, element_id, resource_id, resource_type,
          action, description, outcome, error_message,
          request_id, session_id, metadata,
          checksum, previous_event_checksum
        ) VALUES (
          $1, $2, $3, $4,
          $5, $6, $7, $8, $9,
          $10, $11, $12, $13, $14, $15,
          $16, $17, $18, $19,
          $20, $21, $22,
          $23, $24
        )`,
        [
          fullEvent.event_id,
          fullEvent.timestamp,
          fullEvent.event_type,
          fullEvent.severity,
          fullEvent.user_id || null,
          fullEvent.user_email || null,
          fullEvent.user_role || null,
          fullEvent.ip_address || null,
          fullEvent.user_agent || null,
          fullEvent.org_id || null,
          fullEvent.team_id || null,
          fullEvent.board_id || null,
          fullEvent.element_id || null,
          fullEvent.resource_id || null,
          fullEvent.resource_type || null,
          fullEvent.action,
          fullEvent.description,
          fullEvent.outcome,
          fullEvent.error_message || null,
          fullEvent.request_id || null,
          fullEvent.session_id || null,
          fullEvent.metadata ? JSON.stringify(fullEvent.metadata) : null,
          fullEvent.checksum,
          fullEvent.previous_event_checksum || null,
        ]
      );

      logger.info(
        {
          eventId,
          eventType: event.event_type,
          severity: event.severity,
          userId: event.user_id,
          outcome: event.outcome,
        },
        'Security event logged'
      );
    } catch (err) {
      logger.error({ err, event }, 'Failed to log security event');
      // Critical: Logging failure should be escalated
      throw new Error('Security audit logging failed');
    }
  }

  /**
   * Query audit log
   */
  async queryEvents(query: AuditLogQuery): Promise<SecurityEvent[]> {
    const conditions: string[] = [];
    const params: any[] = [];
    let paramIndex = 1;

    if (query.startDate) {
      conditions.push(`timestamp >= $${paramIndex++}`);
      params.push(query.startDate.toISOString());
    }

    if (query.endDate) {
      conditions.push(`timestamp <= $${paramIndex++}`);
      params.push(query.endDate.toISOString());
    }

    if (query.userId) {
      conditions.push(`user_id = $${paramIndex++}`);
      params.push(query.userId);
    }

    if (query.boardId) {
      conditions.push(`board_id = $${paramIndex++}`);
      params.push(query.boardId);
    }

    if (query.eventType) {
      conditions.push(`event_type = $${paramIndex++}`);
      params.push(query.eventType);
    }

    if (query.severity) {
      conditions.push(`severity = $${paramIndex++}`);
      params.push(query.severity);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = query.limit || 100;
    const offset = query.offset || 0;

    const result = await this.pool.query(
      `SELECT * FROM security_audit_log
       ${whereClause}
       ORDER BY timestamp DESC
       LIMIT $${paramIndex++} OFFSET $${paramIndex++}`,
      [...params, limit, offset]
    );

    return result.rows.map(this.mapSecurityEvent);
  }

  /**
   * Verify audit log integrity
   * Checks checksums to detect tampering
   */
  async verifyIntegrity(): Promise<{
    valid: boolean;
    totalEvents: number;
    tamperedEvents: number;
    errors: string[];
  }> {
    const result = await this.pool.query(
      'SELECT * FROM security_audit_log ORDER BY timestamp ASC'
    );

    const events = result.rows.map(this.mapSecurityEvent);
    let tamperedCount = 0;
    const errors: string[] = [];
    let previousChecksum: string | null = null;

    for (const event of events) {
      // Verify checksum matches
      const calculatedChecksum = this.calculateChecksum({
        ...event,
        previous_event_checksum: previousChecksum,
      });

      if (calculatedChecksum !== event.checksum) {
        tamperedCount++;
        errors.push(`Event ${event.event_id} has invalid checksum`);
      }

      // Verify chain
      if (event.previous_event_checksum !== previousChecksum) {
        tamperedCount++;
        errors.push(`Event ${event.event_id} has broken chain`);
      }

      previousChecksum = event.checksum || null;
    }

    return {
      valid: tamperedCount === 0,
      totalEvents: events.length,
      tamperedEvents: tamperedCount,
      errors,
    };
  }

  /**
   * Get audit log statistics
   */
  async getStats(query: {
    startDate?: Date;
    endDate?: Date;
  }): Promise<{
    totalEvents: number;
    eventsByType: Record<string, number>;
    eventsBySeverity: Record<string, number>;
    topUsers: Array<{ userId: string; count: number }>;
  }> {
    const conditions: string[] = [];
    const params: any[] = [];
    let paramIndex = 1;

    if (query.startDate) {
      conditions.push(`timestamp >= $${paramIndex++}`);
      params.push(query.startDate.toISOString());
    }

    if (query.endDate) {
      conditions.push(`timestamp <= $${paramIndex++}`);
      params.push(query.endDate.toISOString());
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // Total events
    const totalResult = await this.pool.query(
      `SELECT COUNT(*) as count FROM security_audit_log ${whereClause}`,
      params
    );
    const totalEvents = parseInt(totalResult.rows[0].count, 10);

    // Events by type
    const typeResult = await this.pool.query(
      `SELECT event_type, COUNT(*) as count
       FROM security_audit_log ${whereClause}
       GROUP BY event_type
       ORDER BY count DESC`,
      params
    );
    const eventsByType: Record<string, number> = {};
    for (const row of typeResult.rows) {
      eventsByType[row.event_type] = parseInt(row.count, 10);
    }

    // Events by severity
    const severityResult = await this.pool.query(
      `SELECT severity, COUNT(*) as count
       FROM security_audit_log ${whereClause}
       GROUP BY severity
       ORDER BY count DESC`,
      params
    );
    const eventsBySeverity: Record<string, number> = {};
    for (const row of severityResult.rows) {
      eventsBySeverity[row.severity] = parseInt(row.count, 10);
    }

    // Top users
    const userResult = await this.pool.query(
      `SELECT user_id, COUNT(*) as count
       FROM security_audit_log ${whereClause}
       AND user_id IS NOT NULL
       GROUP BY user_id
       ORDER BY count DESC
       LIMIT 10`,
      params
    );
    const topUsers = userResult.rows.map((row) => ({
      userId: row.user_id,
      count: parseInt(row.count, 10),
    }));

    return {
      totalEvents,
      eventsByType,
      eventsBySeverity,
      topUsers,
    };
  }

  /**
   * Generate unique event ID
   */
  private generateEventId(): string {
    return `evt_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
  }

  /**
   * Calculate checksum for tamper detection
   */
  private calculateChecksum(data: any): string {
    const payload = JSON.stringify({
      event_id: data.event_id,
      timestamp: data.timestamp,
      event_type: data.event_type,
      user_id: data.user_id,
      action: data.action,
      outcome: data.outcome,
      previous_event_checksum: data.previous_event_checksum,
    });

    return createHash('sha256').update(payload).digest('hex');
  }

  /**
   * Map database row to SecurityEvent
   */
  private mapSecurityEvent(row: any): SecurityEvent {
    return {
      event_id: row.event_id,
      timestamp: row.timestamp,
      event_type: row.event_type,
      severity: row.severity,
      user_id: row.user_id || undefined,
      user_email: row.user_email || undefined,
      user_role: row.user_role || undefined,
      ip_address: row.ip_address || undefined,
      user_agent: row.user_agent || undefined,
      org_id: row.org_id || undefined,
      team_id: row.team_id || undefined,
      board_id: row.board_id || undefined,
      element_id: row.element_id || undefined,
      resource_id: row.resource_id || undefined,
      resource_type: row.resource_type || undefined,
      action: row.action,
      description: row.description,
      outcome: row.outcome,
      error_message: row.error_message || undefined,
      request_id: row.request_id || undefined,
      session_id: row.session_id || undefined,
      metadata: row.metadata || undefined,
      checksum: row.checksum,
      previous_event_checksum: row.previous_event_checksum || undefined,
    };
  }
}
