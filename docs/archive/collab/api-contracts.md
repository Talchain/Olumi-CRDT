# Collaboration API Contracts

## Overview

This document defines the WebSocket and REST API contracts for the Olumi real-time collaboration service.

---

## WebSocket API

### Connection Endpoint

```
ws(s)://[host]/api/collab/boards/:boardId
```

**Query Parameters**:
- `token` (required): JWT authentication token

**Example**:
```
wss://collab.olumi.ai/api/collab/boards/550e8400-e29b-41d4-a716-446655440000?token=eyJhbGc...
```

### Authentication

**JWT Payload**:
```typescript
interface JWTPayload {
  userId: string;
  orgId: string;
  email: string;
  roles: string[];
  exp: number;  // Expiration timestamp
  iat: number;  // Issued at timestamp
}
```

**Validation**:
1. Token must be valid and not expired
2. User must belong to the board's organization
3. User must have at least 'member' role

**Error Responses**:
- `4401 Unauthorized`: Invalid or missing token
- `4403 Forbidden`: User lacks access to board
- `4404 Not Found`: Board does not exist

### Message Protocol

The collaboration service uses the Yjs WebSocket protocol with custom extensions.

#### Message Types

##### 1. Sync Messages (Yjs Protocol)

**Sync Step 1 (Client → Server)**:
```typescript
{
  type: 'sync',
  messageType: 0, // YjsSyncMessageType.SyncStep1
  stateVector: Uint8Array
}
```

**Sync Step 2 (Server → Client)**:
```typescript
{
  type: 'sync',
  messageType: 1, // YjsSyncMessageType.SyncStep2
  update: Uint8Array
}
```

**Update (Bidirectional)**:
```typescript
{
  type: 'sync',
  messageType: 2, // YjsSyncMessageType.Update
  update: Uint8Array
}
```

##### 2. Awareness Messages (Presence)

**Awareness Update (Bidirectional)**:
```typescript
{
  type: 'awareness',
  clients: {
    [clientId: number]: {
      user: {
        id: string;
        name: string;
        email: string;
        color: string;  // Hex color for presence indicators
        avatarUrl?: string;
      };
      cursor?: {
        x: number;
        y: number;
        entityId?: string;  // If hovering/editing an entity
      };
      selection?: {
        entityIds: string[];  // Currently selected entities
      };
      lastSeen: number;  // Timestamp
    };
  };
  removed: number[];  // Client IDs that disconnected
}
```

##### 3. Custom Control Messages

**Join Notification (Server → All)**:
```typescript
{
  type: 'control',
  action: 'user_joined',
  data: {
    userId: string;
    userName: string;
    timestamp: string;
  }
}
```

**Leave Notification (Server → All)**:
```typescript
{
  type: 'control',
  action: 'user_left',
  data: {
    userId: string;
    userName: string;
    timestamp: string;
  }
}
```

**Snapshot Created (Server → All)**:
```typescript
{
  type: 'control',
  action: 'snapshot_created',
  data: {
    snapshotId: string;
    timestamp: string;
    triggeredBy: 'periodic' | 'manual' | 'run';
  }
}
```

**Error (Server → Client)**:
```typescript
{
  type: 'error',
  code: string;  // Error code (see below)
  message: string;
  details?: any;
}
```

##### 4. Ping/Pong (Keepalive)

**Ping (Server → Client)**:
```typescript
{
  type: 'ping',
  timestamp: number;
}
```

**Pong (Client → Server)**:
```typescript
{
  type: 'pong',
  timestamp: number;
}
```

### Error Codes

| Code                    | Description                                |
|-------------------------|--------------------------------------------|
| `AUTH_INVALID`          | Token invalid or expired                   |
| `AUTH_FORBIDDEN`        | User lacks permission                      |
| `BOARD_NOT_FOUND`       | Board does not exist                       |
| `BOARD_LOCKED`          | Board is locked for editing                |
| `ORG_MISMATCH`          | Board belongs to different organization    |
| `RATE_LIMIT_EXCEEDED`   | Too many updates                           |
| `PAYLOAD_TOO_LARGE`     | Update exceeds size limit                  |
| `INVALID_MESSAGE`       | Malformed message                          |
| `SYNC_FAILED`           | Synchronization error                      |
| `SERVER_ERROR`          | Internal server error                      |

---

## REST API

### Snapshot Endpoints

#### Get Latest Snapshot

```
GET /api/collab/boards/:boardId/snapshot
```

**Headers**:
- `Authorization: Bearer {jwt}`

**Response** (200 OK):
```json
{
  "success": true,
  "data": {
    "id": "snapshot-uuid",
    "boardId": "board-uuid",
    "version": 1,
    "createdAt": "2025-11-22T10:30:00Z",
    "board": {
      "id": "board-uuid",
      "orgId": "org-uuid",
      "ownerId": "user-uuid",
      "title": "Q4 Strategy Decision",
      "goals": [...],
      "options": [...],
      "outcomes": [...],
      "assumptions": [...],
      "evidence": [...],
      "edges": [...],
      "layout": {...}
    }
  }
}
```

**Errors**:
- `401 Unauthorized`: Invalid token
- `403 Forbidden`: Access denied
- `404 Not Found`: Board not found

#### Create Snapshot

```
POST /api/collab/boards/:boardId/snapshot
```

**Headers**:
- `Authorization: Bearer {jwt}`

**Request Body** (optional):
```json
{
  "type": "manual",
  "reason": "Before major refactoring"
}
```

**Response** (201 Created):
```json
{
  "success": true,
  "data": {
    "id": "snapshot-uuid",
    "boardId": "board-uuid",
    "createdAt": "2025-11-22T10:35:00Z"
  }
}
```

### Status Endpoints

#### Board Collaboration Status

```
GET /api/collab/boards/:boardId/status
```

**Headers**:
- `Authorization: Bearer {jwt}`

**Response** (200 OK):
```json
{
  "success": true,
  "data": {
    "boardId": "board-uuid",
    "isActive": true,
    "connectedUsers": [
      {
        "userId": "user-1",
        "userName": "Alice Smith",
        "connectedAt": "2025-11-22T10:00:00Z"
      },
      {
        "userId": "user-2",
        "userName": "Bob Jones",
        "connectedAt": "2025-11-22T10:15:00Z"
      }
    ],
    "lastUpdate": "2025-11-22T10:34:50Z",
    "updateCount": 47,
    "lastSnapshot": "2025-11-22T10:30:00Z"
  }
}
```

#### Service Health

```
GET /api/collab/health
```

**Response** (200 OK):
```json
{
  "status": "healthy",
  "timestamp": "2025-11-22T10:35:00Z",
  "metrics": {
    "activeConnections": 23,
    "activeBoards": 8,
    "memoryUsageMB": 156,
    "uptimeSeconds": 86400
  }
}
```

### Admin Endpoints

#### List Active Boards

```
GET /api/collab/admin/boards
```

**Headers**:
- `Authorization: Bearer {admin_jwt}`

**Query Parameters**:
- `orgId` (optional): Filter by organization

**Response** (200 OK):
```json
{
  "success": true,
  "data": [
    {
      "boardId": "board-1",
      "orgId": "org-1",
      "connectedUsers": 3,
      "lastUpdate": "2025-11-22T10:34:50Z",
      "memoryBytes": 24576
    }
  ]
}
```

#### Force Snapshot All Boards

```
POST /api/collab/admin/snapshot-all
```

**Headers**:
- `Authorization: Bearer {admin_jwt}`

**Response** (200 OK):
```json
{
  "success": true,
  "data": {
    "snapshotsCreated": 8,
    "duration": "1.2s"
  }
}
```

---

## Rate Limits

### Per User
- **WebSocket connections**: 10 concurrent connections
- **Updates per second**: 50 updates/sec
- **Snapshot requests**: 10 per minute

### Per Organization
- **Concurrent boards**: 100 active boards
- **Total connections**: 500 concurrent connections
- **Storage**: 10 GB Yjs updates per org

### Enforcement

When rate limit exceeded:
- WebSocket: Send error message, do not close connection (unless severe)
- REST: Return `429 Too Many Requests` with retry-after header

---

## Wire Protocol Details

### Binary Encoding

All Yjs sync messages use binary encoding for efficiency:

```typescript
// Message format
[messageType: 1 byte] [payload: variable bytes]

// Message types
const MESSAGE_SYNC = 0x00;
const MESSAGE_AWARENESS = 0x01;
const MESSAGE_CONTROL = 0x02;
const MESSAGE_PING = 0x03;
const MESSAGE_PONG = 0x04;

// Sync sub-types
const SYNC_STEP1 = 0x00;
const SYNC_STEP2 = 0x01;
const SYNC_UPDATE = 0x02;
```

### Compression

- Updates larger than 1KB are compressed with gzip
- Compression flag in first byte: `0x80 | messageType`

### Chunking

- Large updates (>64KB) are split into chunks
- Chunk header: `[chunkId: 2 bytes] [totalChunks: 2 bytes] [payload]`

---

## Client Implementation Guidelines

### Connection Lifecycle

```typescript
// 1. Initialize Yjs document
const ydoc = new Y.Doc();

// 2. Connect to WebSocket
const provider = new CustomWebSocketProvider(
  'wss://collab.olumi.ai/api/collab/boards/board-123',
  ydoc,
  {
    params: { token: authToken },
    awareness: new Awareness(ydoc),
  }
);

// 3. Set awareness state
provider.awareness.setLocalStateField('user', {
  id: currentUser.id,
  name: currentUser.name,
  email: currentUser.email,
  color: assignedColor,
});

// 4. Listen for sync
provider.on('sync', (isSynced) => {
  if (isSynced) {
    console.log('Fully synced with server');
  }
});

// 5. Listen for awareness changes
provider.awareness.on('change', ({ added, updated, removed }) => {
  updatePresenceUI(provider.awareness.getStates());
});

// 6. Make changes
ydoc.transact(() => {
  const boardMap = ydoc.getMap('board');
  const goals = boardMap.get('goals');
  // ... modify data
});

// 7. Disconnect
provider.destroy();
```

### Error Handling

```typescript
provider.on('connection-error', (error) => {
  console.error('Connection error:', error);
  showErrorBanner('Connection lost. Retrying...');
});

provider.on('connection-close', ({ code, reason }) => {
  if (code === 4403) {
    showErrorModal('You do not have access to this board');
    redirect('/boards');
  } else if (code >= 4000 && code < 5000) {
    // Client error, don't retry
    showErrorModal(reason);
  } else {
    // Server error or network issue, retry
    scheduleReconnect();
  }
});
```

### Reconnection Strategy

```typescript
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 10;

function scheduleReconnect() {
  if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
    showErrorModal('Unable to reconnect. Please refresh the page.');
    return;
  }

  const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), 30000);
  reconnectAttempts++;

  setTimeout(() => {
    console.log(`Reconnect attempt ${reconnectAttempts}...`);
    provider.connect();
  }, delay);
}

provider.on('sync', () => {
  reconnectAttempts = 0; // Reset on successful sync
});
```

---

## Security Considerations

### Token Refresh

Tokens expire after 1 hour. Clients must:
1. Monitor token expiration
2. Request new token before expiration
3. Disconnect and reconnect with new token
4. Server gracefully handles mid-session token refresh

### Cross-Origin Requests

CORS headers for WebSocket upgrade:
```
Access-Control-Allow-Origin: https://app.olumi.ai
Access-Control-Allow-Credentials: true
```

### Content Validation

Server validates all updates:
- Entity IDs are valid UUIDs
- Entity types are allowed
- No script injection in text fields
- Array operations don't exceed limits

Invalid updates are rejected with error message.

### Privacy

- No logging of board content (only metadata)
- Awareness data (names, emails) only shared within board session
- Snapshots encrypted at rest
- Yjs updates encrypted at rest

---

## Versioning

API version: `v1`

Version strategy:
- Breaking changes: New version (`v2`)
- Non-breaking additions: Same version
- Deprecation: 90-day notice

Current version included in all endpoints:
```
/api/collab/v1/boards/:boardId/snapshot
```

WebSocket endpoint includes version in path:
```
wss://[host]/api/collab/v1/boards/:boardId
```

---

## Examples

### Full Client Session

```typescript
import * as Y from 'yjs';
import { Awareness } from 'y-protocols/awareness';

// Initialize
const boardId = 'board-123';
const authToken = localStorage.getItem('auth_token');
const ydoc = new Y.Doc();
const awareness = new Awareness(ydoc);

// WebSocket URL
const wsUrl = `wss://collab.olumi.ai/api/collab/v1/boards/${boardId}?token=${authToken}`;

// Connect (using custom provider or y-websocket)
const ws = new WebSocket(wsUrl);

ws.onopen = () => {
  console.log('Connected');

  // Send sync step 1
  const stateVector = Y.encodeStateVector(ydoc);
  const syncMessage = createSyncMessage(SYNC_STEP1, stateVector);
  ws.send(syncMessage);

  // Set awareness
  awareness.setLocalStateField('user', {
    id: 'user-456',
    name: 'Alice Smith',
    email: 'alice@example.com',
    color: '#3b82f6',
  });

  // Broadcast awareness
  const awarenessUpdate = awarenessProtocol.encodeAwarenessUpdate(
    awareness,
    [ydoc.clientID]
  );
  ws.send(createAwarenessMessage(awarenessUpdate));
};

ws.onmessage = (event) => {
  const message = parseMessage(event.data);

  if (message.type === 'sync') {
    if (message.messageType === SYNC_STEP2) {
      // Apply server state
      Y.applyUpdate(ydoc, message.update);
    } else if (message.messageType === SYNC_UPDATE) {
      // Apply incremental update
      Y.applyUpdate(ydoc, message.update);
    }
  } else if (message.type === 'awareness') {
    awarenessProtocol.applyAwarenessUpdate(awareness, message.update);
  }
};

ws.onerror = (error) => {
  console.error('WebSocket error:', error);
};

ws.onclose = (event) => {
  console.log('Disconnected:', event.code, event.reason);
  scheduleReconnect();
};

// Listen for local changes
ydoc.on('update', (update, origin) => {
  if (origin !== 'server') {
    // Send to server
    const syncMessage = createSyncMessage(SYNC_UPDATE, update);
    ws.send(syncMessage);
  }
});

// Make a change
ydoc.transact(() => {
  const boardMap = ydoc.getMap('board');
  const goals = boardMap.get('goals') as Y.Array<Y.Map<any>>;

  const newGoal = new Y.Map();
  newGoal.set('id', generateUUID());
  newGoal.set('content', 'Increase market share');
  newGoal.set('priority', 'high');
  newGoal.set('position', new Y.Map([['x', 100], ['y', 200]]));
  newGoal.set('createdBy', 'user-456');
  newGoal.set('createdAt', new Date().toISOString());
  newGoal.set('deleted', false);

  goals.push([newGoal]);
});
```

---

**Document Version**: 1.0
**Last Updated**: 2025-11-22
**Status**: Approved for Implementation
