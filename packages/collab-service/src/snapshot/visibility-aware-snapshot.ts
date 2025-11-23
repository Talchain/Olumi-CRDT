/**
 * Visibility-Aware Snapshot Manager
 *
 * Creates snapshots that respect element-level visibility permissions.
 * Ensures exported board states filter confidential elements appropriately.
 *
 * Part of Phase 4, Section H.4: Snapshot and Export Respect
 */

import { pino } from 'pino';
import * as Y from 'yjs';
import { DatabaseClient } from '../database/client';
import { VisibilityManager } from '../visibility/visibility-manager';
import { VisibilityFilter } from '../visibility/visibility-filter';
import { BoardDocument } from '../types/board';
import {
  BoardSnapshotRecord,
  CreateSnapshotRequest,
  toCanonicalSnapshot,
} from '../types/snapshot';
import { UserRole } from '../types/auth';
import { computeSnapshotHash, generateSnapshotId } from '../utils/hash';

const logger = pino({ name: 'visibility-aware-snapshot' });

export interface FilteredSnapshotOptions {
  includeVisibilitySummary?: boolean;
  includeRedactionLog?: boolean;
  watermark?: string;
}

export interface FilteredSnapshotRecord extends BoardSnapshotRecord {
  filteredForUser?: string;
  filteredForRole?: UserRole;
  filteredAt?: string;
  redactionSummary?: {
    totalElements: number;
    visibleElements: number;
    redactedElements: number;
  };
  redactionLog?: Array<{
    elementId: string;
    elementType: string;
    reason: string;
  }>;
}

export class VisibilityAwareSnapshotManager {
  constructor(
    private db: DatabaseClient,
    private visibilityManager: VisibilityManager,
    private visibilityFilter: VisibilityFilter
  ) {}

  /**
   * Create a snapshot with visibility filtering applied
   */
  async createFilteredSnapshot(
    ydoc: Y.Doc,
    boardId: string,
    orgId: string,
    teamId: string,
    userId: string,
    userRole: UserRole,
    request: CreateSnapshotRequest,
    options: FilteredSnapshotOptions = {}
  ): Promise<FilteredSnapshotRecord> {
    logger.info(
      { boardId, userId, userRole },
      'Creating filtered snapshot'
    );

    // Apply visibility filtering
    const filteredResult = await this.visibilityFilter.filterDocument(
      ydoc,
      boardId,
      userId,
      userRole
    );

    // Convert filtered document to BoardDocument format
    const board = this.yjsDocToBoardDocument(
      filteredResult.filteredDoc,
      boardId,
      orgId,
      userId
    );

    // Convert to canonical form
    const canonicalSnapshot = toCanonicalSnapshot(board, teamId);

    // Compute hash (of filtered content)
    const snapshotHash = computeSnapshotHash(canonicalSnapshot);

    // Create snapshot record
    const snapshotRecord: FilteredSnapshotRecord = {
      snapshotId: generateSnapshotId(),
      snapshotHash,
      boardId,
      orgId,
      teamId,
      createdAt: new Date().toISOString(),
      createdByUserId: userId,
      parentSnapshotId: undefined, // Filtered snapshots don't participate in lineage
      name: request.name || `Filtered snapshot for ${userId}`,
      snapshot: canonicalSnapshot,
      isImmutable: true, // Filtered snapshots are always immutable
      filteredForUser: userId,
      filteredForRole: userRole,
      filteredAt: new Date().toISOString(),
    };

    // Add visibility summary if requested
    if (options.includeVisibilitySummary) {
      snapshotRecord.redactionSummary = filteredResult.redactionSummary;
    }

    // Add redaction log if requested
    if (options.includeRedactionLog) {
      snapshotRecord.redactionLog = filteredResult.redactedElements.map((elem) => ({
        elementId: elem.element_id,
        elementType: elem.element_type,
        reason: `Element is confidential and user does not have access`,
      }));
    }

    // Add watermark to snapshot metadata if requested
    if (options.watermark) {
      (snapshotRecord.snapshot as any).metadata = {
        ...(canonicalSnapshot.metadata || {}),
        watermark: options.watermark,
        filteredSnapshot: true,
      };
    }

    logger.info(
      {
        snapshotId: snapshotRecord.snapshotId,
        redactedCount: filteredResult.redactionSummary.redactedElements,
      },
      'Filtered snapshot created'
    );

    return snapshotRecord;
  }

  /**
   * Export filtered board state for external use
   */
  async exportFilteredBoard(
    ydoc: Y.Doc,
    boardId: string,
    userId: string,
    userRole: UserRole,
    format: 'json' | 'csv' | 'pdf' = 'json'
  ): Promise<{
    data: any;
    metadata: {
      exportedAt: string;
      exportedBy: string;
      format: string;
      redactionSummary: any;
      watermark: string;
    };
  }> {
    // Filter document
    const filteredResult = await this.visibilityFilter.filterDocument(
      ydoc,
      boardId,
      userId,
      userRole
    );

    // Convert to export format
    let exportData: any;

    switch (format) {
      case 'json':
        exportData = this.toJSON(filteredResult.filteredDoc);
        break;
      case 'csv':
        exportData = this.toCSV(filteredResult.filteredDoc);
        break;
      case 'pdf':
        exportData = this.toPDFData(filteredResult.filteredDoc);
        break;
      default:
        exportData = this.toJSON(filteredResult.filteredDoc);
    }

    return {
      data: exportData,
      metadata: {
        exportedAt: new Date().toISOString(),
        exportedBy: userId,
        format,
        redactionSummary: filteredResult.redactionSummary,
        watermark: `CONFIDENTIAL - Exported for ${userId} on ${new Date().toLocaleDateString()} - Some elements may be redacted`,
      },
    };
  }

  /**
   * Create a visibility-respecting snapshot for archival
   *
   * This creates a full snapshot with visibility metadata attached,
   * but doesn't filter the content. Used for archival where we want
   * to preserve all data but track what was visible to whom.
   */
  async createArchivalSnapshot(
    ydoc: Y.Doc,
    boardId: string,
    orgId: string,
    teamId: string,
    userId: string,
    request: CreateSnapshotRequest
  ): Promise<BoardSnapshotRecord & { visibilityMetadata: any }> {
    // Get visibility stats
    const stats = await this.visibilityManager.getVisibilityStats(boardId);

    // Get all visibility records
    const visibilityRecords = await this.visibilityManager.getBoardVisibility(boardId);

    // Convert to BoardDocument
    const board = this.yjsDocToBoardDocument(ydoc, boardId, orgId, userId);

    // Create canonical snapshot
    const canonicalSnapshot = toCanonicalSnapshot(board, teamId);
    const snapshotHash = computeSnapshotHash(canonicalSnapshot);

    const snapshotRecord = {
      snapshotId: generateSnapshotId(),
      snapshotHash,
      boardId,
      orgId,
      teamId,
      createdAt: new Date().toISOString(),
      createdByUserId: userId,
      parentSnapshotId: undefined,
      name: request.name || `Archival snapshot`,
      snapshot: canonicalSnapshot,
      isImmutable: true,
      visibilityMetadata: {
        stats,
        visibilityRecords: visibilityRecords.map((v) => ({
          elementId: v.element_id,
          elementType: v.element_type,
          visibilityMode: v.visibility_mode,
          viewerWhitelist: v.viewer_whitelist,
          viewerRoles: v.viewer_roles,
          setBy: v.set_by_user_id,
          setAt: v.set_at,
        })),
        archivedAt: new Date().toISOString(),
      },
    };

    logger.info(
      {
        snapshotId: snapshotRecord.snapshotId,
        confidentialCount: stats.confidential_elements,
      },
      'Archival snapshot created with visibility metadata'
    );

    return snapshotRecord;
  }

  /**
   * Verify snapshot respects visibility
   *
   * Ensures a given snapshot was properly filtered and doesn't contain
   * elements the user shouldn't have access to
   */
  async verifySnapshotVisibility(
    snapshot: BoardSnapshotRecord,
    userId: string,
    userRole: UserRole
  ): Promise<{
    isValid: boolean;
    violations: Array<{
      elementId: string;
      elementType: string;
      reason: string;
    }>;
  }> {
    const violations: Array<{ elementId: string; elementType: string; reason: string }> =
      [];

    // Extract elements from snapshot
    const elements = this.extractElementsFromSnapshot(snapshot.snapshot);

    // Check each element
    for (const { elementId, elementType } of elements) {
      const check = await this.visibilityManager.canViewElement(
        snapshot.boardId,
        elementId,
        userId,
        userRole
      );

      if (!check.can_view) {
        violations.push({
          elementId,
          elementType,
          reason: check.reason || 'User does not have permission to view this element',
        });
      }
    }

    return {
      isValid: violations.length === 0,
      violations,
    };
  }

  /**
   * Convert Yjs document to BoardDocument
   */
  private yjsDocToBoardDocument(
    ydoc: Y.Doc,
    boardId: string,
    orgId: string,
    userId: string
  ): BoardDocument {
    const goals = this.mapToObject(ydoc.getMap('goals'));
    const options = this.mapToObject(ydoc.getMap('options'));
    const outcomes = this.mapToObject(ydoc.getMap('outcomes'));
    const assumptions = this.mapToObject(ydoc.getMap('assumptions'));
    const evidence = this.mapToObject(ydoc.getMap('evidence'));
    const edges = ydoc.getArray('edges').toArray();
    const metadata = this.mapToObject(ydoc.getMap('metadata'));

    return {
      id: boardId,
      orgId,
      ownerId: userId,
      teamId: metadata?.teamId || '',
      version: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      goals,
      options,
      outcomes,
      assumptions,
      evidence,
      edges,
      metadata,
    };
  }

  /**
   * Convert Y.Map to plain object
   */
  private mapToObject(ymap: Y.Map<any> | undefined): any {
    if (!ymap) return {};

    const obj: any = {};
    ymap.forEach((value, key) => {
      obj[key] = value;
    });
    return obj;
  }

  /**
   * Convert filtered document to JSON
   */
  private toJSON(ydoc: Y.Doc): any {
    return {
      goals: this.mapToObject(ydoc.getMap('goals')),
      options: this.mapToObject(ydoc.getMap('options')),
      outcomes: this.mapToObject(ydoc.getMap('outcomes')),
      assumptions: this.mapToObject(ydoc.getMap('assumptions')),
      evidence: this.mapToObject(ydoc.getMap('evidence')),
      edges: ydoc.getArray('edges').toArray(),
      metadata: this.mapToObject(ydoc.getMap('metadata')),
    };
  }

  /**
   * Convert filtered document to CSV
   */
  private toCSV(ydoc: Y.Doc): string {
    const lines: string[] = [];

    // Header
    lines.push('Type,ID,Text,Description,Redacted');

    // Goals
    const goals = this.mapToObject(ydoc.getMap('goals'));
    Object.entries(goals).forEach(([id, goal]: [string, any]) => {
      lines.push(
        `Goal,${id},"${goal.text || ''}","${goal.description || ''}",${goal.redacted || false}`
      );
    });

    // Options
    const options = this.mapToObject(ydoc.getMap('options'));
    Object.entries(options).forEach(([id, option]: [string, any]) => {
      lines.push(
        `Option,${id},"${option.text || ''}","${option.description || ''}",${option.redacted || false}`
      );
    });

    // Outcomes
    const outcomes = this.mapToObject(ydoc.getMap('outcomes'));
    Object.entries(outcomes).forEach(([id, outcome]: [string, any]) => {
      lines.push(
        `Outcome,${id},"${outcome.text || ''}","${outcome.description || ''}",${outcome.redacted || false}`
      );
    });

    return lines.join('\n');
  }

  /**
   * Convert filtered document to PDF-ready data
   */
  private toPDFData(ydoc: Y.Doc): any {
    return {
      format: 'pdf-data',
      content: this.toJSON(ydoc),
      styling: {
        redactedElements: {
          backgroundColor: '#f3f4f6',
          fontStyle: 'italic',
          color: '#9ca3af',
        },
      },
    };
  }

  /**
   * Extract all elements from snapshot
   */
  private extractElementsFromSnapshot(
    snapshot: any
  ): Array<{ elementId: string; elementType: string }> {
    const elements: Array<{ elementId: string; elementType: string }> = [];

    // Extract from each element type
    const types = ['goals', 'options', 'outcomes', 'assumptions', 'evidence'];

    for (const type of types) {
      if (snapshot[type]) {
        Object.keys(snapshot[type]).forEach((elementId) => {
          elements.push({
            elementId,
            elementType: type.slice(0, -1), // Remove trailing 's'
          });
        });
      }
    }

    // Extract edges
    if (snapshot.edges) {
      snapshot.edges.forEach((edge: any) => {
        if (edge.id) {
          elements.push({
            elementId: edge.id,
            elementType: 'edge',
          });
        }
      });
    }

    return elements;
  }
}
