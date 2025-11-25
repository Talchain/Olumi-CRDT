# Fastify Schema Validation Guide

## Overview

All API routes should use Fastify JSON schema validation for security and consistency.

**Status**: Schema definitions complete in `src/api/schemas.ts`. Pattern established.

## Why Schema Validation?

1. **Security**: Prevents malformed input attacks, injection, and resource exhaustion
2. **Auto-documentation**: Fastify generates OpenAPI/Swagger docs from schemas
3. **Performance**: Fastify compiles schemas for fast validation (faster than manual)
4. **Type safety**: Ensures request/response contracts are enforced
5. **Consistency**: Centralized validation rules across all endpoints

## How to Add Schema Validation

### Step 1: Import schemas

```typescript
import { routeSchemas } from './schemas';
```

### Step 2: Add schema to route options

**Before (no validation)**:
```typescript
app.post('/api/boards/:boardId/snapshot',
  {
    onRequest: [app.authenticate],
  },
  async (request, reply) => {
    const { boardId } = request.params;
    const { name, description } = request.body;
    // Manual validation here...
  }
);
```

**After (with schema validation)**:
```typescript
app.post('/api/boards/:boardId/snapshot',
  {
    schema: routeSchemas.createSnapshot, // <-- Add this
    onRequest: [app.authenticate],
  },
  async (request, reply) => {
    const { boardId } = request.params;
    const { name, description } = request.body;
    // No manual validation needed - schema handles it
  }
);
```

### Step 3: Remove redundant manual validation

Schema validation runs BEFORE your handler, so you can remove manual checks:

```typescript
// Remove these (schema handles it):
if (!boardId || typeof boardId !== 'string') { ... }
if (!name || name.length > 200) { ... }
if (viewerWhitelist && viewerWhitelist.length > 100) { ... }
```

## Available Schemas

### Route Schemas (`routeSchemas`)

Complete route schemas (params + body + response):

- `getHealth` - Health endpoint
- `createSnapshot` - Create board snapshot
- `getSnapshots` - List snapshots
- `renameSnapshot` - Rename snapshot
- `changeVisibility` - Change element visibility
- `createVisibilityPolicy` - Create visibility policy
- `createReview` - Create review request
- `updateReviewer` - Complete review with decision
- `addReviewComment` - Add review comment
- `createAccessRequest` - Request board access
- `approveAccessRequest` - Approve access request
- `denyAccessRequest` - Deny access request
- `addComment` - Add comment to element
- `getComments` - Get element comments

### Building Custom Schemas

If you need a custom schema not in `routeSchemas`:

```typescript
import { boardIdParams, uuidSchema, elementIdSchema } from './schemas';

app.post('/api/custom-endpoint',
  {
    schema: {
      params: boardIdParams,
      body: {
        type: 'object',
        required: ['custom_field'],
        properties: {
          custom_field: { type: 'string', maxLength: 100 },
          element_ids: {
            type: 'array',
            items: elementIdSchema,
            maxItems: 50,
          },
        },
        additionalProperties: false, // IMPORTANT: prevents unexpected fields
      },
      response: {
        200: {
          type: 'object',
          required: ['success'],
          properties: {
            success: { type: 'boolean' },
            data: { type: 'object' },
          },
        },
        400: errorResponse,
      },
    },
  },
  async (request, reply) => {
    // Handler code
  }
);
```

## Common Patterns

### UUID Parameters

```typescript
import { boardIdParams, snapshotIdParams, reviewIdParams } from './schemas';

schema: {
  params: boardIdParams, // for /boards/:boardId
  // or
  params: snapshotIdParams, // for /snapshots/:snapshotId
  // or
  params: reviewIdParams, // for /reviews/:reviewId
}
```

### Element IDs

```typescript
import { elementIdSchema } from './schemas';

properties: {
  element_id: elementIdSchema, // Validates: type-identifier pattern
  cascaded: {
    type: 'array',
    items: elementIdSchema,
    maxItems: 500,
  },
}
```

### Enums (Visibility, Roles, etc.)

```typescript
import { visibilityModeSchema, userRoleSchema } from './schemas';

properties: {
  new_mode: visibilityModeSchema, // 'public' | 'confidential'
  requested_role: userRoleSchema, // 'VIEWER' | 'EDITOR' | 'ADMIN' | 'OWNER'
}
```

### Arrays with Limits

```typescript
properties: {
  reviewer_user_ids: {
    type: 'array',
    items: uuidSchema,
    minItems: 1, // At least one required
    maxItems: 50, // Prevent resource exhaustion
    uniqueItems: true, // No duplicates
  },
}
```

### Optional Fields

```typescript
properties: {
  required_field: { type: 'string' }, // In "required" array
  optional_field: { type: 'string' }, // Not in "required" array
},
required: ['required_field'], // Only required fields listed
```

## Error Handling

Fastify automatically returns 400 Bad Request for schema validation failures:

```json
{
  "statusCode": 400,
  "error": "Bad Request",
  "message": "body should have required property 'element_id'"
}
```

No need to handle validation errors manually!

## Migration Checklist

For each route:

- [ ] Import `routeSchemas` from `./schemas`
- [ ] Add `schema:` property to route options
- [ ] Choose appropriate schema from `routeSchemas` OR build custom
- [ ] Remove manual validation code (typeof checks, length checks, etc.)
- [ ] Test endpoint with valid and invalid requests
- [ ] Verify 400 errors for malformed input

## Routes to Update

### High Priority (Security-Critical)

- [ ] `/api/boards/:boardId/visibility` - Change visibility
- [ ] `/api/boards/:boardId/visibility/policies` - Visibility policies
- [ ] `/api/boards/:boardId/reviews` - Create reviews
- [ ] `/api/access-requests` - Access request routes

### Medium Priority

- [ ] `/api/boards/:boardId/snapshot` - Snapshot operations
- [ ] `/api/snapshots/:snapshotId/*` - Snapshot management
- [ ] `/api/boards/:boardId/comments` - Comments

### Low Priority (Read-Only)

- [ ] `/api/boards/:boardId` - Get board
- [ ] `/api/snapshots/:snapshotId` - Get snapshot
- [ ] GET routes for reviews, policies, comments

## Testing Schema Validation

### Valid Request (should succeed)

```bash
curl -X POST http://localhost:3001/api/boards/abc123/snapshot \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "Test Snapshot", "description": "Optional description"}'
```

### Invalid Request (should return 400)

```bash
# Missing required field
curl -X POST http://localhost:3001/api/boards/abc123/snapshot \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"description": "Missing name field"}'

# Expected response:
# {"statusCode": 400, "error": "Bad Request", "message": "body should have required property 'name'"}

# Field too long
curl -X POST http://localhost:3001/api/boards/abc123/snapshot \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "'$(python3 -c "print('A'*300)")'"}'

# Expected response:
# {"statusCode": 400, "error": "Bad Request", "message": "body/name should NOT be longer than 200 characters"}
```

## References

- [Fastify Validation Documentation](https://fastify.dev/docs/latest/Reference/Validation-and-Serialization/)
- [JSON Schema Specification](https://json-schema.org/)
- `src/api/schemas.ts` - All schema definitions
- `src/utils/validation.ts` - Validation limits and patterns
