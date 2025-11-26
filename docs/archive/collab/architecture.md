# Real-time Collaboration Architecture

## Executive Summary

This document defines the architecture for real-time collaborative editing of Olumi decision boards using Conflict-free Replicated Data Types (CRDTs). The solution enables multiple users to simultaneously edit the same board with automatic conflict resolution, presence awareness, and seamless integration with the existing PLoT engine.

**Key Principles:**
- **Non-invasive**: Existing engine and ISL contracts remain unchanged
- **Feature-flagged**: Collaboration is opt-in via `REALTIME_COLLAB` flag
- **Secure**: Multi-tenant isolation, authentication, and authorization enforced
- **Deterministic**: Engine runs use immutable snapshots
- **Scalable**: Designed for 10-20 concurrent editors per board

---

## Architecture Overview

### Component Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                         Client Layer                            │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │  Scenario Sandbox UI (React + TypeScript)                  │ │
│  │  ┌─────────────────┐  ┌──────────────────┐                │ │
│  │  │ Board State     │  │ Collaboration    │                │ │
│  │  │ Management      │  │ UI Components    │                │ │
│  │  │ (Yjs-backed)    │  │ (Presence, etc.) │                │ │
│  │  └────────┬────────┘  └──────────────────┘                │ │
│  └───────────┼──────────────────────────────────────────────── │ │
│              │                                                   │
│              │ WebSocket (Yjs Protocol)                         │
└──────────────┼───────────────────────────────────────────────────┘
               │
               ▼
┌──────────────────────────────────────────────────────────────────┐
│                   Collaboration Service                          │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │  WebSocket Server (ws or y-websocket)                      │ │
│  │  ┌──────────────┐  ┌──────────────┐  ┌─────────────────┐ │ │
│  │  │ Auth &       │  │ Document     │  │ Presence        │ │ │
│  │  │ Authorization│  │ Management   │  │ Management      │ │ │
│  │  └──────┬───────┘  └──────┬───────┘  └────────┬────────┘ │ │
│  └─────────┼──────────────────┼───────────────────┼──────────┘ │
│            │                  │                   │            │
│  ┌─────────┼──────────────────┼───────────────────┼──────────┐ │
│  │         ▼                  ▼                   ▼          │ │
│  │  ┌────────────┐  ┌───────────────┐  ┌──────────────────┐ │ │
│  │  │ Yjs Docs   │  │ Snapshot      │  │ Awareness State  │ │ │
│  │  │ (in-memory)│  │ Generator     │  │ (ephemeral)      │ │ │
│  │  └─────┬──────┘  └───────┬───────┘  └──────────────────┘ │ │
│  └────────┼─────────────────┼──────────────────────────────── │ │
└───────────┼─────────────────┼────────────────────────────────────┘
            │                 │
            │                 │ Snapshot API
            ▼                 ▼
┌──────────────────────────────────────────────────────────────────┐
│                     Persistence Layer                            │
│  ┌────────────────────────┐  ┌────────────────────────────────┐ │
│  │  Yjs Update Log        │  │  Board Snapshots               │ │
│  │  (PostgreSQL JSONB)    │  │  (PostgreSQL JSONB)            │ │
│  │  - Incremental updates │  │  - Periodic snapshots          │ │
│  │  - Append-only         │  │  - On-demand snapshots         │ │
│  │  - Pruned periodically │  │  - Used for engine runs        │ │
│  └────────────────────────┘  └────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────┘
                              │
                              │ Snapshot fetch
                              ▼
┌──────────────────────────────────────────────────────────────────┐
│                        Engine Layer                              │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │  PLoT Engine Service (plot-lite-service)                   │ │
│  │  POST /v1/run                                              │ │
│  │  - Receives BoardRunInput (immutable snapshot)             │ │
│  │  - Runs analysis                                           │ │
│  │  - Returns EngineResult                                    │ │
│  └────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────┘
```

---

## Technology Stack

### CRDT Library: Yjs

**Chosen Technology**: [Yjs](https://github.com/yjs/yjs) v13.x

**Justification**:
1. **Mature and battle-tested**: Used by Figma, Jupyter, VSCode Live Share
2. **Excellent performance**: Optimized for real-time collaboration
3. **Rich ecosystem**: y-websocket, y-protocols, awareness, undo/redo
4. **TypeScript support**: First-class TypeScript definitions
5. **Flexible persistence**: Multiple storage backends supported
6. **Small bundle size**: ~10KB gzipped for client

**Alternatives Considered**:
- Automerge: Heavier, less optimized for web
- ShareDB: OT-based, not true CRDT
- Gun.js: Less mature, graph-focused

### WebSocket Implementation

**Option A: Custom WebSocket Server** ✅ **CHOSEN**

- Build on top of Node.js `ws` library
- Full control over auth, routing, error handling
- Easier integration with existing infrastructure
- Direct Yjs integration via `y-websocket/bin/utils`

**Option B: y-websocket Server**

- Ready-made server from Yjs ecosystem
- Less flexibility for custom auth/authorization
- Would require forking or wrapping

**Decision**: Option A (Custom WebSocket Server)
- Allows integration with existing auth middleware
- Easier to add metrics, logging, and custom logic
- Can reuse existing infrastructure (load balancers, proxies)

---

## Deployment Strategy

### Hosting the Collaboration Layer

**Option A: Standalone Service (olumi-collab-service)** ✅ **CHOSEN**

**Pros**:
- Clear separation of concerns
- Independent scaling (collaboration has different load profile)
- Can use stateful deployment for WebSocket connections
- Easier to replace or upgrade without touching main API

**Cons**:
- Additional deployment complexity
- Network hop for snapshot fetching

**Option B: Module in Existing API**

**Pros**:
- Simpler deployment
- Shared database connection pool
- No network hop for persistence

**Cons**:
- Stateful WebSocket connections mixed with stateless API
- Harder to scale independently
- Increases complexity of main API service

**Decision**: Option A (Standalone Service)
- Better architectural separation
- WebSocket connections are fundamentally different from REST
- Allows sticky sessions at load balancer level
- Can be deployed in different regions if needed

---

## Data Model

### Yjs Document Structure

Each board is represented as a Yjs document with the following structure:

```typescript
// Root document
const ydoc = new Y.Doc();

// Top-level map
const boardMap = ydoc.getMap('board');

// Structure
boardMap.set('id', string);
boardMap.set('orgId', string);
boardMap.set('ownerId', string);
boardMap.set('version', number);
boardMap.set('createdAt', string);
boardMap.set('updatedAt', string);
boardMap.set('title', string);
boardMap.set('description', string);
boardMap.set('status', string);
boardMap.set('tags', Y.Array<string>);

// Entity arrays
boardMap.set('goals', Y.Array<Y.Map>);
boardMap.set('options', Y.Array<Y.Map>);
boardMap.set('outcomes', Y.Array<Y.Map>);
boardMap.set('assumptions', Y.Array<Y.Map>);
boardMap.set('evidence', Y.Array<Y.Map>);
boardMap.set('edges', Y.Array<Y.Map>);

// Layout
const layoutMap = new Y.Map();
layoutMap.set('zoom', number);
layoutMap.set('panX', number);
layoutMap.set('panY', number);
layoutMap.set('viewportWidth', number);
layoutMap.set('viewportHeight', number);
boardMap.set('layout', layoutMap);
```

### Entity Representation

Each entity (goal, option, etc.) is a Y.Map:

```typescript
const goal = new Y.Map();
goal.set('id', 'goal-uuid');
goal.set('content', 'Maximize revenue');
goal.set('priority', 'high');
goal.set('position', new Y.Map([['x', 100], ['y', 200]]));
goal.set('createdBy', 'user-id');
goal.set('createdAt', '2025-11-22T...');
goal.set('deleted', false); // Tombstone for soft delete
```

### Serialization

```typescript
// Yjs → JSON
function serializeBoardDocument(ydoc: Y.Doc): BoardDocument {
  const boardMap = ydoc.getMap('board');
  return {
    id: boardMap.get('id') as string,
    orgId: boardMap.get('orgId') as string,
    // ... extract all fields
    goals: (boardMap.get('goals') as Y.Array<Y.Map>)
      .toArray()
      .filter(g => !g.get('deleted'))
      .map(g => ({
        id: g.get('id'),
        content: g.get('content'),
        // ...
      })),
    // ... other entities
  };
}

// JSON → Yjs
function deserializeBoardDocument(board: BoardDocument, ydoc: Y.Doc): void {
  const boardMap = ydoc.getMap('board');
  ydoc.transact(() => {
    boardMap.set('id', board.id);
    boardMap.set('orgId', board.orgId);
    // ... set all fields

    const goalsArray = new Y.Array<Y.Map>();
    board.goals.forEach(goal => {
      const goalMap = new Y.Map();
      goalMap.set('id', goal.id);
      goalMap.set('content', goal.content);
      // ... set all fields
      goalsArray.push([goalMap]);
    });
    boardMap.set('goals', goalsArray);
    // ... other entities
  });
}
```

---

## Collaboration Flow

### 1. User Joins a Board

```
Client                  Collab Service           Database
  │                           │                      │
  │ WebSocket Connect         │                      │
  │ ws://server/collab/:id    │                      │
  ├──────────────────────────>│                      │
  │                           │                      │
  │                           │ Verify JWT           │
  │                           │ Check board access   │
  │                           ├─────────────────────>│
  │                           │<─────────────────────┤
  │                           │ Load Yjs document    │
  │                           │ (from cache or DB)   │
  │                           │                      │
  │<──────────────────────────┤                      │
  │ Sync step 1 (state vector)│                      │
  │                           │                      │
  │<──────────────────────────┤                      │
  │ Sync step 2 (missing updates)                    │
  │                           │                      │
  │ Send awareness (presence) │                      │
  ├──────────────────────────>│                      │
  │                           │ Broadcast to others  │
  │                           │                      │
```

### 2. User Edits the Board

```
Client A                Collab Service           Client B
  │                           │                      │
  │ Edit (add goal)           │                      │
  │ - Local Yjs update        │                      │
  │ - Optimistic UI update    │                      │
  │                           │                      │
  │ Send update               │                      │
  ├──────────────────────────>│                      │
  │                           │                      │
  │                           │ Apply to shared doc  │
  │                           │ Persist update (async)
  │                           │                      │
  │                           │ Broadcast update     │
  │                           ├─────────────────────>│
  │                           │                      │
  │                           │                      │ Apply update
  │                           │                      │ Update UI
  │                           │                      │
```

### 3. Concurrent Edits (Conflict Resolution)

```
Client A                Collab Service           Client B
  │                           │                      │
  │ Edit goal.content="X"     │                      │
  ├──────────────────────────>│                      │
  │                           │                      │ Edit goal.content="Y"
  │                           │<─────────────────────┤
  │                           │                      │
  │                           │ CRDT merge:          │
  │                           │ Last-write-wins      │
  │                           │ (by timestamp)       │
  │                           │                      │
  │                           │ Broadcast merged     │
  │<──────────────────────────┤ state to both        │
  │                           ├─────────────────────>│
  │                           │                      │
  │ Update UI with merged     │                      │ Update UI with merged
  │ state                     │                      │ state
```

### 4. Engine Run (Snapshot Extraction)

```
Client                  Collab Service           Engine
  │                           │                      │
  │ Trigger run               │                      │
  ├──────────────────────────>│                      │
  │                           │                      │
  │                           │ Generate snapshot    │
  │                           │ (Yjs → BoardRunInput)│
  │                           │                      │
  │                           │ Store snapshot w/ ID │
  │                           │                      │
  │                           │ POST /v1/run         │
  │                           ├─────────────────────>│
  │                           │<─────────────────────┤
  │                           │ { runId, status }    │
  │<──────────────────────────┤                      │
  │ { runId, snapshotId }     │                      │
  │                           │                      │
  │                           │                      │ Process
  │                           │                      │ (using snapshot)
  │                           │                      │
  │ Poll for results          │                      │
  ├──────────────────────────>│                      │
  │                           │ GET /v1/status/:runId│
  │                           ├─────────────────────>│
  │                           │<─────────────────────┤
  │<──────────────────────────┤                      │
  │ { result }                │                      │
```

---

## Persistence Strategy

### Dual Storage Model

We maintain two storage mechanisms:

#### 1. Yjs Update Log (Incremental)

- **Purpose**: Fast synchronization and recovery
- **Storage**: PostgreSQL table `yjs_updates`
- **Schema**:
  ```sql
  CREATE TABLE yjs_updates (
    id SERIAL PRIMARY KEY,
    board_id UUID NOT NULL,
    org_id UUID NOT NULL,
    clock INTEGER NOT NULL,
    update BYTEA NOT NULL,
    created_at TIMESTAMP DEFAULT NOW(),
    INDEX idx_board_clock (board_id, clock),
    INDEX idx_org_board (org_id, board_id)
  );
  ```
- **Pruning**: Updates older than 7 days are compacted into snapshot
- **Size**: Bounded by pruning policy

#### 2. Board Snapshots (Full State)

- **Purpose**: Engine runs, fast load, backup
- **Storage**: PostgreSQL table `board_snapshots`
- **Schema**:
  ```sql
  CREATE TABLE board_snapshots (
    id UUID PRIMARY KEY,
    board_id UUID NOT NULL,
    org_id UUID NOT NULL,
    version INTEGER NOT NULL,
    data JSONB NOT NULL,
    snapshot_type VARCHAR(20) NOT NULL, -- 'periodic', 'on_run', 'manual'
    created_at TIMESTAMP DEFAULT NOW(),
    INDEX idx_board_latest (board_id, created_at DESC),
    INDEX idx_org_board (org_id, board_id)
  );
  ```
- **Frequency**:
  - Periodic: Every 5 minutes when active
  - On run: Before each engine run
  - Manual: Via API endpoint
  - On close: When last user disconnects

### Load Strategy

1. **First client connects**:
   - Try to load latest snapshot
   - If snapshot exists, apply all updates since snapshot
   - If no snapshot, reconstruct from full update log
   - Cache Yjs doc in memory

2. **Subsequent clients**:
   - Sync from in-memory Yjs doc
   - No database read needed

3. **Service restart**:
   - All docs evicted from memory
   - First client triggers load from DB

### Eviction Policy

- Evict docs from memory after 10 minutes of inactivity
- Before eviction, persist final snapshot
- Track memory usage; evict oldest inactive docs if limit exceeded

---

## Security and Multi-tenancy

### Authentication

All WebSocket connections must authenticate via JWT:

```typescript
// Connection handshake
const token = url.searchParams.get('token');
const payload = verifyJwt(token, JWT_SECRET);

if (!payload || !payload.userId || !payload.orgId) {
  ws.close(4401, 'Unauthorized');
  return;
}
```

### Authorization

Access control enforced at connection time:

```typescript
// Check board access
const board = await db.query(
  'SELECT org_id, owner_id FROM boards WHERE id = $1',
  [boardId]
);

if (!board) {
  ws.close(4404, 'Board not found');
  return;
}

if (board.org_id !== payload.orgId) {
  ws.close(4403, 'Forbidden: wrong organization');
  return;
}

// Check user role
const userRole = await getUserRole(payload.userId, board.org_id);
if (!['owner', 'admin', 'member'].includes(userRole)) {
  ws.close(4403, 'Forbidden: insufficient permissions');
  return;
}
```

### Tenant Isolation

- **Document keys**: Prefixed with `{orgId}:{boardId}`
- **Database queries**: Always filter by `org_id`
- **Connection tracking**: Per-org connection limits
- **Rate limiting**: Per-org and per-user

### Audit Logging

Log security-relevant events (without sensitive content):

```typescript
logger.info('collab.connection.auth', {
  userId: payload.userId,
  orgId: payload.orgId,
  boardId: boardId,
  ip: getClientIp(request),
  timestamp: new Date().toISOString(),
});

logger.warn('collab.connection.forbidden', {
  userId: payload.userId,
  attemptedOrgId: payload.orgId,
  boardOrgId: board.org_id,
  boardId: boardId,
  timestamp: new Date().toISOString(),
});
```

---

## Failure Modes and Recovery

### Network Disconnection

**Scenario**: Client loses connection mid-edit

**Handling**:
1. Client detects disconnect via WebSocket `onclose`
2. Client queues local edits in memory
3. Client attempts reconnect with exponential backoff
4. On reconnect, client re-syncs and sends queued updates
5. CRDT merge ensures consistency

**UX**: Show "Offline - reconnecting..." banner

### Server Restart

**Scenario**: Collab service restarts

**Handling**:
1. All WebSocket connections drop
2. Clients detect disconnect and reconnect
3. On first reconnect, server loads Yjs doc from DB
4. Clients re-sync from fresh server state
5. Minimal data loss (only in-flight updates)

**UX**: Brief reconnection, seamless to user

### Concurrent Deletes

**Scenario**: User A deletes a goal while User B edits it

**Handling**:
1. User A sets `goal.deleted = true` (tombstone)
2. User B's edit still applied to deleted goal
3. UI filters out deleted items
4. Deleted items kept in CRDT for conflict resolution
5. Periodic cleanup removes old tombstones

**UX**: B's edit lost, but no crash or corruption

### Data Corruption

**Scenario**: Yjs update log corrupted or inconsistent

**Handling**:
1. Detect via checksum or parse error
2. Fall back to latest valid snapshot
3. Alert administrators
4. Client may see brief rollback

**Mitigation**:
- Redundant snapshot storage
- Regular snapshot integrity checks
- Backup to object storage (S3)

### Split Brain

**Scenario**: Network partition between collab servers (if distributed)

**Handling**:
- **Current architecture**: Single-instance per board (sticky sessions)
- **Future**: If multi-instance, use leader election (Redis, etcd)
- CRDT ensures eventual consistency after partition heals

---

## Performance Characteristics

### Latency Targets

- **Edit → Remote client**: < 100ms (p50), < 200ms (p99)
- **Join board**: < 500ms to first sync
- **Snapshot generation**: < 50ms for typical board (100 entities)

### Scalability Limits

- **Concurrent editors per board**: 10-20 (comfortable), 50 (max tested)
- **Boards per server**: 1000 active, 10K total (in memory)
- **Update rate**: 100 updates/sec per board (high activity)

### Optimization Techniques

1. **Delta compression**: Only send changed fields
2. **Batching**: Group rapid updates (debounce 50ms)
3. **Binary encoding**: Use Yjs binary format (not JSON)
4. **Selective sync**: Only sync visible entities on large boards
5. **Lazy loading**: Load related entities on demand

### Memory Usage

- **Yjs doc overhead**: ~2-5KB base + ~100 bytes/entity
- **Typical board**: 100 entities = ~20KB
- **1000 active boards**: ~20MB + overhead
- **Acceptable**: Up to 2GB for 10K boards

---

## Monitoring and Observability

### Metrics

```typescript
// Connection metrics
collab.connections.active {orgId, boardId}
collab.connections.total_count
collab.connections.auth_failures_total

// Document metrics
collab.documents.active_count
collab.documents.memory_bytes
collab.documents.entity_count {boardId}

// Update metrics
collab.updates.received_total {boardId}
collab.updates.broadcast_total {boardId}
collab.updates.size_bytes {p50, p95, p99}

// Snapshot metrics
collab.snapshots.generation_duration_ms {p50, p95, p99}
collab.snapshots.size_bytes {p50, p95, p99}
collab.snapshots.created_total {type}

// Error metrics
collab.errors.total {type, boardId}
collab.errors.sync_failures_total
```

### Logging

Structured logging with appropriate levels:

```typescript
// Info: normal operations
logger.info('collab.document.loaded', { boardId, entityCount, loadDurationMs });

// Warn: degraded but functional
logger.warn('collab.reconnect.attempt', { userId, boardId, attemptNumber });

// Error: needs attention
logger.error('collab.snapshot.failed', { boardId, error: err.message });
```

### Tracing

Distributed tracing for cross-service operations:

- Trace ID propagated from UI → Collab → Engine
- Spans for: auth, doc load, sync, snapshot, engine call
- Integration with OpenTelemetry or similar

---

## Feature Flag Strategy

### Flag: `REALTIME_COLLAB`

**Levels**:
- `off`: Collaboration disabled (default for rollout)
- `beta`: Enabled for specific orgs (allowlist)
- `on`: Enabled for all orgs

**Implementation**:

```typescript
// Server
if (featureFlags.get('REALTIME_COLLAB', orgId) !== 'on') {
  ws.close(4503, 'Collaboration not enabled for this organization');
  return;
}

// Client
const collabEnabled = featureFlags.isEnabled('REALTIME_COLLAB', {
  orgId: currentOrg.id,
  userId: currentUser.id,
});

if (collabEnabled) {
  initCollaboration(boardId);
} else {
  initLegacyEditing(boardId);
}
```

**Rollout Plan**:
1. **Week 1**: Internal testing (Olumi team)
2. **Week 2-3**: Beta with 3-5 pilot orgs
3. **Week 4**: Gradual rollout (10% → 50% → 100%)
4. **Week 5+**: Fully enabled, deprecate legacy

### Backwards Compatibility

When `REALTIME_COLLAB` is off:
- Existing API endpoints work unchanged
- UI uses local state management (Redux, Zustand, etc.)
- Saves via PUT /boards/:boardId
- No WebSocket connections

When `REALTIME_COLLAB` is on:
- New WebSocket connection for live sync
- Local state backed by Yjs
- Saves still work (translated to Yjs updates)
- Graceful fallback if WebSocket fails

---

## Integration Points

### With Existing Board API

The collaboration service exposes REST endpoints alongside WebSocket:

```
GET  /api/collab/boards/:boardId/snapshot
POST /api/collab/boards/:boardId/snapshot  (force snapshot)
GET  /api/collab/boards/:boardId/status
GET  /api/collab/health
```

These endpoints:
- Use same auth as existing API
- Return data compatible with `BoardDocument` schema
- Can be called by engine service for snapshot retrieval

### With Engine Service

Engine integration flow:

```typescript
// UI triggers run
async function runEngineAnalysis(boardId: string) {
  // 1. Request snapshot from collab service
  const snapshot = await collabClient.createSnapshot(boardId);

  // 2. Transform to engine input
  const runInput = transformToRunInput(snapshot);

  // 3. Call engine with snapshot context
  const result = await engineClient.run({
    input: runInput,
    context: {
      snapshotId: snapshot.id,
      boardId: boardId,
    },
  });

  return result;
}
```

### With ISL/Assistants

Assistants service may need board context:

```typescript
// Assistants can read snapshot
const boardContext = await collabClient.getSnapshot(boardId);

// Assistants can suggest edits (as structured operations)
const suggestion = {
  type: 'add_evidence',
  data: {
    content: 'Market research shows...',
    linkedAssumptionIds: ['assumption-123'],
  },
};

// UI applies suggestion via Yjs
applyAssistantSuggestion(suggestion, ydoc);
```

---

## Future Enhancements

### Phase 2 (Post-MVP)

1. **Presence cursors**: Show remote user cursors on canvas
2. **Comments and annotations**: Per-entity discussion threads
3. **Version history**: Browse and restore previous board states
4. **Conflict UI**: Show conflicts and allow manual resolution
5. **Offline mode**: Full offline editing with sync on reconnect

### Phase 3 (Advanced)

1. **Real-time engine updates**: Stream engine results as they compute
2. **Collaborative AI**: Multiple users interacting with assistant
3. **Board templates**: Shared, versioned starting points
4. **Access control**: Fine-grained permissions per entity
5. **Multi-region**: Edge deployment for global teams

---

## Decision Log

| Date       | Decision                              | Rationale                                      |
|------------|---------------------------------------|------------------------------------------------|
| 2025-11-22 | Use Yjs for CRDT                      | Mature, performant, excellent ecosystem        |
| 2025-11-22 | Custom WebSocket server (not y-ws)    | Need custom auth/authorization integration     |
| 2025-11-22 | Standalone collab service             | Better separation, independent scaling         |
| 2025-11-22 | Dual storage (updates + snapshots)    | Balance fast sync with engine compatibility    |
| 2025-11-22 | Tombstone deletions                   | Preserve CRDT consistency for concurrent edits |
| 2025-11-22 | Feature-flagged rollout               | Safe, gradual deployment                       |

---

**Document Version**: 1.0
**Last Updated**: 2025-11-22
**Status**: Approved for Implementation
