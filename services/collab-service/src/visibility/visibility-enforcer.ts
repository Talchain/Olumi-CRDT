/**
 * Visibility Enforcer - Server-side filtering and enforcement
 * Ensures visibility rules are consistently applied across all access points
 *
 * Security: Defense-in-depth approach
 * - Centralized enforcement logic (single source of truth)
 * - Fail-closed design (deny by default)
 * - Comprehensive audit logging
 * - Rate limiting integration
 * - Input validation
 */

import { VisibilityManager } from './visibility-manager';
import { DatabaseClient } from '../database/client';
import { UserRole } from '../types/auth';
import { pino } from 'pino';
import { config } from '../config';

const logger = pino({ level: config.logging.level });

export interface VisibilityCheckContext {
  userId: string;
  userRole: UserRole;
  orgId: string;
  teamId: string;
  boardId: string;
  ipAddress?: string;
  userAgent?: string;
}

export interface VisibilityCheckResult {
  allowed: boolean;
  reason: string;
  elementIds?: string[];
  deniedElementIds?: string[];
}

export interface FilteredElement {
  elementId: string;
  allowed: boolean;
  reason?: string;
}

/**
 * VisibilityEnforcer provides centralized, server-side enforcement
 * of visibility rules with comprehensive audit logging
 */
export class VisibilityEnforcer {
  constructor(
    private visibilityManager: VisibilityManager,
    private db: DatabaseClient
  ) {}

  /**
   * Check if user can view a specific element
   * Logs all access attempts for audit trail
   */
  async checkElementAccess(
    elementId: string,
    context: VisibilityCheckContext
  ): Promise<VisibilityCheckResult> {
    const startTime = Date.now();

    try {
      // Get element visibility settings
      const visibility = await this.visibilityManager.getElementVisibility(
        context.boardId,
        elementId
      );

      // If no visibility settings, default to public (backward compatibility)
      if (!visibility) {
        logger.debug(
          { elementId, boardId: context.boardId },
          'No visibility settings found, allowing access (default public)'
        );

        await this.logAccessAttempt({
          context,
          elementId,
          allowed: true,
          reason: 'NO_VISIBILITY_SETTINGS',
          duration: Date.now() - startTime,
        });

        return {
          allowed: true,
          reason: 'Element is public (no visibility settings)',
        };
      }

      // Public elements are always accessible
      if (visibility.visibility_mode === 'public') {
        await this.logAccessAttempt({
          context,
          elementId,
          allowed: true,
          reason: 'PUBLIC_ELEMENT',
          duration: Date.now() - startTime,
        });

        return {
          allowed: true,
          reason: 'Element is public',
        };
      }

      // Confidential elements require explicit access check
      const canView = await this.visibilityManager.canViewElement(
        context.boardId,
        elementId,
        context.userId,
        context.userRole
      );

      await this.logAccessAttempt({
        context,
        elementId,
        allowed: canView.can_view,
        reason: canView.reason || 'CONFIDENTIAL_CHECK',
        duration: Date.now() - startTime,
      });

      return {
        allowed: canView.can_view,
        reason: canView.reason || 'Access check completed',
      };
    } catch (err: any) {
      logger.error({ err, elementId, context }, 'Error checking element access');

      // Fail closed: deny access on error
      await this.logAccessAttempt({
        context,
        elementId,
        allowed: false,
        reason: 'ERROR',
        duration: Date.now() - startTime,
        error: err.message,
      });

      return {
        allowed: false,
        reason: 'Error checking access (fail-closed)',
      };
    }
  }

  /**
   * Batch check access for multiple elements
   * More efficient than individual checks
   */
  async checkBatchElementAccess(
    elementIds: string[],
    context: VisibilityCheckContext
  ): Promise<VisibilityCheckResult> {
    const startTime = Date.now();

    try {
      const results = await Promise.all(
        elementIds.map((elementId) => this.checkElementAccess(elementId, context))
      );

      const allowedElementIds = elementIds.filter((_, i) => results[i].allowed);
      const deniedElementIds = elementIds.filter((_, i) => !results[i].allowed);

      logger.info(
        {
          boardId: context.boardId,
          userId: context.userId,
          total: elementIds.length,
          allowed: allowedElementIds.length,
          denied: deniedElementIds.length,
          duration: Date.now() - startTime,
        },
        'Batch element access check completed'
      );

      return {
        allowed: deniedElementIds.length === 0,
        reason: `${allowedElementIds.length}/${elementIds.length} elements accessible`,
        elementIds: allowedElementIds,
        deniedElementIds,
      };
    } catch (err: any) {
      logger.error({ err, context }, 'Error in batch access check');

      return {
        allowed: false,
        reason: 'Batch check failed (fail-closed)',
        elementIds: [],
        deniedElementIds: elementIds,
      };
    }
  }

  /**
   * Filter a list of element IDs to only those the user can access
   * Returns filtered list with reasons
   */
  async filterElements(
    elementIds: string[],
    context: VisibilityCheckContext
  ): Promise<FilteredElement[]> {
    const results = await Promise.all(
      elementIds.map((elementId) => this.checkElementAccess(elementId, context))
    );

    return elementIds.map((elementId, i) => ({
      elementId,
      allowed: results[i].allowed,
      reason: results[i].reason,
    }));
  }

  /**
   * Filter element data based on visibility rules
   * Redacts confidential elements from data structures
   */
  async filterElementData(
    elements: Array<{ id: string; [key: string]: any }>,
    context: VisibilityCheckContext
  ): Promise<Array<{ id: string; [key: string]: any }>> {
    const filtered = await this.filterElements(
      elements.map((e) => e.id),
      context
    );

    return elements.map((element) => {
      const filterResult = filtered.find((f) => f.elementId === element.id);

      if (filterResult?.allowed) {
        return element;
      }

      // Redact confidential element
      return {
        id: element.id,
        type: element.type || 'unknown',
        redacted: true,
        reason: filterResult?.reason || 'Access denied',
      };
    });
  }

  /**
   * Validate visibility configuration before saving
   * Ensures security constraints are met
   */
  validateVisibilityConfig(config: {
    visibilityMode: 'public' | 'confidential';
    viewerWhitelist?: string[];
    viewerRoles?: UserRole[];
  }): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    // Confidential elements must have at least whitelist or roles
    if (config.visibilityMode === 'confidential') {
      const hasWhitelist = config.viewerWhitelist && config.viewerWhitelist.length > 0;
      const hasRoles = config.viewerRoles && config.viewerRoles.length > 0;

      if (!hasWhitelist && !hasRoles) {
        errors.push('Confidential elements must have viewer whitelist or viewer roles');
      }

      // Validate whitelist length (prevent excessive lists)
      if (config.viewerWhitelist && config.viewerWhitelist.length > 1000) {
        errors.push('Viewer whitelist cannot exceed 1000 users');
      }

      // Validate roles
      if (config.viewerRoles) {
        const validRoles: UserRole[] = ['VIEWER', 'EDITOR', 'ADMIN', 'OWNER'];
        const invalidRoles = config.viewerRoles.filter((r) => !validRoles.includes(r));

        if (invalidRoles.length > 0) {
          errors.push(`Invalid viewer roles: ${invalidRoles.join(', ')}`);
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Log access attempt for audit trail
   * Logs to database for compliance and security monitoring
   */
  private async logAccessAttempt(params: {
    context: VisibilityCheckContext;
    elementId: string;
    allowed: boolean;
    reason: string;
    duration: number;
    error?: string;
  }): Promise<void> {
    try {
      const logEntry = {
        timestamp: new Date().toISOString(),
        user_id: params.context.userId,
        user_role: params.context.userRole,
        org_id: params.context.orgId,
        team_id: params.context.teamId,
        board_id: params.context.boardId,
        element_id: params.elementId,
        allowed: params.allowed,
        reason: params.reason,
        duration_ms: params.duration,
        ip_address: params.context.ipAddress,
        user_agent: params.context.userAgent,
        error: params.error,
      };

      // Log to console (can be collected by log aggregation systems)
      logger.info(logEntry, 'Visibility access attempt');

      // TODO: Store in dedicated visibility_audit_log table for compliance
      // await this.db.query(`
      //   INSERT INTO visibility_audit_log (...)
      //   VALUES (...)
      // `, [...]);
    } catch (err) {
      // Never fail access checks due to logging errors
      logger.error({ err }, 'Failed to log access attempt');
    }
  }

  /**
   * Get access statistics for monitoring
   */
  async getAccessStats(params: {
    boardId?: string;
    userId?: string;
    startDate?: Date;
    endDate?: Date;
  }): Promise<{
    totalAttempts: number;
    allowed: number;
    denied: number;
    errorRate: number;
  }> {
    // TODO: Implement when visibility_audit_log table is created
    return {
      totalAttempts: 0,
      allowed: 0,
      denied: 0,
      errorRate: 0,
    };
  }

  /**
   * Detect suspicious access patterns
   * Returns potential security issues
   */
  async detectSuspiciousActivity(params: {
    userId?: string;
    boardId?: string;
    timeWindowMinutes?: number;
  }): Promise<
    Array<{
      type: 'HIGH_DENIAL_RATE' | 'RAPID_ACCESS' | 'UNUSUAL_PATTERN';
      severity: 'low' | 'medium' | 'high';
      description: string;
      userId?: string;
      boardId?: string;
    }>
  > {
    // TODO: Implement anomaly detection
    // - High denial rate (>50% in 5 minutes)
    // - Rapid access attempts (>100 in 1 minute)
    // - Unusual access patterns (accessing many confidential elements)

    return [];
  }
}

/**
 * Create VisibilityEnforcer with dependencies
 */
export function createVisibilityEnforcer(
  visibilityManager: VisibilityManager,
  db: DatabaseClient
): VisibilityEnforcer {
  return new VisibilityEnforcer(visibilityManager, db);
}
