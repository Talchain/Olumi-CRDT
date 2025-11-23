/**
 * React hooks for collaboration
 */

import { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import * as Y from 'yjs';
import { CollaborationProvider } from './provider';
import {
  CollaborationConfig,
  ConnectionStatus,
  BoardState,
  PresenceState,
  Goal,
  Option,
  Outcome,
  Assumption,
  Evidence,
  Edge,
} from './types';

/**
 * Main collaboration hook
 * Sets up Yjs document and WebSocket provider
 */
export function useCollaboration(config: CollaborationConfig) {
  const [ydoc] = useState(() => new Y.Doc());
  const [provider, setProvider] = useState<CollaborationProvider | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>(ConnectionStatus.DISCONNECTED);
  const [presence, setPresence] = useState<Map<number, PresenceState>>(new Map());

  useEffect(() => {
    const newProvider = new CollaborationProvider(config, ydoc);

    // Listen for status changes
    const unsubscribeStatus = newProvider.onStatusChange(setStatus);

    // Listen for awareness changes
    const unsubscribeAwareness = newProvider.onAwarenessChange(setPresence);

    // Connect
    newProvider.connect();

    setProvider(newProvider);

    return () => {
      unsubscribeStatus();
      unsubscribeAwareness();
      newProvider.destroy();
    };
  }, [config.serverUrl, config.boardId, config.authToken]);

  return {
    ydoc,
    provider,
    status,
    presence,
  };
}

/**
 * Hook to access board state from Yjs document
 */
export function useBoardState(ydoc: Y.Doc): BoardState | null {
  const [board, setBoard] = useState<BoardState | null>(null);

  useEffect(() => {
    const updateBoard = () => {
      const boardMap = ydoc.getMap('board');

      if (!boardMap.get('id')) {
        setBoard(null);
        return;
      }

      const serializeEntity = <T,>(ymap: Y.Map<any>): T => {
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

      const serializeArray = <T,>(yarray: Y.Array<Y.Map<any>>): T[] => {
        return yarray
          .toArray()
          .filter((item) => !item.get('deleted'))
          .map((item) => serializeEntity<T>(item));
      };

      setBoard({
        id: boardMap.get('id') as string,
        orgId: boardMap.get('orgId') as string,
        ownerId: boardMap.get('ownerId') as string,
        version: boardMap.get('version') as number,
        createdAt: boardMap.get('createdAt') as string,
        updatedAt: boardMap.get('updatedAt') as string,
        title: boardMap.get('title') as string,
        description: boardMap.get('description') as string | undefined,
        goals: serializeArray<Goal>(boardMap.get('goals') as Y.Array<Y.Map<any>>),
        options: serializeArray<Option>(boardMap.get('options') as Y.Array<Y.Map<any>>),
        outcomes: serializeArray<Outcome>(boardMap.get('outcomes') as Y.Array<Y.Map<any>>),
        assumptions: serializeArray<Assumption>(boardMap.get('assumptions') as Y.Array<Y.Map<any>>),
        evidence: serializeArray<Evidence>(boardMap.get('evidence') as Y.Array<Y.Map<any>>),
        edges: serializeArray<Edge>(boardMap.get('edges') as Y.Array<Y.Map<any>>),
        layout: serializeEntity(boardMap.get('layout') as Y.Map<any>),
        tags: (boardMap.get('tags') as Y.Array<string>)?.toArray(),
        status: boardMap.get('status') as 'draft' | 'active' | 'archived',
      });
    };

    // Initial load
    updateBoard();

    // Listen for updates
    ydoc.on('update', updateBoard);

    return () => {
      ydoc.off('update', updateBoard);
    };
  }, [ydoc]);

  return board;
}

/**
 * Hook to modify board entities
 */
export function useBoardActions(ydoc: Y.Doc) {
  const addGoal = useCallback(
    (goal: Omit<Goal, 'deleted'>) => {
      ydoc.transact(() => {
        const boardMap = ydoc.getMap('board');
        const goals = boardMap.get('goals') as Y.Array<Y.Map<any>>;

        const goalMap = new Y.Map();
        goalMap.set('id', goal.id);
        goalMap.set('content', goal.content);
        goalMap.set('priority', goal.priority);
        goalMap.set('createdBy', goal.createdBy);
        goalMap.set('createdAt', goal.createdAt);
        goalMap.set('deleted', false);

        const posMap = new Y.Map();
        posMap.set('x', goal.position.x);
        posMap.set('y', goal.position.y);
        goalMap.set('position', posMap);

        goals.push([goalMap]);
      });
    },
    [ydoc]
  );

  const updateGoal = useCallback(
    (id: string, updates: Partial<Goal>) => {
      ydoc.transact(() => {
        const boardMap = ydoc.getMap('board');
        const goals = boardMap.get('goals') as Y.Array<Y.Map<any>>;

        const goalIndex = goals.toArray().findIndex((g) => g.get('id') === id);
        if (goalIndex === -1) return;

        const goal = goals.get(goalIndex);

        Object.entries(updates).forEach(([key, value]) => {
          if (key === 'position' && value) {
            const posMap = goal.get('position') as Y.Map<any>;
            posMap.set('x', (value as any).x);
            posMap.set('y', (value as any).y);
          } else {
            goal.set(key, value);
          }
        });
      });
    },
    [ydoc]
  );

  const deleteGoal = useCallback(
    (id: string) => {
      ydoc.transact(() => {
        const boardMap = ydoc.getMap('board');
        const goals = boardMap.get('goals') as Y.Array<Y.Map<any>>;

        const goalIndex = goals.toArray().findIndex((g) => g.get('id') === id);
        if (goalIndex === -1) return;

        const goal = goals.get(goalIndex);
        goal.set('deleted', true);
      });
    },
    [ydoc]
  );

  // Similar functions for other entity types
  const addOption = useCallback(
    (option: Omit<Option, 'deleted'>) => {
      ydoc.transact(() => {
        const boardMap = ydoc.getMap('board');
        const options = boardMap.get('options') as Y.Array<Y.Map<any>>;

        const optionMap = new Y.Map();
        optionMap.set('id', option.id);
        optionMap.set('content', option.content);
        optionMap.set('description', option.description);
        optionMap.set('createdBy', option.createdBy);
        optionMap.set('createdAt', option.createdAt);
        optionMap.set('deleted', false);

        const posMap = new Y.Map();
        posMap.set('x', option.position.x);
        posMap.set('y', option.position.y);
        optionMap.set('position', posMap);

        options.push([optionMap]);
      });
    },
    [ydoc]
  );

  const updateBoardTitle = useCallback(
    (title: string) => {
      ydoc.transact(() => {
        const boardMap = ydoc.getMap('board');
        boardMap.set('title', title);
        boardMap.set('updatedAt', new Date().toISOString());
      });
    },
    [ydoc]
  );

  return {
    addGoal,
    updateGoal,
    deleteGoal,
    addOption,
    updateBoardTitle,
  };
}

/**
 * Hook to manage local awareness (cursor, selection)
 */
export function usePresence(provider: CollaborationProvider | null) {
  const updateCursor = useCallback(
    (x: number, y: number, entityId?: string) => {
      if (!provider) return;

      provider.updateAwareness({
        cursor: { x, y, entityId },
      });
    },
    [provider]
  );

  const updateSelection = useCallback(
    (entityIds: string[]) => {
      if (!provider) return;

      provider.updateAwareness({
        selection: { entityIds },
      });
    },
    [provider]
  );

  const clearCursor = useCallback(() => {
    if (!provider) return;

    provider.updateAwareness({
      cursor: undefined,
    });
  }, [provider]);

  return {
    updateCursor,
    updateSelection,
    clearCursor,
  };
}

/**
 * Hook to get list of connected users
 */
export function useConnectedUsers(presence: Map<number, PresenceState>) {
  return useMemo(() => {
    return Array.from(presence.values()).map((state) => state.user);
  }, [presence]);
}

/**
 * Hook for undo/redo functionality
 */
export function useUndoRedo(ydoc: Y.Doc) {
  const undoManagerRef = useRef<Y.UndoManager | null>(null);

  useEffect(() => {
    const boardMap = ydoc.getMap('board');

    undoManagerRef.current = new Y.UndoManager([boardMap], {
      trackedOrigins: new Set([ydoc.clientID]),
    });

    return () => {
      undoManagerRef.current?.destroy();
    };
  }, [ydoc]);

  const undo = useCallback(() => {
    undoManagerRef.current?.undo();
  }, []);

  const redo = useCallback(() => {
    undoManagerRef.current?.redo();
  }, []);

  const canUndo = useCallback(() => {
    return undoManagerRef.current?.canUndo() ?? false;
  }, []);

  const canRedo = useCallback(() => {
    return undoManagerRef.current?.canRedo() ?? false;
  }, []);

  return {
    undo,
    redo,
    canUndo,
    canRedo,
  };
}
