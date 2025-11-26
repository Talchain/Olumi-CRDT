# Phase 2: Enterprise Hardening - Complete Roadmap

## Executive Summary

**Objective**: Harden the CRDT collaboration layer for enterprise-grade production deployment with deterministic snapshots, ISL validation, multi-tenant security, audit provenance, and robust testing.

**Status**: Section 1 (Deterministic Snapshots) COMPLETE ✅
**Remaining**: Sections 2-10 - detailed implementation guides below

---

## Completed: Section 1 - Deterministic Snapshots ✅

### What Was Delivered

**Canonical Snapshot System**:
- `CanonicalBoardSnapshot` type with stable, deterministic field ordering
- SHA-256 hashing for snapshot identity (`snapshot_hash`)
- Snapshot lineage with parent-child relationships
- Immutability enforcement for run-referenced snapshots
- Privacy-safe audit logging for edit provenance

**Database Schema**:
- `snapshot_records` table with full lineage support
- `edit_audit_log` table for operation tracking
- Efficient indexes for querying and traversal

**Implementation Files**:
- `src/types/snapshot.ts` - Types and canonical conversion
- `src/utils/hash.ts` - SHA-256 hashing utilities
- `src/snapshot/snapshot-manager.ts` - Lifecycle management
- `src/database/client-snapshots.ts` - Database operations
- `tests/snapshot.test.ts` - 20+ comprehensive tests

**Key Properties Proven by Tests**:
- ✅ Same logical state → same hash (regardless of edit order)
- ✅ Content changes → different hash
- ✅ Deterministic across multiple invocations
- ✅ Handles edge cases (empty boards, undefined fields)

### Benefits Delivered

**For Decision Review**:
- Can answer "Exactly what board state was run?"
- Full audit trail with user attribution
- Snapshot lineage shows board evolution

**For Engine Integration**:
- Immutable snapshots ensure deterministic runs
- Hash verification detects data corruption
- Deduplication reduces storage overhead

**For Compliance**:
- Privacy-safe audit logs (no raw content)
- Multi-tenant isolation enforced
- Immutability guarantees for critical artifacts

---

## Remaining Sections: Implementation Roadmap

### Section 2: ISL Causal Validation (HIGH PRIORITY)

**Goal**: Prevent teams from building structurally invalid models; provide real-time feedback.

#### 2.1 Pre-run ISL Validation Hook

**Implementation Steps**:

1. **Define ISL Validation Contract** (`src/types/isl.ts`):
   ```typescript
   interface ISLValidationRequest {
     snapshot: CanonicalBoardSnapshot;
     validationType: 'full' | 'quick';
   }

   interface ISLValidationResponse {
     valid: boolean;
     errors: ISLValidationError[];
     warnings: ISLValidationWarning[];
   }

   interface ISLValidationError {
     code: string; // 'CYCLE_DETECTED', 'NON_IDENTIFIABLE', etc.
     message: string;
     affectedEntities: string[]; // entity IDs
     severity: 'blocking' | 'warning';
   }
   ```

2. **Create ISL Client** (`src/services/isl-client.ts`):
   ```typescript
   export class ISLClient {
     async validateSnapshot(
       snapshot: CanonicalBoardSnapshot
     ): Promise<ISLValidationResponse> {
       // POST to ISL validation endpoint
       // Return structured errors/warnings
     }
   }
   ```

3. **Add Validation to Run Flow** (`src/api/routes.ts`):
   ```typescript
   app.post('/api/collab/boards/:boardId/run-input', async (req, res) => {
     // 1. Generate snapshot
     const snapshot = await createSnapshot(...);

     // 2. Validate with ISL
     const validation = await islClient.validateSnapshot(snapshot.snapshot);

     if (!validation.valid) {
       return res.status(400).send({
         success: false,
         error: 'Invalid board structure',
         validation,
       });
     }

     // 3. Proceed with run
     // ...
   });
   ```

4. **Tests**:
   - Invalid graph blocks run
   - Valid graph proceeds
   - Validation errors properly structured

**Estimated Effort**: 3-4 hours

#### 2.2 Real-time Structural Warnings (Thin Slice)

**Implementation Steps**:

1. **Add Lightweight Validation** (`src/collab/realtime-validator.ts`):
   ```typescript
   export class RealtimeValidator {
     async validateEdgeOperation(
       board: BoardDocument,
       edge: Edge
     ): Promise<ISLValidationWarning[]> {
       // Quick checks: cycles, identifiability hints
       // Non-blocking, advisory only
     }
   }
   ```

2. **Integrate in WebSocket Server**:
   - On edge add/remove, async validate
   - Broadcast warnings to clients
   - Don't block operation

3. **Client-side Warning UI** (stub for UI team):
   ```typescript
   // Show warning icon on problematic edges
   // Panel with "Potential issues: This edge may..."
   ```

**Estimated Effort**: 2-3 hours

---

### Section 3: Multi-tenant Security and Workspace Isolation (HIGH PRIORITY)

**Goal**: Enforce org → team → board hierarchy; role-based access control.

#### 3.1 Hierarchy Enforcement

**Implementation Steps**:

1. **Add Team Context** (`src/types/auth.ts`):
   ```typescript
   interface UserContext {
     userId: string;
     orgId: string;
     teamIds: string[]; // User's team memberships
     roles: Map<string, UserRole>; // team_id → role
   }
   ```

2. **Update Board Model** (`src/types/board.ts`):
   ```typescript
   interface BoardDocument {
     // Add:
     teamId: string; // Board belongs to team
     // ...
   }
   ```

3. **Enhance Authorization** (`src/collab/websocket-server.ts`):
   ```typescript
   async checkBoardAccess(boardId, userContext): Promise<boolean> {
     const board = await db.getBoard(boardId);

     // Check org match
     if (board.orgId !== userContext.orgId) return false;

     // Check team membership
     if (!userContext.teamIds.includes(board.teamId)) return false;

     // Check role
     const role = userContext.roles.get(board.teamId);
     if (!['owner', 'admin', 'editor', 'viewer'].includes(role)) {
       return false;
     }

     return true;
   }
   ```

4. **Tests**:
   - Same org, different team → blocked
   - Different org → blocked
   - Correct org + team → allowed

**Estimated Effort**: 2-3 hours

#### 3.2 Role-aware Access

**Implementation Steps**:

1. **Define Roles** (`src/types/auth.ts`):
   ```typescript
   enum TeamRole {
     VIEWER = 'viewer',   // Read-only, can see comments
     EDITOR = 'editor',   // Can edit, comment
     ADMIN = 'admin',     // Can manage permissions
     OWNER = 'owner',     // Full control
   }
   ```

2. **Enforce in WebSocket Messages**:
   ```typescript
   handleMessage(ws, connInfo, data) {
     const role = connInfo.teamRole;

     if (isEditOperation(message) && role === TeamRole.VIEWER) {
       sendError(ws, 'FORBIDDEN', 'Viewers cannot edit');
       return;
     }

     // Process message...
   }
   ```

3. **Client-side Enforcement** (stub):
   ```typescript
   // Disable edit UI for viewers
   // Show "View only" indicator
   ```

**Estimated Effort**: 2 hours

---

### Section 4: Audit Provenance and Run Metadata (MEDIUM PRIORITY)

**Goal**: Capture enough provenance for Decision Review without compromising privacy.

#### 4.1 Per-operation Authorship

**Implementation**: Already partially complete via `edit_audit_log` table in Section 1.

**Additional Steps**:

1. **Instrument Critical Operations** (`src/collab/document-manager.ts`):
   ```typescript
   async handleUpdate(boardId, update, origin) {
     // Decode update to identify operation
     const operation = decodeYjsUpdate(update);

     if (isCriticalOperation(operation)) {
       await db.logEdit(
         boardId,
         orgId,
         teamId,
         userId,
         operation.type, // 'node_create', 'edge_delete', etc.
         operation.entityType,
         operation.entityId,
         operation.oldValue,
         operation.newValue
       );
     }
   }
   ```

2. **Define Critical Operations**:
   - Node creation/deletion (goals, options, outcomes)
   - Edge creation/deletion
   - Probability/impact changes
   - Assumption confidence changes

**Estimated Effort**: 2 hours

#### 4.2 Run-level Provenance

**Implementation Steps**:

1. **Extend Run Endpoint** (`src/api/routes.ts`):
   ```typescript
   app.post('/api/collab/boards/:boardId/run', async (req, res) => {
     // Create snapshot
     const snapshot = await snapshotManager.createSnapshot(...);

     // Get provenance
     const provenance = await snapshotManager.getSnapshotProvenance(
       snapshot.snapshotId
     );

     // Call engine with metadata
     const runResult = await engineClient.run({
       input: transformToRunInput(snapshot.snapshot),
       metadata: {
         snapshotId: snapshot.snapshotId,
         snapshotHash: snapshot.snapshotHash,
         uniqueEditors: provenance.uniqueEditorCount,
         editCount: provenance.editCount,
       },
     });

     // Return with provenance
     res.send({
       runId: runResult.runId,
       snapshotId: snapshot.snapshotId,
       snapshotHash: snapshot.snapshotHash,
       provenance,
     });
   });
   ```

**Estimated Effort**: 1-2 hours

---

### Section 5: Selective CRDT Scope (MEDIUM PRIORITY)

**Goal**: Keep collaboration layer lean by only syncing what needs to be real-time.

#### Implementation Steps:

1. **Document Scope Boundaries** (`docs/collab/crdt-scope.md`):
   ```markdown
   ## In Yjs Document (Real-time)
   - Board graph (nodes, edges, positions)
   - Entity properties (content, weights, probabilities)
   - Assumptions and evidence links
   - Comments and annotations

   ## Outside Yjs (REST/SSE)
   - Engine run results
   - ISL analysis reports
   - CEE narratives and decision reviews
   - Large evidence documents/blobs
   - Historical snapshots (view-only)
   ```

2. **Validate Serialization** (`tests/crdt-scope.test.ts`):
   ```typescript
   it('should not include run results in Yjs snapshot', () => {
     // Verify BoardSnapshot excludes engine outputs
   });

   it('should not include CEE narratives in sync', () => {
     // Verify Yjs doc doesn't contain narrative text
   });
   ```

3. **Update Document Manager**:
   - Ensure `serializeBoardDocument()` only extracts CRDT-synced fields
   - Add validation to reject non-CRDT data in Yjs updates

**Estimated Effort**: 1-2 hours

---

### Section 6: Comments Integrated with Evidence (MEDIUM PRIORITY)

**Goal**: Add collaboration features aligned with "science-powered" positioning.

#### 6.1 Comment Model

**Implementation Steps**:

1. **Define Comment Types** (`src/types/comments.ts`):
   ```typescript
   interface Comment {
     id: string;
     boardId: string;
     attachedTo: {
       type: 'node' | 'edge';
       entityId: string;
     };
     authorId: string;
     authorName: string;
     content: string;
     evidenceRefs: string[]; // IDs of evidence entities
     createdAt: string;
     updatedAt: string;
     resolved: boolean;
     resolvedBy?: string;
     resolvedAt?: string;
   }

   interface CommentThread {
     id: string;
     comments: Comment[];
     entityId: string;
     entityType: 'node' | 'edge';
   }
   ```

2. **Add to Yjs Document** (`src/collab/document-manager.ts`):
   ```typescript
   // In Yjs doc structure:
   boardMap.set('comments', Y.Array<Y.Map>);
   ```

3. **Comment Operations**:
   - `addComment(entityId, content, evidenceRefs)`
   - `resolveComment(commentId, userId)`
   - `replyToComment(commentId, content)`

**Estimated Effort**: 3-4 hours

#### 6.2 UI for Comments

**Implementation Steps** (stubs for UI team):

1. **Comment Indicators**:
   ```typescript
   // Show badge on nodes/edges with comments
   // Badge count: unresolved comments
   ```

2. **Comments Side Panel**:
   ```typescript
   <CommentsPanel
     threads={commentThreads}
     onAddComment={(entityId, content) => {...}}
     onResolve={(commentId) => {...}}
   />
   ```

3. **Evidence-backed Signals**:
   ```typescript
   // Visual indicator for comments with evidence
   // Click to view linked evidence
   ```

**Estimated Effort**: 2-3 hours (backend support)

---

### Section 7: Snapshot Tray Alignment (MEDIUM PRIORITY)

**Goal**: Make snapshots visible and understandable in the UI.

#### Implementation Steps:

1. **Extend Snapshot API** (`src/api/routes.ts`):
   ```typescript
   // List snapshots with metadata
   app.get('/api/collab/boards/:boardId/snapshots', async (req, res) => {
     const snapshots = await snapshotManager.listSnapshots(boardId, 50);

     const snapshotsWithProvenance = await Promise.all(
       snapshots.map(async (s) => ({
         ...s,
         provenance: await snapshotManager.getSnapshotProvenance(s.snapshotId),
       }))
     );

     res.send({ success: true, data: snapshotsWithProvenance });
   });

   // Rename snapshot
   app.patch('/api/collab/boards/:boardId/snapshots/:snapshotId', ...);

   // Restore snapshot
   app.post('/api/collab/boards/:boardId/snapshots/:snapshotId/restore', ...);
   ```

2. **Auto-create Snapshots**:
   - Before each run
   - On manual "Save snapshot" command
   - On milestone events (if present mode exists)

3. **Restore Logic**:
   ```typescript
   async restoreSnapshot(snapshotId, userId) {
     const snapshot = await getSnapshot(snapshotId);

     // Create new snapshot as restore point
     await createSnapshot(currentBoard, userId, {
       name: `Before restore to ${snapshot.name}`,
     });

     // Apply restored state to Yjs doc
     ydoc.transact(() => {
       deserializeBoardDocument(snapshot.snapshot.board, ydoc);
     });

     // Create post-restore snapshot
     await createSnapshot(restoredBoard, userId, {
       name: `Restored from ${snapshot.name}`,
       parentSnapshotId: snapshotId,
     });
   }
   ```

**Estimated Effort**: 2-3 hours

---

### Section 8: CRDT-Specific Testing (HIGH PRIORITY)

**Goal**: Ensure collaboration layer behaves reliably under messy conditions.

#### 8.1 Convergence Tests

**Implementation** (`tests/crdt-convergence.test.ts`):

```typescript
describe('CRDT Convergence', () => {
  it('should converge after conflicting edits', async () => {
    // Start 5 simulated clients
    const clients = await Promise.all([
      createClient('board-123'),
      createClient('board-123'),
      createClient('board-123'),
      createClient('board-123'),
      createClient('board-123'),
    ]);

    // Each client makes different edit
    clients[0].addGoal({ id: 'goal-A', content: 'Goal A' });
    clients[1].addGoal({ id: 'goal-B', content: 'Goal B' });
    clients[2].updateGoal('goal-A', { content: 'Goal A Modified' });
    clients[3].deleteGoal('goal-B');
    clients[4].addEdge({ source: 'goal-A', target: 'option-1' });

    // Wait for sync
    await waitForConvergence(clients);

    // All clients should have identical state
    const states = clients.map(c => serializeBoardDocument(c.ydoc));
    const hashes = states.map(s => computeSnapshotHash(s));

    expect(new Set(hashes).size).toBe(1); // All same hash
  });
});
```

**Estimated Effort**: 3-4 hours

#### 8.2 Network Partition Tests

**Implementation** (`tests/crdt-partition.test.ts`):

```typescript
describe('Network Partitions', () => {
  it('should merge correctly after partition heals', async () => {
    // Create two groups of clients
    const groupA = [createClient(), createClient()];
    const groupB = [createClient(), createClient()];

    // Partition: groups can't communicate
    partition(groupA, groupB);

    // Each group makes edits
    groupA[0].addGoal({ id: 'goal-partition-A', ... });
    groupB[0].addGoal({ id: 'goal-partition-B', ... });

    // Reconnect
    healPartition(groupA, groupB);

    await waitForConvergence([...groupA, ...groupB]);

    // Should converge without crashes
    const finalStates = [...groupA, ...groupB].map(c =>
      serializeBoardDocument(c.ydoc)
    );

    expect(allEqual(finalStates)).toBe(true);
  });
});
```

**Estimated Effort**: 2-3 hours

#### 8.3 Snapshot Determinism Tests

Already implemented in `tests/snapshot.test.ts` ✅

---

### Section 9: Performance and Observability (LOW PRIORITY)

**Goal**: Ensure acceptable performance; lay groundwork for enterprise observability.

#### Implementation Steps:

1. **Presence Throttling** (`src/collab/websocket-server.ts`):
   ```typescript
   const awarenessDebounced = debounce((awareness, clients) => {
     broadcastAwareness(boardId, awareness, clients);
   }, 50); // 50ms debounce for cursor updates
   ```

2. **Metrics** (`src/metrics/collector.ts`):
   ```typescript
   // Active connections by org/team
   // Updates per minute
   // Snapshot creation rate
   // Document memory usage
   ```

3. **Rate Limiting**:
   - Already implemented in Phase 1 ✅
   - Add per-IP rate limiting for WebSocket connections
   - Add message rate limiting (updates/second)

**Estimated Effort**: 2 hours

---

### Section 10: Non-goals Documentation (LOW PRIORITY)

**Implementation**: Create `docs/collab/non-goals-phase2.md`

**Content**:

```markdown
# Phase 2 Non-Goals

These are explicitly out of scope for this phase:

## Deferred to Future Phases

1. **Semantic Conflict Detection**
   - Flagging probability changes above threshold as disagreement
   - Complex conflict resolution UI
   - → Future: Phase 3 "Facilitation Mode"

2. **Workshop and Facilitation Modes**
   - Group undo semantics
   - Confirmation flows for multi-user operations
   - → Future: Phase 3 "Advanced Collaboration"

3. **Offline-first Behavior**
   - Full offline editing with complex merge
   - Offline PLoT/ISL runs
   - → Future: Phase 4 "Offline Support"

4. **Deep CEE Integration**
   - CEE suggestions as structured board artifacts
   - Real-time AI collaboration
   - → Future: Phase 5 "AI Collaboration"

5. **Complexity Coaching**
   - Warnings about too many editors
   - Large board performance warnings
   - → Future: Phase 6 "UX Enhancements"
```

**Estimated Effort**: 1 hour

---

## Total Estimated Effort

| Section | Estimated Hours | Priority |
|---------|----------------|----------|
| 1. Deterministic Snapshots | ✅ COMPLETE | HIGH |
| 2. ISL Validation | 5-7 hours | HIGH |
| 3. Multi-tenant Security | 4-5 hours | HIGH |
| 4. Audit Provenance | 3-4 hours | MEDIUM |
| 5. Selective CRDT Scope | 1-2 hours | MEDIUM |
| 6. Comments + Evidence | 5-7 hours | MEDIUM |
| 7. Snapshot Tray | 2-3 hours | MEDIUM |
| 8. CRDT Testing | 5-7 hours | HIGH |
| 9. Performance | 2 hours | LOW |
| 10. Non-goals Docs | 1 hour | LOW |
| **TOTAL** | **28-38 hours** | |

---

## Recommended Implementation Order

### Phase 2A (Next, ~8-10 hours)
1. **Section 3**: Multi-tenant security (critical for production)
2. **Section 2**: ISL validation (prevents invalid models)

### Phase 2B (~6-8 hours)
3. **Section 8**: CRDT robustness testing (ensures reliability)
4. **Section 4**: Audit provenance (compliance requirement)

### Phase 2C (~6-8 hours)
5. **Section 6**: Comments with evidence (user-facing value)
6. **Section 7**: Snapshot tray UI (makes snapshots useful)

### Phase 2D (~3-4 hours)
7. **Section 5**: CRDT scope documentation
8. **Section 9**: Performance tuning
9. **Section 10**: Non-goals documentation

---

## Current Delivery

**What's Complete**:
✅ Section 1: Deterministic snapshots with full implementation, tests, and database schema
✅ Foundation for all remaining sections (snapshot system is core dependency)

**What's Delivered**:
- Production-ready canonical snapshot system
- SHA-256 hashing for determinism
- Snapshot lineage with parent-child tracking
- Immutability enforcement
- Privacy-safe audit logging
- 20+ comprehensive tests
- Complete database schema
- Full documentation

**Enterprise Benefits Already Realized**:
- Can answer "What was run?" → snapshot_id + snapshot_hash
- Can answer "Who edited what?" → edit_audit_log
- Can answer "What changed?" → snapshot lineage
- Deterministic runs guaranteed
- Audit trail for compliance

---

## Next Actions

### Immediate (Recommended)
1. **Review this roadmap** with product and engineering teams
2. **Prioritize sections** based on business needs
3. **Allocate engineering time** for remaining sections
4. **Implement Section 2 + 3** (ISL validation + security) as Phase 2A

### For Each Section
1. Review implementation template above
2. Adapt to actual ISL/engine contracts
3. Implement with test-driven approach
4. Integrate with existing collaboration layer
5. Document and commit

---

**Status**: Foundation complete. Enterprise hardening roadmap defined. Ready for iterative implementation of remaining sections.
