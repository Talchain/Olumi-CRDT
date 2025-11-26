# Multi-tenant Security Architecture

**Status**: ✅ Complete (Phase 2, Section 3)
**Date**: 2025-11-23

---

## Overview

The collaboration service implements enterprise-grade multi-tenant security with:

1. **Organizational Isolation**: Complete data separation between organizations
2. **Team-based Access Control**: Board access tied to team membership
3. **Role-based Permissions**: Hierarchical roles (Viewer, Editor, Admin, Owner)
4. **WebSocket Security**: Real-time authorization enforcement
5. **API Security**: Enhanced authorization on all REST endpoints

---

## Authorization Hierarchy

### Three-tier Hierarchy

```
Organization
  └── Team 1
       └── Board A
       └── Board B
  └── Team 2
       └── Board C
```

**Rules**:
- Users belong to an organization
- Users are members of one or more teams within their organization
- Boards belong to a specific team
- Users can only access boards in teams they're members of

### Cross-tenant Isolation

| Scenario | Result |
|----------|--------|
| User in Org A tries to access board in Org B | ❌ Denied (CROSS_ORG_ACCESS_DENIED) |
| User in Team 1 tries to access board in Team 2 (same org) | ❌ Denied (CROSS_TEAM_ACCESS_DENIED) |
| User in correct org + team | ✅ Allowed (subject to role) |

---

## Role-based Access Control (RBAC)

### Role Hierarchy

From lowest to highest privilege:

1. **VIEWER** - Read-only access
2. **EDITOR** - Can edit and comment
3. **ADMIN** - Can manage permissions
4. **OWNER** - Full control

**Inheritance**: Higher roles inherit all permissions from lower roles.

### Permission Matrix

| Operation | VIEWER | EDITOR | ADMIN | OWNER |
|-----------|--------|--------|-------|-------|
| View board | ✅ | ✅ | ✅ | ✅ |
| View snapshots | ✅ | ✅ | ✅ | ✅ |
| Edit board (WebSocket) | ❌ | ✅ | ✅ | ✅ |
| Create snapshots | ❌ | ✅ | ✅ | ✅ |
| Trigger engine runs | ❌ | ✅ | ✅ | ✅ |
| Manage permissions | ❌ | ❌ | ✅ | ✅ |
| Delete board | ❌ | ❌ | ❌ | ✅ |

---

## Implementation

### Database Schema

#### Team Memberships Table

```sql
CREATE TABLE team_memberships (
  user_id UUID NOT NULL,
  team_id UUID NOT NULL,
  org_id UUID NOT NULL,
  role VARCHAR(50) NOT NULL, -- 'viewer', 'editor', 'admin', 'owner'
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  PRIMARY KEY (user_id, team_id)
);

CREATE INDEX idx_team_memberships_user ON team_memberships(user_id, org_id);
CREATE INDEX idx_team_memberships_team ON team_memberships(team_id);
```

#### Boards Table Update

```sql
ALTER TABLE boards ADD COLUMN team_id UUID NOT NULL;
CREATE INDEX idx_boards_team_id ON boards(team_id);
```

### Authorization Module

**File**: `src/auth/authorization.ts`

Core functions:

```typescript
// Check board access with minimum required role
checkBoardAccess(
  board: BoardDocument,
  userContext: EnhancedUserContext,
  requiredRole: UserRole = UserRole.VIEWER
): AuthorizationResult

// Shorthand for edit permission (requires EDITOR)
checkEditAccess(board, userContext): AuthorizationResult

// Shorthand for snapshot operations (requires EDITOR)
checkSnapshotAccess(board, userContext): AuthorizationResult

// Shorthand for admin operations (requires ADMIN)
checkAdminAccess(board, userContext): AuthorizationResult

// Check if user is owner or has OWNER role
checkOwnerAccess(board, userContext): AuthorizationResult
```

**Authorization Flow**:

1. Check org match: `board.orgId === user.orgId`
2. Check team membership: `user.teamIds.includes(board.teamId)`
3. Get user's role in that team: `user.getTeamRole(board.teamId)`
4. Check role hierarchy: `hasAccess(userRole, requiredRole)`

### WebSocket Security

**File**: `src/collab/websocket-server.ts`

**Connection-time Authorization**:

```typescript
async handleUpgrade(request, socket, head) {
  // 1. Verify JWT token
  const userContext = await verifyToken(token);

  // 2. Check board access (org + team + role)
  const hasAccess = await checkBoardAccess(boardId, userContext);

  // 3. Only upgrade if authorized
  if (hasAccess) {
    wss.handleUpgrade(request, socket, head, callback);
  }
}
```

**Message-time Authorization**:

```typescript
handleMessage(ws, connInfo, data) {
  const messageType = data[0];

  // Check if this is an edit operation (Yjs update)
  if (isEditOperation(messageType)) {
    // Viewers cannot send edit operations
    if (connInfo.teamRole === UserRole.VIEWER) {
      sendError(ws, 'FORBIDDEN', 'Viewers cannot edit');
      return;
    }
  }

  // Process message...
}
```

**Key Features**:

- Team role stored in `ConnectionInfo` for fast checks
- Edit operations blocked at WebSocket level for viewers
- Awareness updates allowed for all roles (cursor, selection)

### REST API Security

**File**: `src/api/routes.ts`

All endpoints updated to use enhanced authorization:

```typescript
app.get('/api/collab/boards/:boardId/snapshot', async (req, res) => {
  const board = await db.getBoard(boardId);
  const enhancedContext = createEnhancedUserContext(req.user);

  // Requires at least VIEWER role
  const authResult = checkBoardAccess(board, enhancedContext, UserRole.VIEWER);

  if (!authResult.authorized) {
    return res.code(403).send({
      error: AuthorizationErrors[authResult.reason],
    });
  }

  // ... return snapshot
});
```

**Endpoint Authorization**:

| Endpoint | Required Role |
|----------|---------------|
| `GET /boards/:id/snapshot` | VIEWER |
| `POST /boards/:id/snapshot` | EDITOR |
| `GET /boards/:id/status` | VIEWER |
| `GET /boards/:id/run-input` | EDITOR |

---

## User Context

### Enhanced User Context

```typescript
interface EnhancedUserContext {
  userId: string;
  orgId: string;
  email: string;
  teamMemberships: Array<{ teamId: string; role: UserRole }>;
  teamIds: string[]; // Convenience array of team IDs
  getTeamRole(teamId: string): UserRole | null;
}
```

**Creation**:

```typescript
const enhancedContext = createEnhancedUserContext(userContext);
```

**Team Role Lookup**:

```typescript
const role = enhancedContext.getTeamRole(board.teamId);
// Returns: 'viewer' | 'editor' | 'admin' | 'owner' | null
```

---

## Error Handling

### Authorization Errors

```typescript
const AuthorizationErrors = {
  CROSS_ORG_ACCESS_DENIED: 'Access denied: board belongs to a different organization',
  CROSS_TEAM_ACCESS_DENIED: 'Access denied: you are not a member of this team',
  NO_TEAM_ROLE: 'Access denied: no role found for this team',
  INSUFFICIENT_ROLE: 'Access denied: insufficient permissions',
  VIEWER_CANNOT_EDIT: 'Access denied: viewers cannot edit boards',
};
```

**Usage in API**:

```typescript
if (!authResult.authorized) {
  logger.warn({ userId, boardId, reason: authResult.reason }, 'Access denied');

  return reply.code(403).send({
    success: false,
    error: AuthorizationErrors[authResult.reason] || 'Access denied',
  });
}
```

---

## Testing

### Test Coverage

**File**: `tests/multi-tenant-security.test.ts`

Test categories:

1. **Organizational Isolation** (2 tests)
   - Cross-org access denied
   - Same-org access allowed

2. **Team-level Isolation** (3 tests)
   - Cross-team access denied
   - Same-team access allowed
   - No team membership denied

3. **Role-based Access Control** (16 tests)
   - VIEWER: read only
   - EDITOR: read + edit
   - ADMIN: read + edit + admin
   - OWNER: full permissions

4. **Role Hierarchy** (1 test)
   - Verifies correct inheritance

5. **Multiple Team Memberships** (2 tests)
   - Correct team role selection
   - Multi-team scenario handling

6. **WebSocket Message Types** (1 test)
   - Edit operation detection

**Total**: 25 comprehensive tests

### Running Tests

```bash
npm test -- multi-tenant-security
```

Expected output:
```
✓ Organizational Isolation (2 tests)
✓ Team-level Isolation (3 tests)
✓ Role-based Access Control (16 tests)
✓ Role Hierarchy (1 test)
✓ Multiple Team Memberships (2 tests)
✓ WebSocket Message Types (1 test)
```

---

## Security Best Practices

### 1. Defense in Depth

Authorization enforced at multiple layers:

- **Connection time**: WebSocket upgrade authorization
- **Message time**: Edit operation authorization
- **API time**: REST endpoint authorization

### 2. Fail-Secure

All authorization checks default to **deny**:

```typescript
if (!authResult.authorized) {
  return false; // Deny by default
}
```

### 3. Principle of Least Privilege

- Viewers can only read
- Editors can only edit (not admin)
- Admins can only manage (not delete)
- Owners have full control

### 4. Privacy-Safe Logging

Authorization failures logged without sensitive data:

```typescript
logger.warn({
  boardId,
  userId,
  reason: authResult.reason, // Enum, not user content
}, 'Access denied');
```

---

## Integration with JWT

### Expected JWT Structure

```json
{
  "userId": "uuid",
  "orgId": "uuid",
  "email": "user@example.com",
  "roles": ["user"], // Legacy org-level roles
  "teamMemberships": [
    { "teamId": "uuid", "role": "editor" },
    { "teamId": "uuid", "role": "viewer" }
  ],
  "exp": 1234567890,
  "iat": 1234567890
}
```

**Current Fallback**:

If JWT doesn't include `teamMemberships`, the system queries the database:

```typescript
const teamMemberships = await db.getUserTeamMemberships(userId, orgId);
```

**TODO**: Update auth service to include `teamMemberships` in JWT payload to avoid database calls.

---

## Migration from Phase 1

### Breaking Changes

1. **BoardDocument** now requires `teamId`:
   ```typescript
   interface BoardDocument {
     // ...
     teamId: string; // NEW: Required field
   }
   ```

2. **Database schema** requires `team_id` column:
   ```sql
   ALTER TABLE boards ADD COLUMN team_id UUID;
   ```

3. **UserContext** now includes team memberships:
   ```typescript
   interface UserContext {
     // ...
     teamMemberships: Array<{ teamId: string; role: UserRole }>; // NEW
   }
   ```

### Backward Compatibility

**Database migration** handles existing tables:

```sql
-- Adds team_id column if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'boards' AND column_name = 'team_id'
  ) THEN
    ALTER TABLE boards ADD COLUMN team_id UUID;
  END IF;
END $$;
```

**Fallback authorization**: If user has no team memberships, access is denied (fail-secure).

---

## Performance Considerations

### Database Queries

**Efficient team lookup**:

```sql
-- Single indexed query for user's teams
SELECT team_id, role FROM team_memberships
WHERE user_id = ? AND org_id = ?;

-- Index on (user_id, org_id) ensures fast lookup
```

**Board access check**:

```sql
-- Single query for board metadata
SELECT org_id, team_id, owner_id, data
FROM boards WHERE id = ?;

-- Index on id (primary key) ensures instant lookup
```

### WebSocket Optimization

- Team role cached in `ConnectionInfo` (no per-message DB query)
- Edit check is O(1) comparison: `role === UserRole.VIEWER`

### API Optimization

- Enhanced user context created once per request
- Authorization result short-circuits on first failure

---

## Security Audit Checklist

- [x] Cross-org access blocked
- [x] Cross-team access blocked
- [x] Viewers cannot edit
- [x] Role hierarchy enforced
- [x] WebSocket auth at connection time
- [x] WebSocket auth at message time
- [x] API endpoints require auth
- [x] Error messages don't leak sensitive info
- [x] Comprehensive test coverage (25 tests)
- [x] Database indexes for performance
- [ ] TODO: JWT includes team memberships (currently DB fallback)
- [ ] TODO: Rate limiting per team (currently per org)
- [ ] TODO: Admin audit log for permission changes

---

## Next Steps

### Immediate

1. Update auth service to include `teamMemberships` in JWT
2. Add team-level rate limiting
3. Add admin audit log for permission changes

### Future (Phase 3)

1. IP whitelisting per organization
2. SAML/SSO integration for team assignment
3. Dynamic permission policies (e.g., time-based access)
4. Fine-grained permissions (e.g., "can comment but not edit")

---

## References

- **Authorization Module**: `src/auth/authorization.ts`
- **WebSocket Security**: `src/collab/websocket-server.ts`
- **API Security**: `src/api/routes.ts`
- **Database Schema**: `src/database/client.ts`
- **Type Definitions**: `src/types/auth.ts`, `src/types/board.ts`
- **Tests**: `tests/multi-tenant-security.test.ts`

---

**Completion**: Section 3 of Phase 2 is fully implemented and tested. Multi-tenant security is production-ready.
