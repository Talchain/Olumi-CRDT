# Board Contracts Summary

## Overview

This document defines the data structures and API contracts for Olumi's Scenario Sandbox decision boards. These contracts serve as the foundation for the real-time CRDT collaboration system.

## Board Document Structure

### BoardDocument Type

The `BoardDocument` represents the complete state of a decision board in the Scenario Sandbox.

```typescript
interface BoardDocument {
  // Metadata
  id: string;                    // Unique board identifier
  orgId: string;                 // Organisation ID (for multi-tenancy)
  ownerId: string;               // User ID of the board owner
  version: number;               // Schema version (for migrations)
  createdAt: string;             // ISO 8601 timestamp
  updatedAt: string;             // ISO 8601 timestamp

  // Board content
  title: string;
  description?: string;

  // Decision model entities
  goals: Goal[];
  options: Option[];
  outcomes: Outcome[];
  assumptions: Assumption[];
  evidence: Evidence[];

  // Relationships and structure
  edges: Edge[];

  // Visual layout
  layout: LayoutData;

  // Metadata
  tags?: string[];
  status: 'draft' | 'active' | 'archived';
}

interface Goal {
  id: string;
  content: string;
  priority?: 'high' | 'medium' | 'low';
  position: Position;
  createdBy: string;
  createdAt: string;
}

interface Option {
  id: string;
  content: string;
  description?: string;
  position: Position;
  createdBy: string;
  createdAt: string;
}

interface Outcome {
  id: string;
  content: string;
  probability?: number;  // 0-1
  impact?: number;       // 0-1
  position: Position;
  linkedOptionIds: string[];
  createdBy: string;
  createdAt: string;
}

interface Assumption {
  id: string;
  content: string;
  confidence?: 'high' | 'medium' | 'low';
  position: Position;
  linkedEntityIds: string[];  // Can link to goals, options, outcomes
  createdBy: string;
  createdAt: string;
}

interface Evidence {
  id: string;
  content: string;
  source?: string;
  credibility?: number;  // 0-1
  position: Position;
  linkedAssumptionIds: string[];
  createdBy: string;
  createdAt: string;
}

interface Edge {
  id: string;
  source: string;        // Entity ID
  target: string;        // Entity ID
  type: 'supports' | 'opposes' | 'relates' | 'influences';
  weight?: number;       // 0-1, strength of relationship
  createdBy: string;
  createdAt: string;
}

interface Position {
  x: number;
  y: number;
}

interface LayoutData {
  zoom: number;
  panX: number;
  panY: number;
  viewportWidth: number;
  viewportHeight: number;
}
```

## Engine Integration

### BoardRunInput Type

The PLoT engine expects a simplified, serialized snapshot of the board:

```typescript
interface BoardRunInput {
  boardId: string;
  snapshotVersion?: number;  // Optional: track which snapshot was used

  // Simplified decision model
  goals: {
    id: string;
    content: string;
    priority?: string;
  }[];

  options: {
    id: string;
    content: string;
    description?: string;
  }[];

  outcomes: {
    id: string;
    content: string;
    probability?: number;
    impact?: number;
    linkedOptionIds: string[];
  }[];

  assumptions: {
    id: string;
    content: string;
    confidence?: string;
    linkedEntityIds: string[];
  }[];

  evidence: {
    id: string;
    content: string;
    source?: string;
    credibility?: number;
    linkedAssumptionIds: string[];
  }[];

  edges: {
    id: string;
    source: string;
    target: string;
    type: string;
    weight?: number;
  }[];
}
```

### Transformation

The collaboration system must convert `BoardDocument → BoardRunInput` by:
1. Extracting relevant fields (excluding layout, visual state, audit metadata)
2. Simplifying nested structures
3. Ensuring deterministic serialization (same board state → same input)

## Current API Endpoints

### Board Persistence API

Based on standard REST patterns, the existing system likely exposes:

```
GET    /api/v1/boards/:boardId
POST   /api/v1/boards
PUT    /api/v1/boards/:boardId
DELETE /api/v1/boards/:boardId
GET    /api/v1/boards?orgId={orgId}
```

**Request/Response Examples:**

```typescript
// GET /api/v1/boards/:boardId
Response: {
  success: true,
  data: BoardDocument
}

// PUT /api/v1/boards/:boardId
Request: {
  board: Partial<BoardDocument>
}
Response: {
  success: true,
  data: BoardDocument
}
```

### Engine API

The engine service exposes:

```
POST /v1/run
GET  /v1/status/:runId
```

**Request/Response Examples:**

```typescript
// POST /v1/run
Request: {
  input: BoardRunInput,
  config?: {
    iterations?: number;
    threshold?: number;
  }
}
Response: {
  runId: string,
  status: 'queued' | 'running' | 'completed' | 'failed',
  result?: EngineResult
}

interface EngineResult {
  recommendations: {
    optionId: string;
    score: number;
    reasoning: string[];
  }[];
  analysis: {
    goalAlignment: Record<string, number>;
    riskFactors: {
      assumptionId: string;
      impact: number;
      mitigation?: string;
    }[];
  };
  metadata: {
    runId: string;
    timestamp: string;
    snapshotVersion?: number;
  };
}
```

## Access Control

### Authentication
- All API calls require a valid JWT token in the `Authorization` header
- Token format: `Bearer {jwt}`
- JWT payload includes: `{ userId, orgId, email, roles }`

### Authorization
- Board access is checked via:
  - User must belong to the board's `orgId`
  - User must have role `member` or higher in the organisation
  - Board owner has full access
  - Org admins have full access to all org boards

### Multi-tenancy
- All data is partitioned by `orgId`
- Database queries must always filter by `orgId`
- Cross-tenant access is strictly forbidden
- Collaboration sessions enforce tenant boundaries

## Persistence Layer

### Current Storage
- Primary database: PostgreSQL
- Table: `boards`
- Schema includes: `id`, `org_id`, `owner_id`, `data` (JSONB), `created_at`, `updated_at`
- Indexes on: `id`, `org_id`, `owner_id`, `updated_at`

### Access Patterns
- Load board: Query by `id` + `org_id`
- List boards: Query by `org_id` + optional filters
- Update board: Optimistic locking via `updated_at` comparison
- No soft deletes currently (hard delete)

## Versioning and Migrations

### Schema Versions
- Current version: `1`
- Version field in `BoardDocument.version`
- Forward migrations only
- Collaboration system must handle version mismatches gracefully

### Migration Strategy
- Migrations applied on load
- Old versions supported read-only
- Write operations upgrade to latest version
- CRDT updates preserve version compatibility

## Constraints and Invariants

### Business Rules
1. Every board must have at least one goal
2. Options must link to at least one outcome
3. Evidence must link to at least one assumption
4. Edges must reference existing entities
5. Board `orgId` is immutable after creation
6. Board `ownerId` can be transferred by org admins

### Technical Constraints
1. Entity IDs must be unique within a board
2. Position coordinates are finite numbers
3. Probability/impact/credibility values in range [0, 1]
4. ISO 8601 timestamps in UTC
5. Maximum board size: 1000 entities (soft limit)

## CRDT Mapping Considerations

### Suitable for CRDT
- Entity arrays (goals, options, etc.): Use Y.Array
- Entity properties: Use Y.Map for each entity
- Edges array: Use Y.Array
- Layout data: Use Y.Map

### Challenges
- Maintaining referential integrity (edges → entities)
- Handling entity deletions (soft delete vs hard delete)
- Ensuring business rule enforcement in concurrent edits
- Position conflicts (multiple users dragging same node)

### Proposed Solutions
1. **Tombstone deletions**: Mark entities as deleted rather than removing
2. **Edge cleanup**: Background process removes orphaned edges
3. **Validation layer**: Post-CRDT merge validation with conflict resolution
4. **Position CRDTs**: Use last-write-wins with timestamp tie-breaking

---

**Document Version**: 1.0
**Last Updated**: 2025-11-22
**Status**: Draft for CRDT Implementation
