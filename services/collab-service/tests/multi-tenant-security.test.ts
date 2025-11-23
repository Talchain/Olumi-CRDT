/**
 * Multi-tenant security tests
 *
 * Ensures org → team → board hierarchy is enforced
 * and role-based access control works correctly
 */

import { BoardDocument } from '../src/types/board';
import {
  UserContext,
  EnhancedUserContext,
  createEnhancedUserContext,
  UserRole,
} from '../src/types/auth';
import {
  checkBoardAccess,
  checkEditAccess,
  checkSnapshotAccess,
  checkAdminAccess,
  checkOwnerAccess,
  isEditOperation,
  AuthorizationErrors,
} from '../src/auth/authorization';

describe('Multi-tenant Security', () => {
  const createTestBoard = (
    orgId: string,
    teamId: string,
    ownerId: string
  ): BoardDocument => ({
    id: 'board-123',
    orgId,
    teamId,
    ownerId,
    version: 1,
    createdAt: '2025-01-01T00:00:00Z',
    updatedAt: '2025-01-01T00:00:00Z',
    title: 'Test Board',
    goals: [],
    options: [],
    outcomes: [],
    assumptions: [],
    evidence: [],
    edges: [],
    layout: {
      zoom: 1,
      panX: 0,
      panY: 0,
      viewportWidth: 1920,
      viewportHeight: 1080,
    },
    status: 'active',
  });

  const createUserContext = (
    userId: string,
    orgId: string,
    teamMemberships: Array<{ teamId: string; role: UserRole }>
  ): EnhancedUserContext => {
    const context: UserContext = {
      userId,
      orgId,
      email: `${userId}@example.com`,
      roles: [],
      teamMemberships,
    };
    return createEnhancedUserContext(context);
  };

  describe('Organizational Isolation', () => {
    it('should deny access to boards from different organizations', () => {
      const board = createTestBoard('org-A', 'team-1', 'user-owner');
      const userContext = createUserContext('user-1', 'org-B', [
        { teamId: 'team-1', role: UserRole.EDITOR },
      ]);

      const result = checkBoardAccess(board, userContext);

      expect(result.authorized).toBe(false);
      expect(result.reason).toBe('CROSS_ORG_ACCESS_DENIED');
    });

    it('should allow access to boards within same organization', () => {
      const board = createTestBoard('org-A', 'team-1', 'user-owner');
      const userContext = createUserContext('user-1', 'org-A', [
        { teamId: 'team-1', role: UserRole.VIEWER },
      ]);

      const result = checkBoardAccess(board, userContext);

      expect(result.authorized).toBe(true);
    });
  });

  describe('Team-level Isolation', () => {
    it('should deny access to boards from different teams within same org', () => {
      const board = createTestBoard('org-A', 'team-1', 'user-owner');
      const userContext = createUserContext('user-1', 'org-A', [
        { teamId: 'team-2', role: UserRole.EDITOR },
        { teamId: 'team-3', role: UserRole.ADMIN },
      ]);

      const result = checkBoardAccess(board, userContext);

      expect(result.authorized).toBe(false);
      expect(result.reason).toBe('CROSS_TEAM_ACCESS_DENIED');
    });

    it('should allow access to boards within user\'s team', () => {
      const board = createTestBoard('org-A', 'team-1', 'user-owner');
      const userContext = createUserContext('user-1', 'org-A', [
        { teamId: 'team-1', role: UserRole.EDITOR },
        { teamId: 'team-2', role: UserRole.VIEWER },
      ]);

      const result = checkBoardAccess(board, userContext);

      expect(result.authorized).toBe(true);
    });

    it('should deny access if user has no team role', () => {
      const board = createTestBoard('org-A', 'team-1', 'user-owner');
      const userContext = createUserContext('user-1', 'org-A', []);

      const result = checkBoardAccess(board, userContext);

      expect(result.authorized).toBe(false);
      expect(result.reason).toBe('CROSS_TEAM_ACCESS_DENIED');
    });
  });

  describe('Role-based Access Control', () => {
    describe('VIEWER role', () => {
      it('should allow read access', () => {
        const board = createTestBoard('org-A', 'team-1', 'user-owner');
        const userContext = createUserContext('user-1', 'org-A', [
          { teamId: 'team-1', role: UserRole.VIEWER },
        ]);

        const result = checkBoardAccess(board, userContext, UserRole.VIEWER);

        expect(result.authorized).toBe(true);
      });

      it('should deny edit access', () => {
        const board = createTestBoard('org-A', 'team-1', 'user-owner');
        const userContext = createUserContext('user-1', 'org-A', [
          { teamId: 'team-1', role: UserRole.VIEWER },
        ]);

        const result = checkEditAccess(board, userContext);

        expect(result.authorized).toBe(false);
        expect(result.reason).toBe('INSUFFICIENT_ROLE');
      });

      it('should deny snapshot creation', () => {
        const board = createTestBoard('org-A', 'team-1', 'user-owner');
        const userContext = createUserContext('user-1', 'org-A', [
          { teamId: 'team-1', role: UserRole.VIEWER },
        ]);

        const result = checkSnapshotAccess(board, userContext);

        expect(result.authorized).toBe(false);
        expect(result.reason).toBe('INSUFFICIENT_ROLE');
      });

      it('should deny admin access', () => {
        const board = createTestBoard('org-A', 'team-1', 'user-owner');
        const userContext = createUserContext('user-1', 'org-A', [
          { teamId: 'team-1', role: UserRole.VIEWER },
        ]);

        const result = checkAdminAccess(board, userContext);

        expect(result.authorized).toBe(false);
        expect(result.reason).toBe('INSUFFICIENT_ROLE');
      });
    });

    describe('EDITOR role', () => {
      it('should allow read access', () => {
        const board = createTestBoard('org-A', 'team-1', 'user-owner');
        const userContext = createUserContext('user-1', 'org-A', [
          { teamId: 'team-1', role: UserRole.EDITOR },
        ]);

        const result = checkBoardAccess(board, userContext, UserRole.VIEWER);

        expect(result.authorized).toBe(true);
      });

      it('should allow edit access', () => {
        const board = createTestBoard('org-A', 'team-1', 'user-owner');
        const userContext = createUserContext('user-1', 'org-A', [
          { teamId: 'team-1', role: UserRole.EDITOR },
        ]);

        const result = checkEditAccess(board, userContext);

        expect(result.authorized).toBe(true);
      });

      it('should allow snapshot creation', () => {
        const board = createTestBoard('org-A', 'team-1', 'user-owner');
        const userContext = createUserContext('user-1', 'org-A', [
          { teamId: 'team-1', role: UserRole.EDITOR },
        ]);

        const result = checkSnapshotAccess(board, userContext);

        expect(result.authorized).toBe(true);
      });

      it('should deny admin access', () => {
        const board = createTestBoard('org-A', 'team-1', 'user-owner');
        const userContext = createUserContext('user-1', 'org-A', [
          { teamId: 'team-1', role: UserRole.EDITOR },
        ]);

        const result = checkAdminAccess(board, userContext);

        expect(result.authorized).toBe(false);
        expect(result.reason).toBe('INSUFFICIENT_ROLE');
      });
    });

    describe('ADMIN role', () => {
      it('should allow all EDITOR permissions', () => {
        const board = createTestBoard('org-A', 'team-1', 'user-owner');
        const userContext = createUserContext('user-1', 'org-A', [
          { teamId: 'team-1', role: UserRole.ADMIN },
        ]);

        expect(checkBoardAccess(board, userContext, UserRole.VIEWER).authorized).toBe(true);
        expect(checkEditAccess(board, userContext).authorized).toBe(true);
        expect(checkSnapshotAccess(board, userContext).authorized).toBe(true);
        expect(checkAdminAccess(board, userContext).authorized).toBe(true);
      });

      it('should deny owner-specific operations (if not owner)', () => {
        const board = createTestBoard('org-A', 'team-1', 'user-owner');
        const userContext = createUserContext('user-admin', 'org-A', [
          { teamId: 'team-1', role: UserRole.ADMIN },
        ]);

        const result = checkOwnerAccess(board, userContext);

        expect(result.authorized).toBe(false);
      });
    });

    describe('OWNER role', () => {
      it('should allow all permissions', () => {
        const board = createTestBoard('org-A', 'team-1', 'user-owner');
        const userContext = createUserContext('user-1', 'org-A', [
          { teamId: 'team-1', role: UserRole.OWNER },
        ]);

        expect(checkBoardAccess(board, userContext, UserRole.VIEWER).authorized).toBe(true);
        expect(checkEditAccess(board, userContext).authorized).toBe(true);
        expect(checkSnapshotAccess(board, userContext).authorized).toBe(true);
        expect(checkAdminAccess(board, userContext).authorized).toBe(true);
        expect(checkOwnerAccess(board, userContext).authorized).toBe(true);
      });

      it('should allow owner access even without OWNER role if they are the board owner', () => {
        const board = createTestBoard('org-A', 'team-1', 'user-1');
        const userContext = createUserContext('user-1', 'org-A', [
          { teamId: 'team-1', role: UserRole.EDITOR },
        ]);

        const result = checkOwnerAccess(board, userContext);

        expect(result.authorized).toBe(true);
      });
    });
  });

  describe('Role Hierarchy', () => {
    it('should enforce correct role hierarchy', () => {
      const board = createTestBoard('org-A', 'team-1', 'user-owner');

      // Test each role can access lower requirements
      const owner = createUserContext('user-1', 'org-A', [
        { teamId: 'team-1', role: UserRole.OWNER },
      ]);
      const admin = createUserContext('user-2', 'org-A', [
        { teamId: 'team-1', role: UserRole.ADMIN },
      ]);
      const editor = createUserContext('user-3', 'org-A', [
        { teamId: 'team-1', role: UserRole.EDITOR },
      ]);
      const viewer = createUserContext('user-4', 'org-A', [
        { teamId: 'team-1', role: UserRole.VIEWER },
      ]);

      // All can view
      expect(checkBoardAccess(board, owner, UserRole.VIEWER).authorized).toBe(true);
      expect(checkBoardAccess(board, admin, UserRole.VIEWER).authorized).toBe(true);
      expect(checkBoardAccess(board, editor, UserRole.VIEWER).authorized).toBe(true);
      expect(checkBoardAccess(board, viewer, UserRole.VIEWER).authorized).toBe(true);

      // EDITOR and above can edit
      expect(checkBoardAccess(board, owner, UserRole.EDITOR).authorized).toBe(true);
      expect(checkBoardAccess(board, admin, UserRole.EDITOR).authorized).toBe(true);
      expect(checkBoardAccess(board, editor, UserRole.EDITOR).authorized).toBe(true);
      expect(checkBoardAccess(board, viewer, UserRole.EDITOR).authorized).toBe(false);

      // ADMIN and above can admin
      expect(checkBoardAccess(board, owner, UserRole.ADMIN).authorized).toBe(true);
      expect(checkBoardAccess(board, admin, UserRole.ADMIN).authorized).toBe(true);
      expect(checkBoardAccess(board, editor, UserRole.ADMIN).authorized).toBe(false);
      expect(checkBoardAccess(board, viewer, UserRole.ADMIN).authorized).toBe(false);

      // Only OWNER can owner
      expect(checkBoardAccess(board, owner, UserRole.OWNER).authorized).toBe(true);
      expect(checkBoardAccess(board, admin, UserRole.OWNER).authorized).toBe(false);
      expect(checkBoardAccess(board, editor, UserRole.OWNER).authorized).toBe(false);
      expect(checkBoardAccess(board, viewer, UserRole.OWNER).authorized).toBe(false);
    });
  });

  describe('WebSocket Message Type Detection', () => {
    it('should detect edit operations correctly', () => {
      // Yjs protocol message types
      expect(isEditOperation(0)).toBe(false); // sync step 1
      expect(isEditOperation(1)).toBe(false); // sync step 2
      expect(isEditOperation(2)).toBe(true);  // update (edit)
      expect(isEditOperation(3)).toBe(false); // awareness
    });
  });

  describe('Multiple Team Memberships', () => {
    it('should allow access if user is in correct team (among multiple)', () => {
      const board = createTestBoard('org-A', 'team-2', 'user-owner');
      const userContext = createUserContext('user-1', 'org-A', [
        { teamId: 'team-1', role: UserRole.ADMIN },
        { teamId: 'team-2', role: UserRole.VIEWER },
        { teamId: 'team-3', role: UserRole.EDITOR },
      ]);

      const result = checkBoardAccess(board, userContext, UserRole.VIEWER);

      expect(result.authorized).toBe(true);
    });

    it('should use correct team role for authorization', () => {
      const board = createTestBoard('org-A', 'team-2', 'user-owner');
      const userContext = createUserContext('user-1', 'org-A', [
        { teamId: 'team-1', role: UserRole.ADMIN },
        { teamId: 'team-2', role: UserRole.VIEWER }, // Board's team
        { teamId: 'team-3', role: UserRole.EDITOR },
      ]);

      // Can view (has VIEWER in team-2)
      expect(checkBoardAccess(board, userContext, UserRole.VIEWER).authorized).toBe(true);

      // Cannot edit (only VIEWER in team-2, not EDITOR)
      expect(checkEditAccess(board, userContext).authorized).toBe(false);
    });
  });

  describe('Error Messages', () => {
    it('should provide appropriate error messages', () => {
      expect(AuthorizationErrors.CROSS_ORG_ACCESS_DENIED).toBe(
        'Access denied: board belongs to a different organization'
      );
      expect(AuthorizationErrors.CROSS_TEAM_ACCESS_DENIED).toBe(
        'Access denied: you are not a member of this team'
      );
      expect(AuthorizationErrors.NO_TEAM_ROLE).toBe(
        'Access denied: no role found for this team'
      );
      expect(AuthorizationErrors.INSUFFICIENT_ROLE).toBe(
        'Access denied: insufficient permissions'
      );
      expect(AuthorizationErrors.VIEWER_CANNOT_EDIT).toBe(
        'Access denied: viewers cannot edit boards'
      );
    });
  });
});
