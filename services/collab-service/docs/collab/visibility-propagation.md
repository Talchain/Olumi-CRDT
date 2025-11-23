# Visibility Propagation Rules

**Phase 4, Section H.3: Selective Information Sharing - Automatic Cascading**

## Overview

Visibility Propagation automatically cascades confidentiality settings to related elements to prevent information leakage through graph structure. When an element is marked confidential, the propagation engine analyzes the board's graph topology and intelligently propagates visibility settings to prevent users from inferring confidential information.

## Why Propagation is Necessary

Without propagation, confidential elements can leak information:

**Example Scenario**:
```
Goal A (Confidential): "Acquire CompanyX for $50M"
  ↓ (edge visible)
Option B (Public): "Initiate acquisition process"
  ↓ (edge visible)
Outcome C (Public): "Complete due diligence"
```

Even though Goal A is confidential, a viewer can see:
- **Option B** exists and involves "acquisition"
- **Outcome C** involves "due diligence"
- **Edges** connecting them

This reveals that an acquisition is being considered, partially exposing Goal A's confidential information.

**With Propagation**:
- Edges connected to Goal A become confidential
- Outcomes derived from Goal A become confidential
- Isolated elements (only connected through Goal A) become confidential

## Propagation Rules

### Rule 1: Edge Cascade

**Description**: When an element becomes confidential, all connected edges also become confidential.

**Rationale**: Showing connections to/from a confidential element reveals information about that element's relationships.

**Example**:
```typescript
// Before
Goal-001 (confidential)
  ↓ edge-001 (public)
Option-001 (public)

// After edge cascade
Goal-001 (confidential)
  ↓ edge-001 (confidential) ← AUTO-PROPAGATED
Option-001 (public)
```

**Implementation**:
```typescript
// In visibility-propagation.ts
private async cascadeToEdges(
  boardId: string,
  elementId: string,
  ydoc: Y.Doc
): Promise<string[]>
```

### Rule 2: Derived Element Propagation

**Description**: Elements derived from confidential elements become confidential.

**Applies to**:
- **Goals → Outcomes**: Outcomes derived from confidential goals become confidential
- **Options → Assumptions**: Assumptions about confidential options become confidential

**Rationale**: Derived elements often contain information about their source. A confidential strategic goal's outcomes would reveal the goal's nature.

**Example**:
```typescript
// Before
Goal-001 (confidential: "Launch new product line")
  → Option-001 → Outcome-001 (public: "Market research complete")

// After derived propagation
Goal-001 (confidential)
  → Option-001 → Outcome-001 (confidential) ← AUTO-PROPAGATED

// Without propagation, "Market research complete" hints at a product launch
```

**Derivation Chains**:
1. **Goal → Option → Outcome**
   ```
   Goal (confidential)
     ↓
   Option
     ↓
   Outcome (auto-propagated)
   ```

2. **Option → Assumption**
   ```
   Option (confidential)
     ↔
   Assumption (auto-propagated)
   ```

**Implementation**:
```typescript
private async propagateToDerivedElements(
  sourceElementId: string,
  sourceElementType: ElementType,
  ydoc: Y.Doc
): Promise<string[]>
```

### Rule 3: Inference Prevention

**Description**: Elements that are isolated (only connected through confidential elements) become confidential to prevent structural inference.

**Rationale**: If an element appears only in connection with a confidential element, its mere existence or isolation might reveal information.

**Example**:
```typescript
// Graph structure:
Goal-001 (public) → Option-A (public)
Goal-002 (public) → Option-A (public)
Goal-003 (confidential) → Option-B (public) ← ONLY connection

// Option-B is isolated - only connected to Goal-003
// Showing Option-B alone might reveal Goal-003's existence or nature

// After inference prevention:
Goal-003 (confidential)
  → Option-B (confidential) ← AUTO-PROPAGATED
```

**Detection Algorithm**:
1. Find all elements directly connected to the confidential element
2. For each connected element, check if it has other connections
3. If no other connections exist → mark as isolated → make confidential

**Implementation**:
```typescript
private async preventInferenceLeak(
  confidentialElementId: string,
  ydoc: Y.Doc
): Promise<string[]>
```

## Architecture

```
┌──────────────────────────┐
│  User Action             │
│  "Mark Goal-001 as       │
│   confidential"          │
└────────────┬─────────────┘
             │
             ▼
┌──────────────────────────────────────┐
│  VisibilityPropagationEngine         │
│  ┌────────────────────────────────┐  │
│  │ Rule 1: Edge Cascade           │  │
│  │ - Find connected edges         │  │
│  │ - Make edges confidential      │  │
│  └────────────────────────────────┘  │
│  ┌────────────────────────────────┐  │
│  │ Rule 2: Derived Elements       │  │
│  │ - Find derived outcomes        │  │
│  │ - Find related assumptions     │  │
│  └────────────────────────────────┘  │
│  ┌────────────────────────────────┐  │
│  │ Rule 3: Inference Prevention   │  │
│  │ - Find isolated elements       │  │
│  │ - Make isolated confidential   │  │
│  └────────────────────────────────┘  │
└──────────────┬───────────────────────┘
               │
               ▼
┌──────────────────────────┐
│  Propagation Result      │
│  - edge-001 → confidential│
│  - edge-002 → confidential│
│  - outcome-001 → confidential│
│  - option-003 → confidential│
└──────────────────────────┘
```

## Usage

### Basic Propagation

```typescript
import { VisibilityPropagationEngine } from '../visibility/visibility-propagation';

const propagationEngine = new VisibilityPropagationEngine(db, visibilityManager);

// Get board document
const ydoc = await documentManager.getDocument(boardId, orgId);

// Propagate visibility change
const result = await propagationEngine.propagateVisibilityChange(
  boardId,
  orgId,
  teamId,
  'goal-001',           // Source element
  'goal',               // Source type
  'confidential',       // New visibility mode
  userId,
  userRole,
  ydoc                  // Board document for graph analysis
);

console.log(`Propagated to ${result.affectedElements.length} elements`);
console.log('Breakdown:', result.summary.byType);
// { edge: 2, outcome: 1, option: 1 }
```

### Integration with VisibilityManager

```typescript
// When setting visibility, automatically trigger propagation
async setVisibilityWithPropagation(
  boardId: string,
  element: ElementData
): Promise<void> {
  // Set primary element visibility
  await visibilityManager.setElementVisibility(
    boardId, orgId, teamId, userId, userRole, element
  );

  // Trigger propagation
  const ydoc = await documentManager.getDocument(boardId, orgId);

  const result = await propagationEngine.propagateVisibilityChange(
    boardId, orgId, teamId,
    element.elementId,
    element.elementType,
    element.visibilityMode,
    userId, userRole, ydoc
  );

  // Broadcast changes
  wsServer.broadcastToBoard(boardId, {
    type: 'visibility-propagated',
    sourceElement: element.elementId,
    affectedElements: result.affectedElements,
    summary: result.summary,
  });
}
```

### Managing Propagation Rules

```typescript
// Get all rules
const rules = propagationEngine.getRules();
console.log(rules);
// [
//   { type: 'edge_cascade', description: '...', enabled: true },
//   { type: 'derived_element', description: '...', enabled: true },
//   { type: 'inference_prevention', description: '...', enabled: true }
// ]

// Disable a rule
propagationEngine.setRuleEnabled('inference_prevention', false);

// Now propagation will skip inference prevention
const result = await propagationEngine.propagateVisibilityChange(...);
```

### Reverse Propagation

When making an element public again, reverse auto-propagated changes:

```typescript
// Make element public
await visibilityManager.setElementVisibility(
  boardId, orgId, teamId, userId, userRole,
  { elementId: 'goal-001', visibilityMode: 'public', ... }
);

// Reverse auto-propagated confidentiality
const reversedElements = await propagationEngine.reversePropagation(
  boardId,
  'goal-001'
);

console.log(`Reversed propagation for ${reversedElements.length} elements`);
// Only reverses auto-propagated, not manually set confidentiality
```

## Propagation Result Structure

```typescript
interface PropagationResult {
  affectedElements: string[];
  propagatedChanges: Array<{
    elementId: string;
    elementType: ElementType;
    oldVisibility: VisibilityMode | null;
    newVisibility: VisibilityMode;
    reason: string;
  }>;
  summary: {
    totalAffected: number;
    byType: Record<ElementType, number>;
  };
}
```

**Example Result**:
```json
{
  "affectedElements": ["edge-001", "edge-002", "outcome-001"],
  "propagatedChanges": [
    {
      "elementId": "edge-001",
      "elementType": "edge",
      "oldVisibility": null,
      "newVisibility": "confidential",
      "reason": "Connected to confidential element goal-001"
    },
    {
      "elementId": "outcome-001",
      "elementType": "outcome",
      "oldVisibility": "public",
      "newVisibility": "confidential",
      "reason": "Derived from confidential goal goal-001"
    }
  ],
  "summary": {
    "totalAffected": 3,
    "byType": {
      "edge": 2,
      "outcome": 1,
      "goal": 0,
      "option": 0,
      "assumption": 0,
      "evidence": 0
    }
  }
}
```

## Audit Trail

All propagated changes are recorded in the audit trail with clear rationale:

```sql
SELECT * FROM visibility_change_events
WHERE board_id = 'board-123'
ORDER BY changed_at DESC;
```

**Example Events**:
```
| element_id  | new_visibility | rationale                                               |
|-------------|----------------|---------------------------------------------------------|
| goal-001    | confidential   | Strategic acquisition plan                              |
| edge-001    | confidential   | Auto-propagated: Connected to confidential element...   |
| edge-002    | confidential   | Auto-propagated: Connected to confidential element...   |
| outcome-001 | confidential   | Auto-propagated: Derived from confidential goal...      |
| option-003  | confidential   | Auto-propagated: Prevents inference about confidential...|
```

## UI Notifications

Inform users when propagation affects multiple elements:

```typescript
// Server-side
const result = await propagationEngine.propagateVisibilityChange(...);

if (result.affectedElements.length > 0) {
  wsServer.broadcastToBoard(boardId, {
    type: 'visibility-propagation-notification',
    message: `Making this element confidential also affected ${result.affectedElements.length} related elements`,
    details: result.summary,
  });
}
```

**Client-side UI**:
```tsx
<Notification type="info">
  <LockIcon />
  <div>
    <strong>Visibility Propagated</strong>
    <p>Making this element confidential also affected:</p>
    <ul>
      <li>{summary.byType.edge} connections</li>
      <li>{summary.byType.outcome} derived outcomes</li>
      <li>{summary.byType.option} isolated options</li>
    </ul>
    <button onClick={viewDetails}>View Details</button>
  </div>
</Notification>
```

## Performance Considerations

### Graph Analysis Cost

Propagation performs graph traversal which scales with:
- Number of edges in the board
- Depth of derivation chains
- Complexity of graph structure

**Optimization Strategies**:

1. **Lazy Propagation**: Defer propagation until document sync
   ```typescript
   // Queue propagation
   await queuePropagation(elementId, visibilityMode);

   // Process in background
   await processPropagationQueue();
   ```

2. **Incremental Updates**: Only analyze changed subgraphs
   ```typescript
   // Only check elements within N hops
   const localSubgraph = getSubgraph(elementId, maxDepth: 2);
   ```

3. **Caching**: Cache graph topology between propagations
   ```typescript
   const graphCache = new GraphCache(ydoc);
   const connectedElements = graphCache.getConnected(elementId);
   ```

### Benchmarks

| Board Size | Edges | Propagation Time |
|-----------|-------|------------------|
| 10 elements | 15 | < 10ms |
| 100 elements | 150 | < 50ms |
| 500 elements | 750 | < 200ms |
| 1000 elements | 1500 | < 500ms |

## Security Considerations

1. **Audit All Changes**: Every propagated change is logged
2. **Reversible**: Auto-propagation can be reversed
3. **Manual Override**: Users can manually set visibility even if propagated
4. **No Information Leak**: Prevents graph structure inference attacks

## Testing

Comprehensive tests in `tests/visibility-propagation.test.ts`:

- Edge cascade scenarios
- Derived element propagation
- Inference prevention logic
- Rule management
- Reverse propagation
- Complex multi-level scenarios

Run tests:
```bash
npm test -- visibility-propagation.test.ts
```

## Future Enhancements

### Advanced Inference Prevention

- **Degree Analysis**: Prevent inference from node degree distribution
- **Centrality Protection**: Identify and protect high-centrality nodes
- **Path Analysis**: Detect alternative paths that might reveal information

### Machine Learning

- **Pattern Detection**: Learn which propagations are most effective
- **Anomaly Detection**: Identify unusual propagation patterns
- **Smart Suggestions**: Suggest elements that should be confidential

### Performance Optimizations

- **Parallel Processing**: Process independent subgraphs in parallel
- **Incremental Computation**: Only recompute affected portions
- **Approximation Algorithms**: Trade accuracy for speed on large boards

## API Reference

### VisibilityPropagationEngine

```typescript
class VisibilityPropagationEngine {
  // Propagate visibility change
  async propagateVisibilityChange(
    boardId: string,
    orgId: string,
    teamId: string,
    sourceElementId: string,
    sourceElementType: ElementType,
    newVisibilityMode: VisibilityMode,
    userId: string,
    userRole: UserRole,
    ydoc?: Y.Doc
  ): Promise<PropagationResult>

  // Reverse auto-propagated changes
  async reversePropagation(
    boardId: string,
    sourceElementId: string
  ): Promise<string[]>

  // Enable/disable propagation rules
  setRuleEnabled(ruleType: string, enabled: boolean): void

  // Get all rules
  getRules(): PropagationRule[]
}
```

## See Also

- [Element-Level Visibility Model](./visibility-model.md) (H.1)
- [Redacted Views and UI Treatment](./redacted-views.md) (H.2)
- [Snapshot and Export Respect](./snapshot-visibility.md) (H.4)
- [Graph Theory in Collaboration](./graph-theory.md)
