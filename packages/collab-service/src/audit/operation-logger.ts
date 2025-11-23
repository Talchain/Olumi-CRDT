/**
 * Operation logger for audit provenance
 *
 * Identifies and logs critical operations for compliance and decision review.
 */

import * as Y from 'yjs';
import { DatabaseClient } from '../database/client';
import { pino } from 'pino';
import { config } from '../config';

const logger = pino({ level: config.logging.level });

/**
 * Critical operation types that should be logged for audit
 */
export enum CriticalOperationType {
  // Entity creation
  GOAL_CREATE = 'goal_create',
  OPTION_CREATE = 'option_create',
  OUTCOME_CREATE = 'outcome_create',
  ASSUMPTION_CREATE = 'assumption_create',
  EVIDENCE_CREATE = 'evidence_create',
  EDGE_CREATE = 'edge_create',

  // Entity deletion
  GOAL_DELETE = 'goal_delete',
  OPTION_DELETE = 'option_delete',
  OUTCOME_DELETE = 'outcome_delete',
  ASSUMPTION_DELETE = 'assumption_delete',
  EVIDENCE_DELETE = 'evidence_delete',
  EDGE_DELETE = 'edge_delete',

  // Critical field updates
  PROBABILITY_UPDATE = 'probability_update',
  IMPACT_UPDATE = 'impact_update',
  CONFIDENCE_UPDATE = 'confidence_update',
  WEIGHT_UPDATE = 'weight_update',

  // Content updates (track for major entities)
  GOAL_CONTENT_UPDATE = 'goal_content_update',
  OPTION_CONTENT_UPDATE = 'option_content_update',
  OUTCOME_CONTENT_UPDATE = 'outcome_content_update',
}

/**
 * Identified critical operation
 */
export interface CriticalOperation {
  type: CriticalOperationType;
  entityType: string;
  entityId: string;
  oldValue?: any;
  newValue?: any;
}

/**
 * Extract critical operations from Yjs document changes
 */
export function extractCriticalOperations(ydoc: Y.Doc, transaction: Y.Transaction): CriticalOperation[] {
  const operations: CriticalOperation[] = [];

  // Check goals map
  const goals = ydoc.getMap('goals');
  if (transaction.changed.has(goals)) {
    const changes = transaction.changed.get(goals);
    if (changes) {
      // Iterate through changed keys
      changes.forEach((change, key: string) => {
        const currentValue = goals.get(key);

        if (change.action === 'add') {
          operations.push({
            type: CriticalOperationType.GOAL_CREATE,
            entityType: 'goal',
            entityId: key,
            newValue: currentValue ? { id: key, content: currentValue.content } : undefined,
          });
        } else if (change.action === 'delete') {
          operations.push({
            type: CriticalOperationType.GOAL_DELETE,
            entityType: 'goal',
            entityId: key,
            oldValue: change.oldValue ? { id: key, content: change.oldValue.content } : undefined,
          });
        } else if (change.action === 'update') {
          // Check if deleted flag was set
          const oldVal = change.oldValue;
          const newVal = currentValue;

          if (newVal && newVal.deleted && (!oldVal || !oldVal.deleted)) {
            operations.push({
              type: CriticalOperationType.GOAL_DELETE,
              entityType: 'goal',
              entityId: key,
              oldValue: oldVal ? { id: key, content: oldVal.content } : undefined,
            });
          } else if (oldVal && newVal && oldVal.content !== newVal.content) {
            // Content changed
            operations.push({
              type: CriticalOperationType.GOAL_CONTENT_UPDATE,
              entityType: 'goal',
              entityId: key,
              oldValue: { content: oldVal.content },
              newValue: { content: newVal.content },
            });
          }
        }
      });
    }
  }

  // Check options map
  const options = ydoc.getMap('options');
  if (transaction.changed.has(options)) {
    const changes = transaction.changed.get(options);
    if (changes) {
      changes.forEach((change, key: string) => {
        const currentValue = options.get(key);

        if (change.action === 'add') {
          operations.push({
            type: CriticalOperationType.OPTION_CREATE,
            entityType: 'option',
            entityId: key,
            newValue: currentValue ? { id: key, content: currentValue.content } : undefined,
          });
        } else if (change.action === 'delete' || (currentValue && currentValue.deleted)) {
          operations.push({
            type: CriticalOperationType.OPTION_DELETE,
            entityType: 'option',
            entityId: key,
            oldValue: change.oldValue ? { id: key, content: change.oldValue.content } : undefined,
          });
        } else if (change.action === 'update') {
          const oldVal = change.oldValue;
          const newVal = currentValue;

          if (oldVal && newVal && oldVal.content !== newVal.content) {
            operations.push({
              type: CriticalOperationType.OPTION_CONTENT_UPDATE,
              entityType: 'option',
              entityId: key,
              oldValue: { content: oldVal.content },
              newValue: { content: newVal.content },
            });
          }
        }
      });
    }
  }

  // Check outcomes map for probability/impact changes
  const outcomes = ydoc.getMap('outcomes');
  if (transaction.changed.has(outcomes)) {
    const changes = transaction.changed.get(outcomes);
    if (changes) {
      changes.forEach((change, key: string) => {
        const currentValue = outcomes.get(key);

        if (change.action === 'add') {
          operations.push({
            type: CriticalOperationType.OUTCOME_CREATE,
            entityType: 'outcome',
            entityId: key,
            newValue: currentValue ? { id: key, content: currentValue.content } : undefined,
          });
        } else if (change.action === 'delete' || (currentValue && currentValue.deleted)) {
          operations.push({
            type: CriticalOperationType.OUTCOME_DELETE,
            entityType: 'outcome',
            entityId: key,
            oldValue: change.oldValue ? { id: key } : undefined,
          });
        } else if (change.action === 'update') {
          const oldVal = change.oldValue;
          const newVal = currentValue;

          // Track probability changes
          if (oldVal && newVal && oldVal.probability !== newVal.probability) {
            operations.push({
              type: CriticalOperationType.PROBABILITY_UPDATE,
              entityType: 'outcome',
              entityId: key,
              oldValue: { probability: oldVal.probability },
              newValue: { probability: newVal.probability },
            });
          }

          // Track impact changes
          if (oldVal && newVal && oldVal.impact !== newVal.impact) {
            operations.push({
              type: CriticalOperationType.IMPACT_UPDATE,
              entityType: 'outcome',
              entityId: key,
              oldValue: { impact: oldVal.impact },
              newValue: { impact: newVal.impact },
            });
          }

          // Track content changes
          if (oldVal && newVal && oldVal.content !== newVal.content) {
            operations.push({
              type: CriticalOperationType.OUTCOME_CONTENT_UPDATE,
              entityType: 'outcome',
              entityId: key,
              oldValue: { content: oldVal.content },
              newValue: { content: newVal.content },
            });
          }
        }
      });
    }
  }

  // Check assumptions map for confidence changes
  const assumptions = ydoc.getMap('assumptions');
  if (transaction.changed.has(assumptions)) {
    const changes = transaction.changed.get(assumptions);
    if (changes) {
      changes.forEach((change, key: string) => {
        const currentValue = assumptions.get(key);

        if (change.action === 'add') {
          operations.push({
            type: CriticalOperationType.ASSUMPTION_CREATE,
            entityType: 'assumption',
            entityId: key,
            newValue: currentValue ? { id: key, content: currentValue.content } : undefined,
          });
        } else if (change.action === 'delete' || (currentValue && currentValue.deleted)) {
          operations.push({
            type: CriticalOperationType.ASSUMPTION_DELETE,
            entityType: 'assumption',
            entityId: key,
            oldValue: change.oldValue ? { id: key } : undefined,
          });
        } else if (change.action === 'update') {
          const oldVal = change.oldValue;
          const newVal = currentValue;

          // Track confidence changes
          if (oldVal && newVal && oldVal.confidence !== newVal.confidence) {
            operations.push({
              type: CriticalOperationType.CONFIDENCE_UPDATE,
              entityType: 'assumption',
              entityId: key,
              oldValue: { confidence: oldVal.confidence },
              newValue: { confidence: newVal.confidence },
            });
          }
        }
      });
    }
  }

  // Check evidence map
  const evidence = ydoc.getMap('evidence');
  if (transaction.changed.has(evidence)) {
    const changes = transaction.changed.get(evidence);
    if (changes) {
      changes.forEach((change, key: string) => {
        const currentValue = evidence.get(key);

        if (change.action === 'add') {
          operations.push({
            type: CriticalOperationType.EVIDENCE_CREATE,
            entityType: 'evidence',
            entityId: key,
            newValue: currentValue ? { id: key, content: currentValue.content } : undefined,
          });
        } else if (change.action === 'delete' || (currentValue && currentValue.deleted)) {
          operations.push({
            type: CriticalOperationType.EVIDENCE_DELETE,
            entityType: 'evidence',
            entityId: key,
            oldValue: change.oldValue ? { id: key } : undefined,
          });
        }
      });
    }
  }

  // Check edges array
  const edges = ydoc.getArray('edges');
  if (transaction.changed.has(edges)) {
    // For arrays, we need to check the delta
    const delta = transaction.changed.get(edges);
    if (delta) {
      // Array changes are more complex - for now, just log that edges changed
      // TODO: Implement granular edge tracking if needed
      logger.debug({ boardId: 'unknown' }, 'Edge array changed (not yet granularly tracked)');
    }
  }

  return operations;
}

/**
 * Operation logger that persists critical operations to audit log
 */
export class OperationLogger {
  constructor(private db: DatabaseClient) {}

  /**
   * Log critical operations from a transaction
   */
  async logOperations(
    boardId: string,
    orgId: string,
    teamId: string,
    userId: string,
    operations: CriticalOperation[],
    snapshotId?: string
  ): Promise<void> {
    try {
      // Log each critical operation
      for (const op of operations) {
        await this.db.logEdit(
          boardId,
          orgId,
          teamId,
          userId,
          op.type,
          op.entityType,
          op.entityId,
          op.oldValue,
          op.newValue,
          snapshotId
        );

        logger.debug(
          {
            boardId,
            userId,
            operation: op.type,
            entityType: op.entityType,
            entityId: op.entityId,
          },
          'Critical operation logged'
        );
      }
    } catch (err) {
      logger.error({ err, boardId, userId }, 'Failed to log critical operations');
      // Don't throw - audit logging failure shouldn't break collaboration
    }
  }

  /**
   * Get operation statistics for provenance
   */
  async getOperationStats(
    boardId: string,
    since?: Date
  ): Promise<{
    totalOperations: number;
    uniqueEditors: number;
    operationsByType: Record<string, number>;
  }> {
    try {
      const logs = await this.db.getAuditLog(boardId, undefined, 1000);

      const filtered = since
        ? logs.filter((log) => new Date(log.created_at) >= since)
        : logs;

      const uniqueEditors = new Set(filtered.map((log) => log.user_id)).size;

      const operationsByType: Record<string, number> = {};
      for (const log of filtered) {
        operationsByType[log.operation_type] = (operationsByType[log.operation_type] || 0) + 1;
      }

      return {
        totalOperations: filtered.length,
        uniqueEditors,
        operationsByType,
      };
    } catch (err) {
      logger.error({ err, boardId }, 'Failed to get operation stats');
      return {
        totalOperations: 0,
        uniqueEditors: 0,
        operationsByType: {},
      };
    }
  }
}
