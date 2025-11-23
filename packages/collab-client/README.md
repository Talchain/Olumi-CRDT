# Olumi Collaboration Client

React client library for real-time collaborative editing of Olumi decision boards.

## Installation

```bash
npm install @olumi/collab-client yjs
```

## Quick Start

```tsx
import React from 'react';
import {
  useCollaboration,
  useBoardState,
  useBoardActions,
  useConnectedUsers,
  CollaborationBar,
  ConnectionBanner,
} from '@olumi/collab-client';

function BoardEditor() {
  const { ydoc, provider, status, presence } = useCollaboration({
    serverUrl: 'wss://collab.olumi.ai',
    boardId: 'board-123',
    authToken: 'your-jwt-token',
    currentUser: {
      id: 'user-456',
      name: 'Alice Smith',
      email: 'alice@example.com',
      color: '#3b82f6',
    },
  });

  const board = useBoardState(ydoc);
  const { addGoal, updateBoardTitle } = useBoardActions(ydoc);
  const connectedUsers = useConnectedUsers(presence);

  if (!board) {
    return <div>Loading...</div>;
  }

  return (
    <div>
      <ConnectionBanner status={status} />
      <CollaborationBar users={connectedUsers} status={status} />

      <div className="p-4">
        <h1>{board.title}</h1>

        <div>
          <h2>Goals</h2>
          {board.goals.map((goal) => (
            <div key={goal.id}>{goal.content}</div>
          ))}
        </div>

        <button
          onClick={() => {
            addGoal({
              id: 'goal-' + Date.now(),
              content: 'New Goal',
              priority: 'medium',
              position: { x: 100, y: 100 },
              createdBy: 'user-456',
              createdAt: new Date().toISOString(),
            });
          }}
        >
          Add Goal
        </button>
      </div>
    </div>
  );
}
```

## API

### Hooks

#### `useCollaboration(config)`

Main hook to set up collaboration.

**Parameters:**
- `config`: CollaborationConfig object

**Returns:**
- `ydoc`: Yjs document
- `provider`: Collaboration provider
- `status`: Connection status
- `presence`: Map of presence states

#### `useBoardState(ydoc)`

Get current board state from Yjs document.

**Parameters:**
- `ydoc`: Yjs document

**Returns:**
- `board`: BoardState object or null

#### `useBoardActions(ydoc)`

Get actions to modify board entities.

**Parameters:**
- `ydoc`: Yjs document

**Returns:**
- `addGoal(goal)`: Add a goal
- `updateGoal(id, updates)`: Update a goal
- `deleteGoal(id)`: Delete a goal
- `addOption(option)`: Add an option
- `updateBoardTitle(title)`: Update board title

#### `usePresence(provider)`

Manage local presence (cursor, selection).

**Parameters:**
- `provider`: Collaboration provider

**Returns:**
- `updateCursor(x, y, entityId?)`: Update cursor position
- `updateSelection(entityIds)`: Update selected entities
- `clearCursor()`: Clear cursor

#### `useConnectedUsers(presence)`

Get list of connected users.

**Parameters:**
- `presence`: Map of presence states

**Returns:**
- Array of User objects

#### `useUndoRedo(ydoc)`

Undo/redo functionality.

**Parameters:**
- `ydoc`: Yjs document

**Returns:**
- `undo()`: Undo last change
- `redo()`: Redo last undone change
- `canUndo()`: Whether undo is available
- `canRedo()`: Whether redo is available

### Components

#### `<CollaborationBar>`

Shows connected users and connection status.

**Props:**
- `users`: Array of User objects
- `status`: ConnectionStatus
- `className?`: Optional CSS class

#### `<ConnectionBanner>`

Shows connection errors and reconnection status.

**Props:**
- `status`: ConnectionStatus
- `errorMessage?`: Optional error message
- `onDismiss?`: Optional dismiss callback

#### `<SelectionIndicator>`

Shows remote user selections on entities.

**Props:**
- `entityId`: ID of the entity
- `presence`: Map of presence states
- `currentClientId`: Current client ID

### Engine Integration

```tsx
import { EngineClient, transformToRunInput } from '@olumi/collab-client';

const engine = new EngineClient('https://api.olumi.ai', authToken);

// Run analysis
const result = await engine.runAnalysis(boardId);

// Or manually transform and call
const board = useBoardState(ydoc);
const runInput = transformToRunInput(board);
// ... call engine with runInput
```

## License

Proprietary - Olumi
