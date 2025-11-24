/**
 * Visibility Propagation Engine
 *
 * Automatically propagates visibility settings to related elements to prevent
 * information leakage through graph structure and derived elements.
 *
 * Part of Phase 4, Section H.3: Visibility Propagation Rules
 */

import { pino } from 'pino';
import { DatabaseClient } from '../database/client';
import { VisibilityManager } from './visibility-manager';
import {
  ElementType,
  VisibilityMode,
  ElementVisibility,
  VisibilityChangeEvent,
} from '../types/visibility';
import { UserRole } from '../types/auth';
import * as Y from 'yjs';

const logger = pino({ name: 'visibility-propagation' });

// Safety limits to prevent propagation storms
const MAX_PROPAGATION_DEPTH = 3;
const MAX_PROPAGATED_ELEMENTS = 500;
const MAX_EDGES_PER_ELEMENT = 1000;

export interface PropagationRule {
  type: 'edge_cascade' | 'derived_element' | 'inference_prevention';
  description: string;
  enabled: boolean;
}

export interface PropagationResult {
  affectedElements: string[];
  propagatedChanges: Array<{
    elementId: string;
    elementType: ElementType;
    oldVisibility: VisibilityMode | null;
    newVisibility: VisibilityMode;
    reason: string;
  }>;
  summary: {
    totalAffected: number;
    byType: Record<ElementType, number>;
  };
}

export class VisibilityPropagationEngine {
  private rules: Map<string, PropagationRule> = new Map();

  constructor(
    private db: DatabaseClient,
    private visibilityManager: VisibilityManager
  ) {
    this.initializeDefaultRules();
  }

  /**
   * Initialize default propagation rules
   */
  private initializeDefaultRules(): void {
    this.rules.set('edge_cascade', {
      type: 'edge_cascade',
      description: 'Cascade confidentiality to connected edges',
      enabled: true,
    });

    this.rules.set('derived_element', {
      type: 'derived_element',
      description: 'Propagate to derived outcomes and assumptions',
      enabled: true,
    });

    this.rules.set('inference_prevention', {
      type: 'inference_prevention',
      description: 'Prevent information leakage through graph structure',
      enabled: true,
    });
  }

  /**
   * Propagate visibility change to related elements
   */
  async propagateVisibilityChange(
    boardId: string,
    orgId: string,
    teamId: string,
    sourceElementId: string,
    sourceElementType: ElementType,
    newVisibilityMode: VisibilityMode,
    userId: string,
    userRole: UserRole,
    ydoc?: Y.Doc
  ): Promise<PropagationResult> {
    const startTime = Date.now();

    const affectedElements: string[] = [];
    const propagatedChanges: Array<{
      elementId: string;
      elementType: ElementType;
      oldVisibility: VisibilityMode | null;
      newVisibility: VisibilityMode;
      reason: string;
    }> = [];

    const byType: Record<ElementType, number> = {
      goal: 0,
      option: 0,
      outcome: 0,
      assumption: 0,
      evidence: 0,
      edge: 0,
    };

    // Only propagate when making elements confidential
    if (newVisibilityMode !== 'confidential') {
      return {
        affectedElements: [],
        propagatedChanges: [],
        summary: { totalAffected: 0, byType },
      };
    }

    // HIGH PRIORITY FIX #9: Cycle Detection
    // Track visited elements to prevent infinite loops in circular graphs
    const visited = new Set<string>();
    visited.add(sourceElementId);

    // Rule 1: Edge Cascade - Cascade to connected edges
    if (this.rules.get('edge_cascade')?.enabled && ydoc) {
      const edgeChanges = await this.cascadeToEdges(
        boardId,
        orgId,
        teamId,
        sourceElementId,
        userId,
        userRole,
        ydoc,
        visited
      );

      affectedElements.push(...edgeChanges.map((c) => c.elementId));
      propagatedChanges.push(...edgeChanges);

      edgeChanges.forEach((c) => {
        byType[c.elementType]++;
        visited.add(c.elementId); // Mark as visited
      });
    }

    // Rule 2: Derived Element Propagation
    if (this.rules.get('derived_element')?.enabled && ydoc) {
      const derivedChanges = await this.propagateToDerivedElements(
        boardId,
        orgId,
        teamId,
        sourceElementId,
        sourceElementType,
        userId,
        userRole,
        ydoc,
        visited
      );

      affectedElements.push(...derivedChanges.map((c) => c.elementId));
      propagatedChanges.push(...derivedChanges);

      derivedChanges.forEach((c) => {
        byType[c.elementType]++;
        visited.add(c.elementId); // Mark as visited
      });
    }

    // Rule 3: Inference Prevention
    if (this.rules.get('inference_prevention')?.enabled && ydoc) {
      const inferenceChanges = await this.preventInferenceLeak(
        boardId,
        orgId,
        teamId,
        sourceElementId,
        sourceElementType,
        userId,
        userRole,
        ydoc,
        visited
      );

      affectedElements.push(...inferenceChanges.map((c) => c.elementId));
      propagatedChanges.push(...inferenceChanges);

      inferenceChanges.forEach((c) => {
        byType[c.elementType]++;
        visited.add(c.elementId); // Mark as visited
      });
    }

    // HIGH PRIORITY FIX #2: Comprehensive Audit Trail for Cascaded Elements
    // Log each propagated change to audit trail for compliance and debugging
    if (propagatedChanges.length > 0) {
      await this.logPropagationAuditTrail(
        boardId,
        sourceElementId,
        sourceElementType,
        userId,
        propagatedChanges
      );
    }

    // SAFETY: Enforce propagation limits
    if (affectedElements.length > MAX_PROPAGATED_ELEMENTS) {
      logger.error(
        {
          boardId,
          sourceElementId,
          affectedCount: affectedElements.length,
          limit: MAX_PROPAGATED_ELEMENTS,
        },
        'Propagation limit exceeded - aborting'
      );
      throw new Error(
        `Propagation limit exceeded: would affect ${affectedElements.length} elements (max: ${MAX_PROPAGATED_ELEMENTS})`
      );
    }

    const duration = Date.now() - startTime;

    logger.info(
      {
        boardId,
        sourceElementId,
        affectedCount: affectedElements.length,
        duration,
      },
      'Visibility propagation completed'
    );

    return {
      affectedElements,
      propagatedChanges,
      summary: {
        totalAffected: affectedElements.length,
        byType,
      },
    };
  }

  /**
   * Cascade confidentiality to connected edges
   * HIGH PRIORITY FIX #9: Now includes cycle detection
   */
  private async cascadeToEdges(
    boardId: string,
    orgId: string,
    teamId: string,
    elementId: string,
    userId: string,
    userRole: UserRole,
    ydoc: Y.Doc,
    visited: Set<string>
  ): Promise<
    Array<{
      elementId: string;
      elementType: ElementType;
      oldVisibility: VisibilityMode | null;
      newVisibility: VisibilityMode;
      reason: string;
    }>
  > {
    const changes: Array<any> = [];
    const edgesArray = ydoc.getArray('edges');

    if (!edgesArray) {
      return changes;
    }

    const edges = edgesArray.toArray();

    for (const edge of edges) {
      // Check if edge is connected to the confidential element
      if (edge.from === elementId || edge.to === elementId) {
        const edgeId = edge.id;

        // HIGH PRIORITY FIX #9: Skip if already visited (cycle detection)
        if (visited.has(edgeId)) {
          logger.debug({ edgeId, elementId }, 'Skipping already visited edge (cycle detected)');
          continue;
        }

        // Get current visibility
        const currentVisibility = await this.visibilityManager.getElementVisibility(
          boardId,
          edgeId
        );

        // Only propagate if not already confidential
        if (!currentVisibility || currentVisibility.visibility_mode !== 'confidential') {
          await this.visibilityManager.setElementVisibility(
            boardId,
            orgId,
            teamId,
            userId,
            userRole,
            {
              elementId: edgeId,
              elementType: 'edge',
              visibilityMode: 'confidential',
              rationale: `Auto-propagated: Connected to confidential element ${elementId}`,
            }
          );

          changes.push({
            elementId: edgeId,
            elementType: 'edge' as ElementType,
            oldVisibility: currentVisibility?.visibility_mode || null,
            newVisibility: 'confidential' as VisibilityMode,
            reason: `Connected to confidential element ${elementId}`,
          });
        }
      }
    }

    return changes;
  }

  /**
   * Propagate to derived outcomes and assumptions
   * HIGH PRIORITY FIX #9: Now includes cycle detection
   */
  private async propagateToDerivedElements(
    boardId: string,
    orgId: string,
    teamId: string,
    sourceElementId: string,
    sourceElementType: ElementType,
    userId: string,
    userRole: UserRole,
    ydoc: Y.Doc,
    visited: Set<string>
  ): Promise<
    Array<{
      elementId: string;
      elementType: ElementType;
      oldVisibility: VisibilityMode | null;
      newVisibility: VisibilityMode;
      reason: string;
    }>
  > {
    const changes: Array<any> = [];

    // If a goal is confidential, outcomes derived from it should be confidential
    if (sourceElementType === 'goal') {
      const derivedOutcomes = await this.findDerivedOutcomes(
        sourceElementId,
        ydoc
      );

      for (const outcomeId of derivedOutcomes) {
        // HIGH PRIORITY FIX #9: Skip if already visited (cycle detection)
        if (visited.has(outcomeId)) {
          logger.debug({ outcomeId, sourceElementId }, 'Skipping already visited outcome (cycle detected)');
          continue;
        }

        const currentVisibility = await this.visibilityManager.getElementVisibility(
          boardId,
          outcomeId
        );

        if (!currentVisibility || currentVisibility.visibility_mode !== 'confidential') {
          await this.visibilityManager.setElementVisibility(
            boardId,
            orgId,
            teamId,
            userId,
            userRole,
            {
              elementId: outcomeId,
              elementType: 'outcome',
              visibilityMode: 'confidential',
              rationale: `Auto-propagated: Derived from confidential goal ${sourceElementId}`,
            }
          );

          changes.push({
            elementId: outcomeId,
            elementType: 'outcome' as ElementType,
            oldVisibility: currentVisibility?.visibility_mode || null,
            newVisibility: 'confidential' as VisibilityMode,
            reason: `Derived from confidential goal ${sourceElementId}`,
          });
        }
      }
    }

    // If an option is confidential, assumptions about it should be confidential
    if (sourceElementType === 'option') {
      const relatedAssumptions = await this.findRelatedAssumptions(
        sourceElementId,
        ydoc
      );

      for (const assumptionId of relatedAssumptions) {
        const currentVisibility = await this.visibilityManager.getElementVisibility(
          boardId,
          assumptionId
        );

        if (!currentVisibility || currentVisibility.visibility_mode !== 'confidential') {
          await this.visibilityManager.setElementVisibility(
            boardId,
            orgId,
            teamId,
            userId,
            userRole,
            {
              elementId: assumptionId,
              elementType: 'assumption',
              visibilityMode: 'confidential',
              rationale: `Auto-propagated: Related to confidential option ${sourceElementId}`,
            }
          );

          changes.push({
            elementId: assumptionId,
            elementType: 'assumption' as ElementType,
            oldVisibility: currentVisibility?.visibility_mode || null,
            newVisibility: 'confidential' as VisibilityMode,
            reason: `Related to confidential option ${sourceElementId}`,
          });
        }
      }
    }

    return changes;
  }

  /**
   * Prevent information leakage through graph structure
   * HIGH PRIORITY FIX #9: Now includes cycle detection
   *
   * Example: If Goal A → Option B → Outcome C, and Goal A is confidential,
   * showing the connection between Option B and Outcome C might reveal
   * information about Goal A
   */
  private async preventInferenceLeak(
    boardId: string,
    orgId: string,
    teamId: string,
    sourceElementId: string,
    sourceElementType: ElementType,
    userId: string,
    userRole: UserRole,
    ydoc: Y.Doc,
    visited: Set<string>
  ): Promise<
    Array<{
      elementId: string;
      elementType: ElementType;
      oldVisibility: VisibilityMode | null;
      newVisibility: VisibilityMode;
      reason: string;
    }>
  > {
    const changes: Array<any> = [];

    // Find elements that are only connected through the confidential element
    const isolatedElements = await this.findIsolatedElements(
      sourceElementId,
      ydoc
    );

    for (const { elementId, elementType } of isolatedElements) {
      // HIGH PRIORITY FIX #9: Skip if already visited (cycle detection)
      if (visited.has(elementId)) {
        logger.debug({ elementId, sourceElementId }, 'Skipping already visited element (cycle detected)');
        continue;
      }

      const currentVisibility = await this.visibilityManager.getElementVisibility(
        boardId,
        elementId
      );

      if (!currentVisibility || currentVisibility.visibility_mode !== 'confidential') {
        await this.visibilityManager.setElementVisibility(
          boardId,
          orgId,
          teamId,
          userId,
          userRole,
          {
            elementId,
            elementType,
            visibilityMode: 'confidential',
            rationale: `Auto-propagated: Prevents inference about confidential element ${sourceElementId}`,
          }
        );

        changes.push({
          elementId,
          elementType,
          oldVisibility: currentVisibility?.visibility_mode || null,
          newVisibility: 'confidential' as VisibilityMode,
          reason: `Prevents inference about confidential element ${sourceElementId}`,
        });
      }
    }

    return changes;
  }

  /**
   * Find outcomes derived from a goal
   */
  private async findDerivedOutcomes(
    goalId: string,
    ydoc: Y.Doc
  ): Promise<string[]> {
    const outcomes: string[] = [];
    const edgesArray = ydoc.getArray('edges');

    if (!edgesArray) {
      return outcomes;
    }

    const edges = edgesArray.toArray();

    // Find edges from goal → option → outcome
    const connectedOptions: string[] = [];

    for (const edge of edges) {
      if (edge.from === goalId && edge.to.startsWith('option-')) {
        connectedOptions.push(edge.to);
      }
    }

    // Find outcomes connected to those options
    for (const edge of edges) {
      if (
        connectedOptions.includes(edge.from) &&
        edge.to.startsWith('outcome-')
      ) {
        outcomes.push(edge.to);
      }
    }

    return outcomes;
  }

  /**
   * Find assumptions related to an option
   */
  private async findRelatedAssumptions(
    optionId: string,
    ydoc: Y.Doc
  ): Promise<string[]> {
    const assumptions: string[] = [];
    const edgesArray = ydoc.getArray('edges');

    if (!edgesArray) {
      return assumptions;
    }

    const edges = edgesArray.toArray();

    for (const edge of edges) {
      if (
        (edge.from === optionId && edge.to.startsWith('assumption-')) ||
        (edge.to === optionId && edge.from.startsWith('assumption-'))
      ) {
        const assumptionId = edge.from === optionId ? edge.to : edge.from;
        assumptions.push(assumptionId);
      }
    }

    return assumptions;
  }

  /**
   * Find elements that are isolated (only connected through confidential element)
   *
   * These elements might reveal information about the confidential element
   * through their mere existence or connections
   */
  private async findIsolatedElements(
    confidentialElementId: string,
    ydoc: Y.Doc
  ): Promise<Array<{ elementId: string; elementType: ElementType }>> {
    const isolated: Array<{ elementId: string; elementType: ElementType }> = [];
    const edgesArray = ydoc.getArray('edges');

    if (!edgesArray) {
      return isolated;
    }

    const edges = edgesArray.toArray();

    // Find elements directly connected to the confidential element
    const directlyConnected: string[] = [];

    for (const edge of edges) {
      if (edge.from === confidentialElementId) {
        directlyConnected.push(edge.to);
      } else if (edge.to === confidentialElementId) {
        directlyConnected.push(edge.from);
      }
    }

    // Check if these elements have other connections
    for (const elementId of directlyConnected) {
      const otherConnections = edges.filter(
        (edge) =>
          (edge.from === elementId || edge.to === elementId) &&
          edge.from !== confidentialElementId &&
          edge.to !== confidentialElementId
      );

      // If no other connections, element is isolated
      if (otherConnections.length === 0) {
        const elementType = this.inferElementType(elementId);
        if (elementType) {
          isolated.push({ elementId, elementType });
        }
      }
    }

    return isolated;
  }

  /**
   * Infer element type from ID prefix
   */
  private inferElementType(elementId: string): ElementType | null {
    if (elementId.startsWith('goal-')) return 'goal';
    if (elementId.startsWith('option-')) return 'option';
    if (elementId.startsWith('outcome-')) return 'outcome';
    if (elementId.startsWith('assumption-')) return 'assumption';
    if (elementId.startsWith('evidence-')) return 'evidence';
    if (elementId.startsWith('edge-')) return 'edge';
    return null;
  }

  /**
   * Enable or disable a propagation rule
   */
  setRuleEnabled(ruleType: string, enabled: boolean): void {
    const rule = this.rules.get(ruleType);
    if (rule) {
      rule.enabled = enabled;
      logger.info({ ruleType, enabled }, 'Propagation rule updated');
    }
  }

  /**
   * Get all propagation rules
   */
  getRules(): PropagationRule[] {
    return Array.from(this.rules.values());
  }

  /**
   * HIGH PRIORITY FIX #2: Log propagation audit trail
   *
   * Creates comprehensive audit records for all cascaded visibility changes
   * to ensure compliance and enable debugging of propagation behavior.
   */
  private async logPropagationAuditTrail(
    boardId: string,
    sourceElementId: string,
    sourceElementType: ElementType,
    userId: string,
    propagatedChanges: Array<{
      elementId: string;
      elementType: ElementType;
      oldVisibility: VisibilityMode | null;
      newVisibility: VisibilityMode;
      reason: string;
    }>
  ): Promise<void> {
    try {
      // Log aggregate propagation event
      await this.db.query(
        `INSERT INTO visibility_change_events (
          board_id,
          element_id,
          element_type,
          old_visibility_mode,
          new_visibility_mode,
          changed_by_user_id,
          actor_user_id,
          change_type,
          rationale,
          changed_at,
          metadata
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), $10)`,
        [
          boardId,
          sourceElementId,
          sourceElementType,
          null, // old_visibility_mode (not applicable for aggregate)
          'confidential',
          userId,
          userId,
          'propagation_cascade',
          `Cascaded confidentiality to ${propagatedChanges.length} related elements`,
          JSON.stringify({
            cascaded_count: propagatedChanges.length,
            affected_elements: propagatedChanges.map(c => c.elementId),
            by_type: propagatedChanges.reduce((acc, c) => {
              acc[c.elementType] = (acc[c.elementType] || 0) + 1;
              return acc;
            }, {} as Record<string, number>)
          })
        ]
      );

      // Log individual cascaded element changes for detailed audit trail
      for (const change of propagatedChanges) {
        await this.db.query(
          `INSERT INTO visibility_change_events (
            board_id,
            element_id,
            element_type,
            old_visibility_mode,
            new_visibility_mode,
            changed_by_user_id,
            actor_user_id,
            change_type,
            rationale,
            changed_at,
            metadata
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), $10)`,
          [
            boardId,
            change.elementId,
            change.elementType,
            change.oldVisibility || 'public',
            change.newVisibility,
            userId,
            userId,
            'propagated_from_parent',
            change.reason,
            JSON.stringify({
              source_element_id: sourceElementId,
              source_element_type: sourceElementType,
              propagation_reason: change.reason,
              automatic: true
            })
          ]
        );
      }

      logger.info(
        {
          boardId,
          sourceElementId,
          cascadedCount: propagatedChanges.length,
          userId
        },
        'Propagation audit trail logged'
      );
    } catch (error) {
      // Don't fail propagation if audit logging fails, but log error
      logger.error(
        { error, boardId, sourceElementId },
        'Failed to log propagation audit trail'
      );
    }
  }

  /**
   * Reverse propagation (when making element public)
   *
   * Only removes propagated visibility, not manually set confidentiality
   */
  async reversePropagation(
    boardId: string,
    sourceElementId: string
  ): Promise<string[]> {
    const reversedElements: string[] = [];

    // Get all visibility change events for this board
    const history = await this.visibilityManager.getVisibilityHistory(boardId);

    // Find elements that were auto-propagated from this source
    const propagatedElements = history.filter(
      (event) =>
        event.rationale &&
        event.rationale.includes(`confidential element ${sourceElementId}`)
    );

    for (const event of propagatedElements) {
      // Only reverse if still confidential
      const current = await this.visibilityManager.getElementVisibility(
        boardId,
        event.element_id
      );

      if (current && current.visibility_mode === 'confidential') {
        // Delete visibility (revert to public)
        await this.visibilityManager.deleteElementVisibility(
          boardId,
          event.element_id
        );

        reversedElements.push(event.element_id);
      }
    }

    logger.info(
      {
        boardId,
        sourceElementId,
        reversedCount: reversedElements.length,
      },
      'Reversed propagation'
    );

    return reversedElements;
  }
}
