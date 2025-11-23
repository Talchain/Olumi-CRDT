/**
 * Document manager tests
 */

import * as Y from 'yjs';
import { DocumentManager } from '../src/collab/document-manager';
import { DatabaseClient } from '../src/database/client';
import { BoardDocument } from '../src/types/board';

// Mock database client
jest.mock('../src/database/client');

describe('DocumentManager', () => {
  let documentManager: DocumentManager;
  let mockDb: jest.Mocked<DatabaseClient>;

  beforeEach(() => {
    mockDb = {
      getBoard: jest.fn(),
      getLatestSnapshot: jest.fn(),
      getYjsUpdates: jest.fn(),
      storeYjsUpdate: jest.fn(),
      storeSnapshot: jest.fn(),
    } as any;

    documentManager = new DocumentManager(mockDb);
  });

  afterEach(async () => {
    await documentManager.shutdown();
  });

  describe('getDocument', () => {
    it('should create a new document for new board', async () => {
      mockDb.getLatestSnapshot.mockResolvedValue(null);
      mockDb.getBoard.mockResolvedValue(null);
      mockDb.getYjsUpdates.mockResolvedValue([]);

      const ydoc = await documentManager.getDocument('board-123', 'org-456');

      expect(ydoc).toBeInstanceOf(Y.Doc);
      expect(mockDb.getLatestSnapshot).toHaveBeenCalledWith('board-123');
      expect(mockDb.getBoard).toHaveBeenCalledWith('board-123');
    });

    it('should load document from snapshot', async () => {
      const mockBoard: BoardDocument = {
        id: 'board-123',
        orgId: 'org-456',
        ownerId: 'user-789',
        version: 1,
        createdAt: '2025-01-01T00:00:00Z',
        updatedAt: '2025-01-01T00:00:00Z',
        title: 'Test Board',
        goals: [],
        options: [],
        outcomes: [],
        assumptions: [],
        evidence: [],
        edges: [],
        layout: { zoom: 1, panX: 0, panY: 0, viewportWidth: 1920, viewportHeight: 1080 },
        status: 'draft',
      };

      mockDb.getLatestSnapshot.mockResolvedValue({
        id: 'snapshot-1',
        boardId: 'board-123',
        orgId: 'org-456',
        version: 1,
        data: mockBoard,
        snapshotType: 'periodic',
        createdAt: '2025-01-01T00:00:00Z',
      });
      mockDb.getYjsUpdates.mockResolvedValue([]);

      const ydoc = await documentManager.getDocument('board-123', 'org-456');

      expect(ydoc).toBeInstanceOf(Y.Doc);

      const boardMap = ydoc.getMap('board');
      expect(boardMap.get('id')).toBe('board-123');
      expect(boardMap.get('title')).toBe('Test Board');
    });

    it('should reuse existing document', async () => {
      mockDb.getLatestSnapshot.mockResolvedValue(null);
      mockDb.getBoard.mockResolvedValue(null);
      mockDb.getYjsUpdates.mockResolvedValue([]);

      const ydoc1 = await documentManager.getDocument('board-123', 'org-456');
      const ydoc2 = await documentManager.getDocument('board-123', 'org-456');

      expect(ydoc1).toBe(ydoc2);
      expect(mockDb.getLatestSnapshot).toHaveBeenCalledTimes(1);
    });
  });

  describe('generateSnapshot', () => {
    it('should generate snapshot from Yjs document', async () => {
      mockDb.getLatestSnapshot.mockResolvedValue(null);
      mockDb.getBoard.mockResolvedValue(null);
      mockDb.getYjsUpdates.mockResolvedValue([]);

      const ydoc = await documentManager.getDocument('board-123', 'org-456');

      // Add some data
      ydoc.transact(() => {
        const boardMap = ydoc.getMap('board');
        const goals = boardMap.get('goals') as Y.Array<Y.Map<any>>;
        const goalMap = new Y.Map();
        goalMap.set('id', 'goal-1');
        goalMap.set('content', 'Test Goal');
        goalMap.set('priority', 'high');
        goalMap.set('position', new Y.Map([['x', 100], ['y', 200]]));
        goalMap.set('createdBy', 'user-1');
        goalMap.set('createdAt', '2025-01-01T00:00:00Z');
        goalMap.set('deleted', false);
        goals.push([goalMap]);
      });

      const snapshot = await documentManager.generateSnapshot('board-123', 'manual');

      expect(snapshot).not.toBeNull();
      expect(snapshot!.boardId).toBe('board-123');
      expect(snapshot!.orgId).toBe('org-456');
      expect(snapshot!.snapshotType).toBe('manual');
      expect(snapshot!.data.goals).toHaveLength(1);
      expect(snapshot!.data.goals[0].content).toBe('Test Goal');
      expect(mockDb.storeSnapshot).toHaveBeenCalled();
    });
  });

  describe('serializeBoardDocument', () => {
    it('should serialize Yjs document correctly', async () => {
      mockDb.getLatestSnapshot.mockResolvedValue(null);
      mockDb.getBoard.mockResolvedValue(null);
      mockDb.getYjsUpdates.mockResolvedValue([]);

      const ydoc = await documentManager.getDocument('board-123', 'org-456');

      const board = documentManager.serializeBoardDocument(ydoc);

      expect(board.id).toBe('board-123');
      expect(board.orgId).toBe('org-456');
      expect(board.goals).toEqual([]);
      expect(board.options).toEqual([]);
    });

    it('should filter out deleted entities', async () => {
      mockDb.getLatestSnapshot.mockResolvedValue(null);
      mockDb.getBoard.mockResolvedValue(null);
      mockDb.getYjsUpdates.mockResolvedValue([]);

      const ydoc = await documentManager.getDocument('board-123', 'org-456');

      ydoc.transact(() => {
        const boardMap = ydoc.getMap('board');
        const goals = boardMap.get('goals') as Y.Array<Y.Map<any>>;

        const goal1 = new Y.Map();
        goal1.set('id', 'goal-1');
        goal1.set('content', 'Active Goal');
        goal1.set('deleted', false);
        goals.push([goal1]);

        const goal2 = new Y.Map();
        goal2.set('id', 'goal-2');
        goal2.set('content', 'Deleted Goal');
        goal2.set('deleted', true);
        goals.push([goal2]);
      });

      const board = documentManager.serializeBoardDocument(ydoc);

      expect(board.goals).toHaveLength(1);
      expect(board.goals[0].id).toBe('goal-1');
    });
  });

  describe('releaseDocument', () => {
    it('should track connection count', async () => {
      mockDb.getLatestSnapshot.mockResolvedValue(null);
      mockDb.getBoard.mockResolvedValue(null);
      mockDb.getYjsUpdates.mockResolvedValue([]);

      await documentManager.getDocument('board-123', 'org-456');
      await documentManager.getDocument('board-123', 'org-456');

      documentManager.releaseDocument('board-123');

      const metrics = documentManager.getMetrics();
      expect(metrics.activeDocuments).toBe(1);
    });
  });
});
