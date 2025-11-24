/**
 * Visibility Filter
 *
 * Filters Yjs board documents based on user visibility permissions.
 * Redacts confidential elements that users don't have access to.
 *
 * Part of Phase 4, Section H.2: Redacted Views and UI Treatment
 */

import * as Y from 'yjs';
import { VisibilityManager } from '../visibility/visibility-manager';
import { UserRole } from '../types/auth';
import { ElementType, RedactedElement } from '../types/visibility';
import { pino } from 'pino';

const logger = pino({ name: 'visibility-filter' });

// HIGH PRIORITY FIX #8: Limit maximum elements to prevent OOM
// Large boards (10,000+ elements) could cause out-of-memory errors
const MAX_ELEMENTS_PER_TYPE = 10000; // Per element type (goals, options, etc.)
const MAX_TOTAL_ELEMENTS = 50000;    // Total across all types

/**
 * SECURITY FIX (#7): Generate synthetic ID for redacted elements
 * Prevents information leakage through element ID patterns
 */
function generateRedactedElementId(realElementId: string): string {
  // Generate a deterministic but opaque ID
  // Uses first 8 chars of SHA-256 hash to avoid pattern inference
  const crypto = require('crypto');
  const hash = crypto.createHash('sha256').update(realElementId).digest('hex');
  return `redacted_${hash.substring(0, 12)}`;
}

export interface FilteredDocument {
  filteredDoc: Y.Doc;
  redactedElements: RedactedElement[];
  redactionSummary: {
    totalElements: number;
    visibleElements: number;
    redactedElements: number;
    redactedByType: Record<ElementType, number>;
  };
}

export class VisibilityFilter {
  constructor(private visibilityManager: VisibilityManager) {}

  /**
   * Filter a board document based on user visibility permissions
   * Returns a new Y.Doc with confidential elements redacted
   */
  async filterDocument(
    sourceDoc: Y.Doc,
    boardId: string,
    userId: string,
    userRole: UserRole
  ): Promise<FilteredDocument> {
    const startTime = Date.now();

    // HIGH PRIORITY FIX #8: Check board size before processing
    // Prevents OOM on extremely large boards
    const estimatedSize = this.estimateBoardSize(sourceDoc);
    if (estimatedSize > MAX_TOTAL_ELEMENTS) {
      logger.error(
        { boardId, estimatedSize, maxAllowed: MAX_TOTAL_ELEMENTS },
        'CRITICAL: Board too large for filtering, would cause OOM'
      );
      throw new Error(
        `Board too large (${estimatedSize} elements). Maximum allowed: ${MAX_TOTAL_ELEMENTS}`
      );
    }

    // Create a new filtered document
    const filteredDoc = new Y.Doc();

    // Get all element visibility records for the board
    const visibilityRecords = await this.visibilityManager.getBoardVisibility(boardId);
    const visibilityMap = new Map(
      visibilityRecords.map((v) => [v.element_id, v])
    );

    const redactedElements: RedactedElement[] = [];
    const redactedByType: Record<ElementType, number> = {
      goal: 0,
      option: 0,
      outcome: 0,
      assumption: 0,
      evidence: 0,
      edge: 0,
    };

    let totalElements = 0;
    let visibleElements = 0;

    // Filter goals
    const sourceGoals = sourceDoc.getMap('goals');
    const filteredGoals = filteredDoc.getMap('goals');
    await this.filterMap(
      sourceGoals,
      filteredGoals,
      'goal',
      boardId,
      userId,
      userRole,
      visibilityMap,
      redactedElements,
      redactedByType,
      (count) => { totalElements += count; },
      (count) => { visibleElements += count; }
    );

    // Filter options
    const sourceOptions = sourceDoc.getMap('options');
    const filteredOptions = filteredDoc.getMap('options');
    await this.filterMap(
      sourceOptions,
      filteredOptions,
      'option',
      boardId,
      userId,
      userRole,
      visibilityMap,
      redactedElements,
      redactedByType,
      (count) => { totalElements += count; },
      (count) => { visibleElements += count; }
    );

    // Filter outcomes
    const sourceOutcomes = sourceDoc.getMap('outcomes');
    const filteredOutcomes = filteredDoc.getMap('outcomes');
    await this.filterMap(
      sourceOutcomes,
      filteredOutcomes,
      'outcome',
      boardId,
      userId,
      userRole,
      visibilityMap,
      redactedElements,
      redactedByType,
      (count) => { totalElements += count; },
      (count) => { visibleElements += count; }
    );

    // Filter assumptions
    const sourceAssumptions = sourceDoc.getMap('assumptions');
    const filteredAssumptions = filteredDoc.getMap('assumptions');
    await this.filterMap(
      sourceAssumptions,
      filteredAssumptions,
      'assumption',
      boardId,
      userId,
      userRole,
      visibilityMap,
      redactedElements,
      redactedByType,
      (count) => { totalElements += count; },
      (count) => { visibleElements += count; }
    );

    // Filter evidence
    const sourceEvidence = sourceDoc.getMap('evidence');
    const filteredEvidence = filteredDoc.getMap('evidence');
    await this.filterMap(
      sourceEvidence,
      filteredEvidence,
      'evidence',
      boardId,
      userId,
      userRole,
      visibilityMap,
      redactedElements,
      redactedByType,
      (count) => { totalElements += count; },
      (count) => { visibleElements += count; }
    );

    // Filter edges (connections)
    const sourceEdges = sourceDoc.getArray('edges');
    const filteredEdges = filteredDoc.getArray('edges');
    await this.filterEdges(
      sourceEdges,
      filteredEdges,
      boardId,
      userId,
      userRole,
      visibilityMap,
      redactedElements,
      redactedByType,
      (count) => { totalElements += count; },
      (count) => { visibleElements += count; }
    );

    // Copy metadata (non-sensitive)
    const sourceMeta = sourceDoc.getMap('metadata');
    const filteredMeta = filteredDoc.getMap('metadata');
    if (sourceMeta) {
      filteredMeta.set('boardId', sourceMeta.get('boardId'));
      filteredMeta.set('orgId', sourceMeta.get('orgId'));
      filteredMeta.set('teamId', sourceMeta.get('teamId'));
      filteredMeta.set('createdAt', sourceMeta.get('createdAt'));
      filteredMeta.set('filteredAt', new Date().toISOString());
      filteredMeta.set('filteredForUser', userId);
    }

    const duration = Date.now() - startTime;

    logger.info(
      {
        boardId,
        userId,
        totalElements,
        visibleElements,
        redactedCount: redactedElements.length,
        duration,
      },
      'Document filtered'
    );

    return {
      filteredDoc,
      redactedElements,
      redactionSummary: {
        totalElements,
        visibleElements,
        redactedElements: redactedElements.length,
        redactedByType,
      },
    };
  }

  /**
   * HIGH PRIORITY FIX #8: Estimate total board size
   * Quick size check before processing to prevent OOM
   */
  private estimateBoardSize(doc: Y.Doc): number {
    let total = 0;
    const goals = doc.getMap('goals');
    const options = doc.getMap('options');
    const outcomes = doc.getMap('outcomes');
    const assumptions = doc.getMap('assumptions');
    const evidence = doc.getMap('evidence');
    const edges = doc.getArray('edges');

    if (goals) total += goals.size;
    if (options) total += options.size;
    if (outcomes) total += outcomes.size;
    if (assumptions) total += assumptions.size;
    if (evidence) total += evidence.size;
    if (edges) total += edges.length;

    return total;
  }

  /**
   * Filter a Y.Map of elements
   * HIGH PRIORITY FIX #8: Added per-type size limit check
   */
  private async filterMap(
    sourceMap: Y.Map<any>,
    filteredMap: Y.Map<any>,
    elementType: ElementType,
    boardId: string,
    userId: string,
    userRole: UserRole,
    visibilityMap: Map<string, any>,
    redactedElements: RedactedElement[],
    redactedByType: Record<ElementType, number>,
    totalCounter: (count: number) => void,
    visibleCounter: (count: number) => void
  ): Promise<void> {
    if (!sourceMap) {
      return;
    }

    // HIGH PRIORITY FIX #8: Check size before converting to array
    const mapSize = sourceMap.size;
    if (mapSize > MAX_ELEMENTS_PER_TYPE) {
      logger.error(
        { boardId, elementType, size: mapSize, maxAllowed: MAX_ELEMENTS_PER_TYPE },
        'CRITICAL: Element type exceeds maximum size'
      );
      throw new Error(
        `Too many ${elementType} elements (${mapSize}). Maximum allowed: ${MAX_ELEMENTS_PER_TYPE}`
      );
    }

    const entries = Array.from(sourceMap.entries());
    totalCounter(entries.length);

    for (const [elementId, elementData] of entries) {
      const canView = await this.canViewElement(
        elementId,
        boardId,
        userId,
        userRole,
        visibilityMap
      );

      if (canView) {
        // User can view - copy element as-is
        filteredMap.set(elementId, elementData);
        visibleCounter(1);
      } else {
        // User cannot view - add redacted placeholder
        const redacted = this.visibilityManager.getRedactedElement(
          elementId,
          elementType
        );

        // SECURITY FIX (#7): Use synthetic ID to prevent information leakage
        const syntheticId = generateRedactedElementId(elementId);

        filteredMap.set(elementId, {
          id: syntheticId,  // ✓ Synthetic ID prevents pattern inference
          type: elementType,
          redacted: true,
          text: redacted.placeholder_text,
          createdAt: elementData?.createdAt || new Date().toISOString(),
        });

        redactedElements.push(redacted);
        redactedByType[elementType]++;

        logger.debug(
          { realId: elementId, syntheticId, elementType },
          'Element redacted with synthetic ID'
        );
      }
    }
  }

  /**
   * Filter Y.Array of edges
   * HIGH PRIORITY FIX #8: Added size limit check
   */
  private async filterEdges(
    sourceArray: Y.Array<any>,
    filteredArray: Y.Array<any>,
    boardId: string,
    userId: string,
    userRole: UserRole,
    visibilityMap: Map<string, any>,
    redactedElements: RedactedElement[],
    redactedByType: Record<ElementType, number>,
    totalCounter: (count: number) => void,
    visibleCounter: (count: number) => void
  ): Promise<void> {
    if (!sourceArray) {
      return;
    }

    // HIGH PRIORITY FIX #8: Check size before converting to array
    const arrayLength = sourceArray.length;
    if (arrayLength > MAX_ELEMENTS_PER_TYPE) {
      logger.error(
        { boardId, elementType: 'edge', size: arrayLength, maxAllowed: MAX_ELEMENTS_PER_TYPE },
        'CRITICAL: Edge count exceeds maximum size'
      );
      throw new Error(
        `Too many edges (${arrayLength}). Maximum allowed: ${MAX_ELEMENTS_PER_TYPE}`
      );
    }

    const edges = sourceArray.toArray();
    totalCounter(edges.length);

    for (const edge of edges) {
      const edgeId = edge.id;

      const canView = await this.canViewElement(
        edgeId,
        boardId,
        userId,
        userRole,
        visibilityMap
      );

      if (canView) {
        // User can view - copy edge as-is
        filteredArray.push([edge]);
        visibleCounter(1);
      } else {
        // User cannot view - add redacted placeholder
        const redacted = this.visibilityManager.getRedactedElement(edgeId, 'edge');

        filteredArray.push([{
          id: edgeId,
          type: 'edge',
          redacted: true,
          label: redacted.placeholder_text,
          createdAt: edge?.createdAt || new Date().toISOString(),
        }]);

        redactedElements.push(redacted);
        redactedByType['edge']++;
      }
    }
  }

  /**
   * Check if user can view an element (with caching)
   */
  private async canViewElement(
    elementId: string,
    boardId: string,
    userId: string,
    userRole: UserRole,
    visibilityMap: Map<string, any>
  ): Promise<boolean> {
    // If no visibility record, element is public by default
    if (!visibilityMap.has(elementId)) {
      return true;
    }

    const checkResult = await this.visibilityManager.canViewElement(
      boardId,
      elementId,
      userId,
      userRole
    );

    return checkResult.can_view;
  }

  /**
   * Create a lightweight redaction summary without filtering full document
   * Useful for quick checks before expensive filtering
   */
  async getRedactionPreview(
    boardId: string,
    userId: string,
    userRole: UserRole
  ): Promise<{
    hasRedactions: boolean;
    confidentialCount: number;
    accessibleCount: number;
    inaccessibleCount: number;
  }> {
    const confidential = await this.visibilityManager.getConfidentialElements(boardId);

    let accessibleCount = 0;
    let inaccessibleCount = 0;

    for (const element of confidential) {
      const check = await this.visibilityManager.canViewElement(
        boardId,
        element.element_id,
        userId,
        userRole
      );

      if (check.can_view) {
        accessibleCount++;
      } else {
        inaccessibleCount++;
      }
    }

    return {
      hasRedactions: inaccessibleCount > 0,
      confidentialCount: confidential.length,
      accessibleCount,
      inaccessibleCount,
    };
  }

  /**
   * Apply visibility filter in-place to a document
   * Modifies the document directly instead of creating a copy
   * WARNING: This is destructive and should only be used when appropriate
   */
  async applyFilterInPlace(
    doc: Y.Doc,
    boardId: string,
    userId: string,
    userRole: UserRole
  ): Promise<{ redactedCount: number; redactedElements: RedactedElement[] }> {
    const visibilityRecords = await this.visibilityManager.getBoardVisibility(boardId);
    const visibilityMap = new Map(
      visibilityRecords.map((v) => [v.element_id, v])
    );

    const redactedElements: RedactedElement[] = [];

    // Process each element type
    const elementTypes: Array<{ key: string; type: ElementType; isArray: boolean }> = [
      { key: 'goals', type: 'goal', isArray: false },
      { key: 'options', type: 'option', isArray: false },
      { key: 'outcomes', type: 'outcome', isArray: false },
      { key: 'assumptions', type: 'assumption', isArray: false },
      { key: 'evidence', type: 'evidence', isArray: false },
      { key: 'edges', type: 'edge', isArray: true },
    ];

    for (const { key, type, isArray } of elementTypes) {
      if (isArray) {
        const array = doc.getArray(key);
        await this.redactArrayInPlace(
          array,
          type,
          boardId,
          userId,
          userRole,
          visibilityMap,
          redactedElements
        );
      } else {
        const map = doc.getMap(key);
        await this.redactMapInPlace(
          map,
          type,
          boardId,
          userId,
          userRole,
          visibilityMap,
          redactedElements
        );
      }
    }

    return {
      redactedCount: redactedElements.length,
      redactedElements,
    };
  }

  /**
   * Redact elements in a Y.Map in-place
   */
  private async redactMapInPlace(
    map: Y.Map<any>,
    elementType: ElementType,
    boardId: string,
    userId: string,
    userRole: UserRole,
    visibilityMap: Map<string, any>,
    redactedElements: RedactedElement[]
  ): Promise<void> {
    if (!map) {
      return;
    }

    const entries = Array.from(map.entries());

    for (const [elementId, elementData] of entries) {
      const canView = await this.canViewElement(
        elementId,
        boardId,
        userId,
        userRole,
        visibilityMap
      );

      if (!canView) {
        const redacted = this.visibilityManager.getRedactedElement(
          elementId,
          elementType
        );

        // SECURITY FIX (#7): Use synthetic ID to prevent information leakage
        const syntheticId = generateRedactedElementId(elementId);

        map.set(elementId, {
          id: syntheticId,  // ✓ Synthetic ID prevents pattern inference
          type: elementType,
          redacted: true,
          text: redacted.placeholder_text,
          createdAt: elementData?.createdAt || new Date().toISOString(),
        });

        redactedElements.push(redacted);

        logger.debug(
          { realId: elementId, syntheticId, elementType },
          'Element redacted in-place with synthetic ID'
        );
      }
    }
  }

  /**
   * Redact elements in a Y.Array in-place
   */
  private async redactArrayInPlace(
    array: Y.Array<any>,
    elementType: ElementType,
    boardId: string,
    userId: string,
    userRole: UserRole,
    visibilityMap: Map<string, any>,
    redactedElements: RedactedElement[]
  ): Promise<void> {
    if (!array) {
      return;
    }

    const length = array.length;

    for (let i = 0; i < length; i++) {
      const element = array.get(i);
      const elementId = element?.id;

      if (!elementId) {
        continue;
      }

      const canView = await this.canViewElement(
        elementId,
        boardId,
        userId,
        userRole,
        visibilityMap
      );

      if (!canView) {
        const redacted = this.visibilityManager.getRedactedElement(
          elementId,
          elementType
        );

        // SECURITY FIX (#7): Use synthetic ID to prevent information leakage
        const syntheticId = generateRedactedElementId(elementId);

        array.delete(i, 1);
        array.insert(i, [{
          id: syntheticId,  // ✓ Synthetic ID prevents pattern inference
          type: elementType,
          redacted: true,
          label: redacted.placeholder_text,
          createdAt: element?.createdAt || new Date().toISOString(),
        }]);

        redactedElements.push(redacted);

        logger.debug(
          { realId: elementId, syntheticId, elementType },
          'Array element redacted with synthetic ID'
        );
      }
    }
  }
}
