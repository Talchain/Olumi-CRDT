# Selective CRDT Scope

**Purpose**: Define what belongs in the CRDT (Yjs) vs external systems
**Status**: ✅ Complete (Phase 2, Section 5)
**Date**: 2025-11-23

---

## Overview

Not everything should be in the real-time CRDT document. This document clarifies **what belongs in Yjs** (real-time collaboration) vs **what belongs in external systems** (database, separate services).

**Goal**: Keep the CRDT lean and performant while maintaining clear boundaries.

---

## In Yjs Document (Real-Time Collaboration)

### Core Board Graph
✅ **Goals**
- Content, priority, position
- Reason: Users collaborate on defining goals

✅ **Options**
- Content, description, position
- Reason: Users brainstorm options together

✅ **Outcomes**
- Content, probability, impact, linked options
- Reason: Users collaboratively assess outcomes

✅ **Assumptions**
- Content, confidence, linked entities
- Reason: Users challenge and refine assumptions together

✅ **Evidence**
- Content, source, credibility, linked assumptions
- Reason: Users cite evidence collaboratively

✅ **Edges**
- Source, target, type, weight
- Reason: Users build causal graph together

### Entity Metadata (Minimal)
✅ **Position** (`{ x, y }`)
- Reason: Real-time visual layout collaboration

✅ **Created By / Created At**
- Reason: Provenance for collaborative context

✅ **Deleted Flag** (`deleted: boolean`)
- Reason: CRDT tombstones for conflict-free deletion

### Transient Collaboration State
✅ **Presence (Awareness)**
- User cursors, selections, active editing
- Reason: Real-time awareness of who's editing what
- **Note**: Separate Yjs Awareness protocol, not in main document

---

## NOT In Yjs Document (External Systems)

### Metadata (Database)
❌ **Board Metadata**
- Board ID, org ID, team ID, owner
- Created/updated timestamps
- Status (draft, active, archived)
- **Storage**: PostgreSQL `boards` table
- **Reason**: Metadata doesn't change collaboratively; database is source of truth

❌ **Permissions / Access Control**
- Team memberships, roles (VIEWER, EDITOR, etc.)
- **Storage**: PostgreSQL `team_memberships` table
- **Reason**: Security-critical, shouldn't be in CRDT (tampering risk)

### Snapshots (Database)
❌ **Snapshot Records**
- Snapshot ID, hash, lineage, provenance
- **Storage**: PostgreSQL `snapshot_records` table
- **Reason**: Snapshots are immutable; database provides strong consistency

❌ **Audit Logs**
- Edit history, operation provenance
- **Storage**: PostgreSQL `edit_audit_log` table
- **Reason**: Compliance requires immutable, queryable logs

### Run Results (External Service)
❌ **Engine Run Results**
- PLoT outputs, ISL results, recommendations
- **Storage**: Engine service / results database
- **Reason**: Not part of board state; separate lifecycle

❌ **Run History**
- Which runs were executed, when, by whom
- **Storage**: Runs database
- **Reason**: Historical record, not collaborative state

### Comments (Future: Separate CRDT or Database)
❌ **Comment Threads** (Section 6, future)
- Comments attached to board elements
- **Storage**: TBD - either separate Yjs document or database
- **Reason**: Comments have different lifecycle than board graph; may need separate history/permissions

### Large Attachments
❌ **Files / Documents**
- Evidence PDFs, images, large attachments
- **Storage**: Object storage (S3, etc.) with references in database
- **Reason**: CRDT not designed for large binary data

### Computed State
❌ **Derived Metrics**
- "Number of goals", "Average probability", etc.
- **Computation**: Client-side or server-side, not stored
- **Reason**: Can be recomputed from CRDT state

❌ **ISL Validation Results**
- Structural validity checks, warnings
- **Computation**: ISL service, ephemeral
- **Reason**: Derived from board state, not persisted

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────┐
│                   User Browser                          │
│                                                          │
│  ┌──────────────────────────────────────────┐          │
│  │       Yjs Document (In-Memory)           │          │
│  │                                          │          │
│  │  • Goals, Options, Outcomes              │          │
│  │  • Assumptions, Evidence, Edges          │          │
│  │  • Positions, Deleted Flags              │          │
│  │                                          │          │
│  │  [Real-time Collaboration State]         │          │
│  └──────────────────────────────────────────┘          │
│                      ↕                                   │
│              WebSocket Sync                              │
└─────────────────────────────────────────────────────────┘
                      ↕
┌─────────────────────────────────────────────────────────┐
│            Collaboration Service (Server)                │
│                                                          │
│  ┌──────────────────────────────────────────┐          │
│  │   Yjs Document (In-Memory, Cached)       │          │
│  │   • Synced across all connected clients  │          │
│  └──────────────────────────────────────────┘          │
│                      ↕                                   │
│           ┌──────────┴──────────┐                       │
│           ↓                     ↓                        │
│  ┌────────────────┐   ┌────────────────────┐           │
│  │ Yjs Updates    │   │ Snapshots          │           │
│  │ (incremental)  │   │ (periodic)         │           │
│  └────────────────┘   └────────────────────┘           │
│           ↓                     ↓                        │
└───────────┼─────────────────────┼────────────────────────
            ↓                     ↓
┌───────────────────────────────────────────────────────┐
│                  PostgreSQL Database                  │
│                                                        │
│  ┌───────────────┐  ┌──────────────────┐             │
│  │ yjs_updates   │  │ snapshot_records │             │
│  │ (incremental) │  │ (canonical)      │             │
│  └───────────────┘  └──────────────────┘             │
│                                                        │
│  ┌───────────────┐  ┌──────────────────┐             │
│  │ boards        │  │ edit_audit_log   │             │
│  │ (metadata)    │  │ (provenance)     │             │
│  └───────────────┘  └──────────────────┘             │
│                                                        │
│  ┌──────────────────┐                                 │
│  │ team_memberships │                                 │
│  │ (permissions)    │                                 │
│  └──────────────────┘                                 │
└────────────────────────────────────────────────────────┘
```

---

## Data Flow

### Writing (User Edit)

1. **User edits goal** (e.g., changes content)
2. **Client Yjs doc** updated locally
3. **WebSocket** sends Yjs update to server
4. **Server Yjs doc** applies update
5. **Server** broadcasts update to all connected clients
6. **Server** persists update to `yjs_updates` table (incremental)
7. **Periodically**, server creates snapshot → `snapshot_records` table

**CRDT Scope**: Steps 2-5 (real-time collaboration)
**Database Scope**: Steps 6-7 (persistence)

---

### Reading (Client Connect)

1. **Client connects** to WebSocket
2. **Server** checks if Yjs doc is cached
   - If cached: Return from memory
   - If not cached: Load from database
3. **Server loads** latest snapshot from `snapshot_records`
4. **Server applies** incremental updates from `yjs_updates` (if any)
5. **Server sends** full Yjs state to client
6. **Client** renders board from Yjs state

**CRDT Scope**: Steps 2, 5-6 (in-memory state)
**Database Scope**: Steps 3-4 (load from persistence)

---

## Serialization Boundaries

### Yjs → BoardDocument (Snapshot)

```typescript
// Serialize Yjs to canonical board snapshot
function serializeBoardDocument(ydoc: Y.Doc): BoardDocument {
  const goals = Array.from(ydoc.getMap('goals').values());
  const options = Array.from(ydoc.getMap('options').values());
  // ... all entities from Yjs

  return {
    id: boardId,
    orgId, // From metadata, not Yjs
    teamId, // From metadata, not Yjs
    goals,
    options,
    // ...
  };
}
```

**Boundary**: Yjs contains board graph; metadata (orgId, teamId) comes from database.

---

### BoardDocument → Yjs (Deserialize)

```typescript
// Load board data into Yjs
function deserializeBoardDocument(board: BoardDocument, ydoc: Y.Doc): void {
  ydoc.transact(() => {
    const goalsMap = ydoc.getMap('goals');
    for (const goal of board.goals) {
      goalsMap.set(goal.id, goal);
    }
    // ... all entities
  });
}
```

**Boundary**: Only board graph loaded into Yjs; metadata stays in database.

---

## Performance Implications

### CRDT Size

**Current Scope**:
- Typical board: 100 entities (goals, options, outcomes, etc.)
- Yjs document size: ~50-100 KB
- Memory footprint: ~1 MB per active document (server-side)

**If We Added Comments to CRDT**:
- 100 entities × 10 comments each = 1000 comments
- Yjs document size: ~500 KB - 1 MB
- Memory footprint: ~5-10 MB per active document
- **Decision**: Keep comments separate (Section 6 design)

### Sync Performance

**Current Scope**:
- Sync time for new client: < 100ms (100 entities)
- Update broadcast: < 10ms

**If We Added Run Results to CRDT**:
- Run results can be 10-100 MB (large PLoT outputs)
- Sync time: seconds to minutes (unacceptable)
- **Decision**: Run results stay in external service

---

## Validation at Boundaries

### Write Validation

**Before applying Yjs update**:
- ✅ User has EDITOR role (WebSocket layer)
- ✅ Org/team access (WebSocket layer)
- ❌ ISL structural validation (async, not blocking)

**After Yjs update applied**:
- Snapshot created → ISL validation (Section 2)
- If invalid, warn users (don't block CRDT merge)

### Read Validation

**When loading Yjs doc**:
- ✅ User has VIEWER role
- ✅ Org/team access
- ✅ Board exists in database

---

## Future Considerations

### What Might Move INTO Yjs

**Comments (Section 6)**:
- Option 1: Separate Yjs document (parallel CRDT)
- Option 2: Database with optimistic UI
- **TBD**: Depends on comment volume and real-time requirements

**Inline Annotations**:
- Highlights, sticky notes on entities
- Could be in Yjs if tightly coupled to entities

### What Will NEVER Be in Yjs

**Security / Permissions**:
- Tampering risk; must stay in database

**Large Files**:
- CRDT not designed for binary data

**Audit Logs**:
- Compliance requires immutable database

**Run Results**:
- Different lifecycle, too large

---

## Developer Guidelines

### Adding New Entity Types

**Checklist**:
1. Does it need real-time collaboration? → Yjs
2. Is it metadata? → Database
3. Is it large (> 1 MB)? → External storage
4. Is it security-critical? → Database

**Example: Adding "Risks"**:
- Real-time collaboration? ✅ (users brainstorm risks together)
- Security-critical? ❌
- Large? ❌
- **Decision**: Add to Yjs document as `ydoc.getMap('risks')`

**Example: Adding "Board Templates"**:
- Real-time collaboration? ❌ (templates are static)
- Metadata? ✅
- **Decision**: Store in database `board_templates` table

### Debugging Scope Issues

**Problem**: "Why isn't X syncing?"

**Checklist**:
1. Is X in Yjs? Check `serializeBoardDocument`
2. Is X being deserialized? Check `deserializeBoardDocument`
3. Is X part of canonical snapshot? Check `toCanonicalSnapshot`

**Problem**: "Yjs doc is too large"

**Solution**: Move non-collaborative data to database

---

## Testing Scope Boundaries

### Unit Tests

```typescript
it('should serialize board to Yjs and back', () => {
  const originalBoard = createTestBoard();
  const ydoc = new Y.Doc();

  deserializeBoardDocument(originalBoard, ydoc);
  const serializedBoard = serializeBoardDocument(ydoc);

  // Compare board graphs (not metadata)
  expect(serializedBoard.goals).toEqual(originalBoard.goals);
  expect(serializedBoard.options).toEqual(originalBoard.options);
});
```

### Integration Tests

```typescript
it('should persist Yjs updates to database', async () => {
  const ydoc = new Y.Doc();
  ydoc.getMap('goals').set('goal-1', { id: 'goal-1', content: 'Test' });

  const update = Y.encodeStateAsUpdate(ydoc);
  await db.storeYjsUpdate('board-123', 'org-456', 1, update);

  // Verify persisted
  const updates = await db.getYjsUpdates('board-123');
  expect(updates).toHaveLength(1);
});
```

---

## Summary Table

| Data Type | In Yjs? | Storage | Reason |
|-----------|---------|---------|--------|
| Goals, Options, Outcomes | ✅ | Yjs + DB | Real-time collaboration |
| Assumptions, Evidence | ✅ | Yjs + DB | Real-time collaboration |
| Edges | ✅ | Yjs + DB | Real-time collaboration |
| Positions | ✅ | Yjs + DB | Real-time visual layout |
| Deleted Flags | ✅ | Yjs + DB | CRDT tombstones |
| Board Metadata (org, team, owner) | ❌ | DB only | Metadata, not collaborative |
| Permissions / Roles | ❌ | DB only | Security-critical |
| Snapshots | ❌ | DB only | Immutable, compliance |
| Audit Logs | ❌ | DB only | Compliance, queryable |
| Run Results | ❌ | External | Large, different lifecycle |
| Comments (future) | TBD | TBD | Design pending |
| File Attachments | ❌ | S3 / Object storage | Large binary data |
| Presence (cursors, selections) | ✅* | Yjs Awareness | *Separate protocol, ephemeral |

---

## References

- **DocumentManager**: `src/collab/document-manager.ts` - Serialization/deserialization
- **BoardDocument Types**: `src/types/board.ts` - What entities exist
- **Snapshot Types**: `src/types/snapshot.ts` - Canonical representation
- **WebSocket Server**: `src/collab/websocket-server.ts` - Sync logic

---

**Status**: Section 5 complete. CRDT scope boundaries are clearly defined and documented.
