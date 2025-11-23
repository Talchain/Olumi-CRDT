/**
 * Yjs document manager
 * Handles document lifecycle, persistence, and snapshot generation
 */

import * as Y from 'yjs';
import { v4 as uuidv4 } from 'uuid';
import { pino } from 'pino';
import { DatabaseClient } from '../database/client';
import { BoardDocument, BoardSnapshot } from '../types/board';
import { SnapshotManager } from '../snapshot/snapshot-manager';
import { CommentsManager } from '../comments/comments-manager';
import { VisibilityManager } from '../visibility/visibility-manager';
import { VisibilityFilter } from '../visibility/visibility-filter';
import { config } from '../config';

const logger = pino({ level: config.logging.level });

interface DocumentInfo {
  ydoc: Y.Doc;
  boardId: string;
  orgId: string;
  lastAccessTime: number;
  connectionCount: number;
  updateClock: number;
  snapshotTimer?: NodeJS.Timeout;
  evictionTimer?: NodeJS.Timeout;
}

export class DocumentManager {
  private documents: Map<string, DocumentInfo> = new Map();
  private db: DatabaseClient;
  public snapshotManager: SnapshotManager;
  public commentsManager: CommentsManager;
  public visibilityManager: VisibilityManager;
  public visibilityFilter: VisibilityFilter;

  constructor(db: DatabaseClient) {
    this.db = db;
    this.snapshotManager = new SnapshotManager(db);
    this.commentsManager = new CommentsManager(db);
    this.visibilityManager = new VisibilityManager(db);
    this.visibilityFilter = new VisibilityFilter(this.visibilityManager);
    this.startEvictionLoop();
  }

  /**
   * Get or create a Yjs document for a board
   */
  async getDocument(boardId: string, orgId: string): Promise<Y.Doc> {
    let docInfo = this.documents.get(boardId);

    if (docInfo) {
      // Document already in memory
      docInfo.lastAccessTime = Date.now();
      docInfo.connectionCount++;
      logger.debug({ boardId, connections: docInfo.connectionCount }, 'Reusing existing document');
      return docInfo.ydoc;
    }

    // Load document from database
    logger.info({ boardId, orgId }, 'Loading document from database');
    const ydoc = new Y.Doc();

    try {
      // Try loading from snapshot first
      const snapshot = await this.db.getLatestSnapshot(boardId);

      if (snapshot) {
        // Apply snapshot
        logger.debug({ boardId, snapshotId: snapshot.id }, 'Loading from snapshot');
        this.deserializeBoardDocument(snapshot.data, ydoc);

        // Apply any updates since snapshot
        const updates = await this.db.getYjsUpdates(boardId);
        for (const update of updates) {
          Y.applyUpdate(ydoc, update);
        }
      } else {
        // No snapshot, try loading from boards table
        const board = await this.db.getBoard(boardId);

        if (board) {
          logger.debug({ boardId }, 'Loading from boards table');
          this.deserializeBoardDocument(board.data, ydoc);
        } else {
          // New board, initialize with defaults
          logger.info({ boardId }, 'Creating new board');
          this.initializeNewBoard(ydoc, boardId, orgId);
        }
      }

      // Store document info
      docInfo = {
        ydoc,
        boardId,
        orgId,
        lastAccessTime: Date.now(),
        connectionCount: 1,
        updateClock: 0,
      };

      this.documents.set(boardId, docInfo);

      // Set up update handler to persist changes
      ydoc.on('update', (update: Uint8Array, origin: any) => {
        if (origin !== 'db-load') {
          this.handleUpdate(boardId, update).catch((err) => {
            logger.error({ err, boardId }, 'Failed to persist update');
          });
        }
      });

      // Start periodic snapshot timer
      this.startSnapshotTimer(boardId);

      logger.info({ boardId, entityCount: this.getEntityCount(ydoc) }, 'Document loaded');
      return ydoc;
    } catch (err) {
      logger.error({ err, boardId }, 'Failed to load document');
      throw err;
    }
  }

  /**
   * Release a connection to a document
   */
  releaseDocument(boardId: string): void {
    const docInfo = this.documents.get(boardId);
    if (!docInfo) return;

    docInfo.connectionCount--;
    logger.debug({ boardId, connections: docInfo.connectionCount }, 'Released document connection');

    if (docInfo.connectionCount <= 0) {
      // No more connections, start eviction timer
      this.startEvictionTimer(boardId);
    }
  }

  /**
   * Handle document update
   */
  private async handleUpdate(boardId: string, update: Uint8Array): Promise<void> {
    const docInfo = this.documents.get(boardId);
    if (!docInfo) return;

    // Persist update to database
    docInfo.updateClock++;
    await this.db.storeYjsUpdate(boardId, docInfo.orgId, docInfo.updateClock, update);
  }

  /**
   * Generate snapshot from Yjs document
   */
  async generateSnapshot(
    boardId: string,
    snapshotType: 'periodic' | 'on_run' | 'manual' = 'periodic'
  ): Promise<BoardSnapshot | null> {
    const docInfo = this.documents.get(boardId);
    if (!docInfo) {
      logger.warn({ boardId }, 'Cannot generate snapshot: document not loaded');
      return null;
    }

    try {
      const startTime = Date.now();
      const board = this.serializeBoardDocument(docInfo.ydoc);

      const snapshot: BoardSnapshot = {
        id: uuidv4(),
        boardId,
        orgId: docInfo.orgId,
        version: board.version,
        data: board,
        snapshotType,
        createdAt: new Date().toISOString(),
      };

      await this.db.storeSnapshot(snapshot);

      const duration = Date.now() - startTime;
      logger.info({ boardId, snapshotId: snapshot.id, duration, snapshotType }, 'Snapshot created');

      return snapshot;
    } catch (err) {
      logger.error({ err, boardId }, 'Failed to generate snapshot');
      throw err;
    }
  }

  /**
   * Serialize Yjs document to BoardDocument
   */
  serializeBoardDocument(ydoc: Y.Doc): BoardDocument {
    const boardMap = ydoc.getMap('board');

    const serializeEntity = <T>(ymap: Y.Map<any>): T => {
      const obj: any = {};
      ymap.forEach((value, key) => {
        if (value instanceof Y.Map) {
          obj[key] = {};
          value.forEach((v, k) => {
            obj[key][k] = v;
          });
        } else {
          obj[key] = value;
        }
      });
      return obj as T;
    };

    const serializeArray = <T>(yarray: Y.Array<Y.Map<any>>): T[] => {
      return yarray
        .toArray()
        .filter((item) => !item.get('deleted'))
        .map((item) => serializeEntity<T>(item));
    };

    return {
      id: boardMap.get('id') as string,
      orgId: boardMap.get('orgId') as string,
      ownerId: boardMap.get('ownerId') as string,
      version: boardMap.get('version') as number,
      createdAt: boardMap.get('createdAt') as string,
      updatedAt: new Date().toISOString(),
      title: boardMap.get('title') as string,
      description: boardMap.get('description') as string | undefined,
      goals: serializeArray(boardMap.get('goals') as Y.Array<Y.Map<any>>),
      options: serializeArray(boardMap.get('options') as Y.Array<Y.Map<any>>),
      outcomes: serializeArray(boardMap.get('outcomes') as Y.Array<Y.Map<any>>),
      assumptions: serializeArray(boardMap.get('assumptions') as Y.Array<Y.Map<any>>),
      evidence: serializeArray(boardMap.get('evidence') as Y.Array<Y.Map<any>>),
      edges: serializeArray(boardMap.get('edges') as Y.Array<Y.Map<any>>),
      layout: serializeEntity(boardMap.get('layout') as Y.Map<any>),
      tags: (boardMap.get('tags') as Y.Array<string>)?.toArray(),
      status: boardMap.get('status') as 'draft' | 'active' | 'archived',
    };
  }

  /**
   * Deserialize BoardDocument into Yjs document
   */
  deserializeBoardDocument(board: BoardDocument, ydoc: Y.Doc): void {
    ydoc.transact(() => {
      const boardMap = ydoc.getMap('board');

      boardMap.set('id', board.id);
      boardMap.set('orgId', board.orgId);
      boardMap.set('ownerId', board.ownerId);
      boardMap.set('version', board.version);
      boardMap.set('createdAt', board.createdAt);
      boardMap.set('updatedAt', board.updatedAt);
      boardMap.set('title', board.title);
      if (board.description) boardMap.set('description', board.description);
      boardMap.set('status', board.status);

      if (board.tags) {
        const tagsArray = new Y.Array<string>();
        tagsArray.push(board.tags);
        boardMap.set('tags', tagsArray);
      }

      const deserializeEntity = (entity: any): Y.Map<any> => {
        const ymap = new Y.Map();
        Object.entries(entity).forEach(([key, value]) => {
          if (key === 'position' && typeof value === 'object') {
            const posMap = new Y.Map();
            posMap.set('x', (value as any).x);
            posMap.set('y', (value as any).y);
            ymap.set(key, posMap);
          } else {
            ymap.set(key, value);
          }
        });
        ymap.set('deleted', false);
        return ymap;
      };

      const deserializeArray = <T>(entities: T[]): Y.Array<Y.Map<any>> => {
        const yarray = new Y.Array<Y.Map<any>>();
        entities.forEach((entity) => {
          yarray.push([deserializeEntity(entity)]);
        });
        return yarray;
      };

      boardMap.set('goals', deserializeArray(board.goals));
      boardMap.set('options', deserializeArray(board.options));
      boardMap.set('outcomes', deserializeArray(board.outcomes));
      boardMap.set('assumptions', deserializeArray(board.assumptions));
      boardMap.set('evidence', deserializeArray(board.evidence));
      boardMap.set('edges', deserializeArray(board.edges));

      const layoutMap = new Y.Map();
      layoutMap.set('zoom', board.layout.zoom);
      layoutMap.set('panX', board.layout.panX);
      layoutMap.set('panY', board.layout.panY);
      layoutMap.set('viewportWidth', board.layout.viewportWidth);
      layoutMap.set('viewportHeight', board.layout.viewportHeight);
      boardMap.set('layout', layoutMap);
    }, 'db-load');
  }

  /**
   * Initialize a new board
   */
  private initializeNewBoard(ydoc: Y.Doc, boardId: string, orgId: string): void {
    ydoc.transact(() => {
      const boardMap = ydoc.getMap('board');

      boardMap.set('id', boardId);
      boardMap.set('orgId', orgId);
      boardMap.set('ownerId', ''); // Will be set by first user
      boardMap.set('version', 1);
      boardMap.set('createdAt', new Date().toISOString());
      boardMap.set('updatedAt', new Date().toISOString());
      boardMap.set('title', 'New Decision Board');
      boardMap.set('status', 'draft');

      boardMap.set('goals', new Y.Array<Y.Map<any>>());
      boardMap.set('options', new Y.Array<Y.Map<any>>());
      boardMap.set('outcomes', new Y.Array<Y.Map<any>>());
      boardMap.set('assumptions', new Y.Array<Y.Map<any>>());
      boardMap.set('evidence', new Y.Array<Y.Map<any>>());
      boardMap.set('edges', new Y.Array<Y.Map<any>>());

      const layoutMap = new Y.Map();
      layoutMap.set('zoom', 1);
      layoutMap.set('panX', 0);
      layoutMap.set('panY', 0);
      layoutMap.set('viewportWidth', 1920);
      layoutMap.set('viewportHeight', 1080);
      boardMap.set('layout', layoutMap);
    }, 'db-load');
  }

  /**
   * Get entity count for metrics
   */
  private getEntityCount(ydoc: Y.Doc): number {
    const boardMap = ydoc.getMap('board');
    let count = 0;

    ['goals', 'options', 'outcomes', 'assumptions', 'evidence', 'edges'].forEach((key) => {
      const array = boardMap.get(key) as Y.Array<Y.Map<any>>;
      if (array) {
        count += array.toArray().filter((item) => !item.get('deleted')).length;
      }
    });

    return count;
  }

  /**
   * Start periodic snapshot timer
   */
  private startSnapshotTimer(boardId: string): void {
    const docInfo = this.documents.get(boardId);
    if (!docInfo) return;

    // Clear existing timer
    if (docInfo.snapshotTimer) {
      clearInterval(docInfo.snapshotTimer);
    }

    // Set new timer
    docInfo.snapshotTimer = setInterval(() => {
      if (docInfo.connectionCount > 0) {
        this.generateSnapshot(boardId, 'periodic').catch((err) => {
          logger.error({ err, boardId }, 'Periodic snapshot failed');
        });
      }
    }, config.limits.snapshotIntervalMs);
  }

  /**
   * Start eviction timer for inactive documents
   */
  private startEvictionTimer(boardId: string): void {
    const docInfo = this.documents.get(boardId);
    if (!docInfo) return;

    // Clear existing timer
    if (docInfo.evictionTimer) {
      clearTimeout(docInfo.evictionTimer);
    }

    // Set new timer
    docInfo.evictionTimer = setTimeout(() => {
      this.evictDocument(boardId).catch((err) => {
        logger.error({ err, boardId }, 'Document eviction failed');
      });
    }, config.limits.documentEvictionMs);
  }

  /**
   * Evict document from memory
   */
  private async evictDocument(boardId: string): Promise<void> {
    const docInfo = this.documents.get(boardId);
    if (!docInfo) return;

    // Double-check no active connections
    if (docInfo.connectionCount > 0) {
      logger.debug({ boardId }, 'Skipping eviction: active connections');
      return;
    }

    logger.info({ boardId }, 'Evicting document from memory');

    // Generate final snapshot
    await this.generateSnapshot(boardId, 'periodic');

    // Clear timers
    if (docInfo.snapshotTimer) clearInterval(docInfo.snapshotTimer);
    if (docInfo.evictionTimer) clearTimeout(docInfo.evictionTimer);

    // Remove from memory
    this.documents.delete(boardId);
  }

  /**
   * Periodic eviction loop
   */
  private startEvictionLoop(): void {
    setInterval(() => {
      const now = Date.now();
      const evictionThreshold = config.limits.documentEvictionMs;

      for (const [boardId, docInfo] of this.documents.entries()) {
        if (
          docInfo.connectionCount === 0 &&
          now - docInfo.lastAccessTime > evictionThreshold
        ) {
          this.evictDocument(boardId).catch((err) => {
            logger.error({ err, boardId }, 'Auto-eviction failed');
          });
        }
      }
    }, 60000); // Check every minute
  }

  /**
   * Get active document count
   */
  getActiveDocumentCount(): number {
    return this.documents.size;
  }

  /**
   * Restore a snapshot
   */
  async restoreSnapshot(
    boardId: string,
    snapshotId: string,
    userId: string
  ): Promise<void> {
    const docInfo = this.documents.get(boardId);
    if (!docInfo) {
      throw new Error('Document not loaded');
    }

    logger.info({ boardId, snapshotId, userId }, 'Restoring snapshot');

    // Get the snapshot to restore
    const snapshotToRestore = await this.snapshotManager.getSnapshot(snapshotId);
    if (!snapshotToRestore) {
      throw new Error('Snapshot not found');
    }

    // Get current board state and create "before restore" snapshot
    const currentBoard = this.serializeBoardDocument(docInfo.ydoc);
    await this.snapshotManager.createSnapshot(currentBoard, docInfo.orgId, {
      boardId,
      userId,
      name: `Before restore to ${snapshotToRestore.name || snapshotId}`,
      triggerType: 'manual',
    });

    // Apply the snapshot state to Yjs document
    const boardToRestore = snapshotToRestore.snapshot.board;
    docInfo.ydoc.transact(() => {
      this.deserializeBoardDocument(boardToRestore, docInfo.ydoc);
    });

    // Create "after restore" snapshot
    const restoredBoard = this.serializeBoardDocument(docInfo.ydoc);
    await this.snapshotManager.createSnapshot(restoredBoard, docInfo.orgId, {
      boardId,
      userId,
      name: `Restored from ${snapshotToRestore.name || snapshotId}`,
      triggerType: 'manual',
      parentSnapshotId: snapshotId,
    });

    logger.info({ boardId, snapshotId, userId }, 'Snapshot restored successfully');
  }

  /**
   * Get metrics
   */
  getMetrics() {
    const metrics = {
      activeDocuments: this.documents.size,
      totalConnections: 0,
      memoryBytes: 0,
    };

    for (const docInfo of this.documents.values()) {
      metrics.totalConnections += docInfo.connectionCount;
      // Rough estimate of memory usage
      metrics.memoryBytes += Y.encodeStateAsUpdate(docInfo.ydoc).byteLength;
    }

    return metrics;
  }

  /**
   * Shutdown - save all documents
   */
  async shutdown(): Promise<void> {
    logger.info('Shutting down document manager');

    const promises: Promise<void>[] = [];

    for (const [boardId] of this.documents.entries()) {
      promises.push(
        this.generateSnapshot(boardId, 'periodic').then(() => {
          const docInfo = this.documents.get(boardId);
          if (docInfo?.snapshotTimer) clearInterval(docInfo.snapshotTimer);
          if (docInfo?.evictionTimer) clearTimeout(docInfo.evictionTimer);
        })
      );
    }

    await Promise.all(promises);
    this.documents.clear();

    logger.info('Document manager shutdown complete');
  }
}
