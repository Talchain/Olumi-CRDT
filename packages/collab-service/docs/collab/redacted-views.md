# Redacted Views and UI Treatment

**Phase 4, Section H.2: Selective Information Sharing - Client-Side Filtering**

## Overview

The Redacted Views system provides client-side document filtering based on element-level visibility permissions. When users access collaborative boards, confidential elements they don't have permission to view are automatically replaced with redacted placeholders.

## Architecture

```
┌─────────────────┐
│  Source Y.Doc   │  ← Full board document (server-side)
└────────┬────────┘
         │
         │ VisibilityFilter.filterDocument()
         │
         ├─────► Check ElementVisibility records
         │
         ├─────► Apply VisibilityManager.canViewElement()
         │
         ├─────► Replace confidential elements with placeholders
         │
         ▼
┌─────────────────┐
│ Filtered Y.Doc  │  → User-specific view (client receives this)
└─────────────────┘
```

## Core Components

### VisibilityFilter

**Location**: `src/visibility/visibility-filter.ts`

The `VisibilityFilter` class provides document filtering operations:

```typescript
export class VisibilityFilter {
  constructor(visibilityManager: VisibilityManager)

  // Filter document (creates new Y.Doc)
  async filterDocument(
    sourceDoc: Y.Doc,
    boardId: string,
    userId: string,
    userRole: UserRole
  ): Promise<FilteredDocument>

  // Quick preview without full filtering
  async getRedactionPreview(
    boardId: string,
    userId: string,
    userRole: UserRole
  ): Promise<RedactionPreview>

  // Destructive in-place filtering
  async applyFilterInPlace(
    doc: Y.Doc,
    boardId: string,
    userId: string,
    userRole: UserRole
  ): Promise<{ redactedCount: number; redactedElements: RedactedElement[] }>
}
```

### FilteredDocument

The result of document filtering includes:

```typescript
interface FilteredDocument {
  filteredDoc: Y.Doc;              // Filtered Yjs document
  redactedElements: RedactedElement[];  // List of redacted elements
  redactionSummary: {
    totalElements: number;
    visibleElements: number;
    redactedElements: number;
    redactedByType: Record<ElementType, number>;
  };
}
```

## Usage Examples

### Basic Document Filtering

```typescript
import { VisibilityFilter } from '../visibility/visibility-filter';
import { VisibilityManager } from '../visibility/visibility-manager';

const visibilityManager = new VisibilityManager(db);
const visibilityFilter = new VisibilityFilter(visibilityManager);

// Get full document from DocumentManager
const sourceDoc = await documentManager.getDocument(boardId, orgId);

// Filter for specific user
const result = await visibilityFilter.filterDocument(
  sourceDoc,
  boardId,
  userId,
  userRole
);

// Send filtered document to client
const filteredUpdate = Y.encodeStateAsUpdate(result.filteredDoc);
ws.send(filteredUpdate);

// Log redaction summary
console.log(`Redacted ${result.redactionSummary.redactedElements} elements`);
console.log(`Visible: ${result.redactionSummary.visibleElements}`);
```

### Quick Redaction Preview

Before performing expensive full-document filtering, check if redactions are needed:

```typescript
const preview = await visibilityFilter.getRedactionPreview(
  boardId,
  userId,
  userRole
);

if (!preview.hasRedactions) {
  // No confidential elements - send full document
  return fullDocument;
}

console.log(`${preview.inaccessibleCount} elements will be redacted`);

// Proceed with filtering
const filtered = await visibilityFilter.filterDocument(
  sourceDoc,
  boardId,
  userId,
  userRole
);
```

### WebSocket Integration

```typescript
// In WebSocket connection handler
ws.on('sync-request', async () => {
  const sourceDoc = await documentManager.getDocument(boardId, orgId);

  // Check if filtering is needed
  const preview = await visibilityFilter.getRedactionPreview(
    boardId,
    connInfo.userId,
    connInfo.teamRole
  );

  if (preview.hasRedactions) {
    // Filter document before sending
    const result = await visibilityFilter.filterDocument(
      sourceDoc,
      boardId,
      connInfo.userId,
      connInfo.teamRole
    );

    // Send filtered view
    const update = Y.encodeStateAsUpdate(result.filteredDoc);
    ws.send(update);

    // Notify client about redactions
    ws.send(JSON.stringify({
      type: 'redaction-summary',
      summary: result.redactionSummary,
    }));
  } else {
    // Send full document
    const update = Y.encodeStateAsUpdate(sourceDoc);
    ws.send(update);
  }
});
```

### In-Place Filtering

For scenarios where you want to modify the document directly (destructive operation):

```typescript
// WARNING: This modifies the document in-place
const doc = await documentManager.getDocument(boardId, orgId);

const result = await visibilityFilter.applyFilterInPlace(
  doc,
  boardId,
  userId,
  userRole
);

console.log(`Modified ${result.redactedCount} elements in place`);
```

**⚠️ Warning**: `applyFilterInPlace` is destructive and should only be used when you explicitly want to modify the source document. Prefer `filterDocument()` for read-only filtering.

## Redacted Element Structure

Confidential elements are replaced with redacted placeholders:

```typescript
// Original element (confidential)
{
  id: 'goal-123',
  type: 'goal',
  text: 'Acquire competitor X for $50M',
  description: 'Strategic acquisition details...',
  priority: 'high'
}

// Redacted placeholder
{
  id: 'goal-123',
  type: 'goal',
  redacted: true,
  text: '[Confidential Goal]',
  createdAt: '2025-01-15T10:00:00Z'
}
```

### Redacted Placeholders by Element Type

- **Goals**: `[Confidential Goal]`
- **Options**: `[Confidential Option]`
- **Outcomes**: `[Confidential Outcome]`
- **Assumptions**: `[Confidential Assumption]`
- **Evidence**: `[Confidential Evidence]`
- **Edges**: `[Confidential Connection]`

## UI Treatment Guidelines

### Visual Indicators

1. **Redacted Elements**
   - Display placeholder text in italics
   - Use muted/gray color scheme
   - Show lock icon 🔒
   - Disable editing/interaction

2. **Partially Visible Boards**
   - Show banner: "Some elements are hidden due to confidentiality"
   - Display redaction summary count
   - Provide "Request Access" button (H.5)

3. **Redacted Connections**
   - Show dashed lines for redacted edges
   - Hide connection labels
   - Maintain graph structure visibility

### CSS Example

```css
.redacted-element {
  font-style: italic;
  color: #9ca3af; /* gray-400 */
  background: #f3f4f6; /* gray-100 */
  border: 1px dashed #d1d5db; /* gray-300 */
  pointer-events: none;
  user-select: none;
}

.redacted-element::before {
  content: '🔒 ';
}

.redaction-banner {
  background: #fef3c7; /* amber-100 */
  border-left: 4px solid #f59e0b; /* amber-500 */
  padding: 12px 16px;
  margin-bottom: 16px;
}
```

### React Component Example

```tsx
interface ElementProps {
  element: any;
  canEdit: boolean;
}

const BoardElement: React.FC<ElementProps> = ({ element, canEdit }) => {
  if (element.redacted) {
    return (
      <div className="redacted-element">
        <LockIcon className="inline mr-2" />
        <span>{element.text}</span>
        <button className="ml-2 text-xs">Request Access</button>
      </div>
    );
  }

  return (
    <div className="normal-element">
      <span>{element.text}</span>
      {canEdit && <EditButton />}
    </div>
  );
};
```

## Performance Considerations

### Filtering Cost

Document filtering has computational cost proportional to:
- Number of elements in the document
- Number of confidential elements
- Complexity of permission checks

**Optimization strategies**:

1. **Use Redaction Preview** before full filtering:
   ```typescript
   const preview = await visibilityFilter.getRedactionPreview(
     boardId,
     userId,
     userRole
   );

   if (!preview.hasRedactions) {
     // Skip expensive filtering
     return fullDocument;
   }
   ```

2. **Cache filtered documents** per user:
   ```typescript
   const cacheKey = `filtered:${boardId}:${userId}`;
   let filtered = cache.get(cacheKey);

   if (!filtered) {
     filtered = await visibilityFilter.filterDocument(
       sourceDoc,
       boardId,
       userId,
       userRole
     );
     cache.set(cacheKey, filtered, { ttl: 300 }); // 5 min TTL
   }
   ```

3. **Invalidate cache** on visibility changes:
   ```typescript
   // When visibility changes
   await visibilityManager.setElementVisibility(...);

   // Invalidate all cached filtered views for this board
   cache.deletePattern(`filtered:${boardId}:*`);

   // Broadcast visibility-changed event
   wsServer.broadcastToBoard(boardId, {
     type: 'visibility-changed',
     elementId,
   });
   ```

### Performance Benchmarks

| Document Size | Confidential Elements | Filtering Time |
|---------------|----------------------|----------------|
| 10 elements   | 2                    | < 10ms         |
| 100 elements  | 20                   | < 100ms        |
| 500 elements  | 100                  | < 500ms        |
| 1000 elements | 200                  | < 1000ms       |

## Real-Time Sync with Visibility Changes

When element visibility changes, all connected clients must receive updates:

### Server-Side Event Handler

```typescript
// After visibility change
await visibilityManager.setElementVisibility(
  boardId,
  orgId,
  teamId,
  userId,
  userRole,
  { elementId, visibilityMode, ... }
);

// Broadcast to all connected users
wsServer.broadcastToBoard(boardId, {
  type: 'visibility-changed',
  elementId,
  visibilityMode,
  timestamp: new Date().toISOString(),
});
```

### Client-Side Event Handler

```typescript
ws.on('message', (message) => {
  const event = JSON.parse(message);

  if (event.type === 'visibility-changed') {
    // Re-fetch filtered document
    requestFilteredSync();

    // Update UI
    showNotification(`Element visibility changed`);

    // Highlight affected element
    highlightElement(event.elementId);
  }
});
```

## Integration with DocumentManager

The `VisibilityFilter` is integrated into `DocumentManager`:

```typescript
export class DocumentManager {
  public visibilityFilter: VisibilityFilter;

  constructor(db: DatabaseClient) {
    this.visibilityManager = new VisibilityManager(db);
    this.visibilityFilter = new VisibilityFilter(this.visibilityManager);
  }

  async getFilteredDocument(
    boardId: string,
    orgId: string,
    userId: string,
    userRole: UserRole
  ): Promise<FilteredDocument> {
    const sourceDoc = await this.getDocument(boardId, orgId);
    return this.visibilityFilter.filterDocument(
      sourceDoc,
      boardId,
      userId,
      userRole
    );
  }
}
```

## Testing

Comprehensive tests are provided in `tests/visibility-filter.test.ts`:

- **Document Filtering**: Basic redaction, whitelisting, multi-type filtering
- **Edge Filtering**: Connection redaction
- **Metadata Handling**: Filtered document metadata
- **Redaction Preview**: Quick pre-checks
- **In-Place Filtering**: Destructive modifications
- **Performance**: Large document handling

Run tests:
```bash
npm test -- visibility-filter.test.ts
```

## Security Considerations

1. **Server-Side Enforcement**: Always filter on the server before sending to clients
2. **No Client Bypass**: Clients cannot request unfiltered documents
3. **Audit Trail**: All visibility changes are logged in `visibility_change_events`
4. **Metadata Filtering**: Filtered documents include `filteredAt` and `filteredForUser` metadata
5. **Cache Invalidation**: Cached filtered documents must be invalidated on visibility changes

## Future Enhancements

### H.3: Visibility Propagation Rules
- Automatic cascading of visibility to connected elements
- Smart redaction of derived elements

### H.4: Snapshot and Export Respect
- Apply visibility filtering to snapshots
- Ensure exports respect visibility permissions

### H.5: Access Request Workflow
- UI for requesting access to confidential elements
- Approval workflow for access requests

### H.6: Security Hardening
- Cryptographic element redaction
- Zero-knowledge proofs for element existence
- Audit logging for access attempts

## API Reference

### VisibilityFilter Class

#### `filterDocument(sourceDoc, boardId, userId, userRole)`

Creates a new filtered Y.Doc with confidential elements redacted.

**Parameters**:
- `sourceDoc: Y.Doc` - Source document to filter
- `boardId: string` - Board identifier
- `userId: string` - User requesting filtered view
- `userRole: UserRole` - User's role on the board

**Returns**: `Promise<FilteredDocument>`

**Example**:
```typescript
const result = await visibilityFilter.filterDocument(
  sourceDoc,
  'board-123',
  'user-456',
  UserRole.VIEWER
);
```

#### `getRedactionPreview(boardId, userId, userRole)`

Quick check for confidential elements without full filtering.

**Parameters**:
- `boardId: string` - Board identifier
- `userId: string` - User identifier
- `userRole: UserRole` - User's role

**Returns**: `Promise<RedactionPreview>`

**Example**:
```typescript
const preview = await visibilityFilter.getRedactionPreview(
  'board-123',
  'user-456',
  UserRole.VIEWER
);

if (preview.hasRedactions) {
  console.log(`${preview.inaccessibleCount} elements will be hidden`);
}
```

#### `applyFilterInPlace(doc, boardId, userId, userRole)`

Destructively modifies document in-place to redact confidential elements.

**Parameters**:
- `doc: Y.Doc` - Document to modify
- `boardId: string` - Board identifier
- `userId: string` - User identifier
- `userRole: UserRole` - User's role

**Returns**: `Promise<{ redactedCount: number; redactedElements: RedactedElement[] }>`

**⚠️ Warning**: This is a destructive operation.

## See Also

- [Element-Level Visibility Model](./visibility-model.md) (H.1)
- [Visibility Propagation Rules](./visibility-propagation.md) (H.3)
- [Snapshot and Export Respect](./snapshot-visibility.md) (H.4)
- [Authorization](./authorization.md)
- [Comments + Evidence Integration](./comments-evidence.md)
