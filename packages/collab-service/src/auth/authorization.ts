/**
 * Authorization helpers for multi-tenant security
 */

import { EnhancedUserContext, UserRole, hasAccess } from '../types/auth';
import { BoardDocument } from '../types/board';
import type { DatabaseClient } from '../database/client';

export interface AuthorizationResult {
  authorized: boolean;
  reason?: string;
}

/**
 * Enhanced authorization result with additional context
 */
export interface EnhancedAuthorizationResult {
  hasAccess: boolean;
  reason?: string;
  orgId?: string;
  teamId?: string;
  role?: UserRole;
}

/**
 * Check if user has access to a board based on org → team → board hierarchy (sync version)
 */
export function checkBoardAccess(
  board: BoardDocument,
  userContext: EnhancedUserContext,
  requiredRole: UserRole
): AuthorizationResult;

/**
 * SECURITY FIX: Check if user has access to a board based on org → team → board hierarchy (async version)
 * Validates orgId/teamId against JWT claims by fetching board from database
 */
export function checkBoardAccess(
  boardId: string,
  userContext: EnhancedUserContext,
  db: DatabaseClient,
  requiredRole: 'VIEWER' | 'EDITOR' | 'ADMIN' | 'OWNER'
): Promise<EnhancedAuthorizationResult>;

/**
 * Implementation of checkBoardAccess (supports both sync and async)
 */
export function checkBoardAccess(
  boardOrId: BoardDocument | string,
  userContext: EnhancedUserContext,
  requiredRoleOrDb: UserRole | DatabaseClient,
  requiredRoleAsync?: 'VIEWER' | 'EDITOR' | 'ADMIN' | 'OWNER'
): AuthorizationResult | Promise<EnhancedAuthorizationResult> {
  // Async version: checkBoardAccess(boardId, userContext, db, requiredRole)
  if (typeof boardOrId === 'string' && requiredRoleAsync !== undefined) {
    return checkBoardAccessAsyncImpl(
      boardOrId,
      userContext,
      requiredRoleOrDb as DatabaseClient,
      requiredRoleAsync
    );
  }

  // Sync version: checkBoardAccess(board, userContext, requiredRole)
  const board = boardOrId as BoardDocument;
  const requiredRole = requiredRoleOrDb as UserRole;

  // Check org match
  if (board.orgId !== userContext.orgId) {
    return {
      authorized: false,
      reason: 'CROSS_ORG_ACCESS_DENIED',
    };
  }

  // Check team membership
  if (!userContext.teamIds.includes(board.teamId)) {
    return {
      authorized: false,
      reason: 'CROSS_TEAM_ACCESS_DENIED',
    };
  }

  // Check role
  const userRole = userContext.getTeamRole(board.teamId);
  if (!userRole) {
    return {
      authorized: false,
      reason: 'NO_TEAM_ROLE',
    };
  }

  if (!hasAccess(userRole, requiredRole)) {
    return {
      authorized: false,
      reason: 'INSUFFICIENT_ROLE',
    };
  }

  return { authorized: true };
}

/**
 * Check if user can edit a board (requires EDITOR role or higher)
 */
export function checkEditAccess(
  board: BoardDocument,
  userContext: EnhancedUserContext
): AuthorizationResult {
  return checkBoardAccess(board, userContext, UserRole.EDITOR);
}

/**
 * Check if user can manage snapshots (requires EDITOR role or higher)
 */
export function checkSnapshotAccess(
  board: BoardDocument,
  userContext: EnhancedUserContext
): AuthorizationResult {
  return checkBoardAccess(board, userContext, UserRole.EDITOR);
}

/**
 * Check if user can perform admin actions (requires ADMIN role or higher)
 */
export function checkAdminAccess(
  board: BoardDocument,
  userContext: EnhancedUserContext
): AuthorizationResult {
  return checkBoardAccess(board, userContext, UserRole.ADMIN);
}

/**
 * Check if user is the owner or has owner role
 */
export function checkOwnerAccess(
  board: BoardDocument,
  userContext: EnhancedUserContext
): AuthorizationResult {
  // Allow if user is the board owner
  if (board.ownerId === userContext.userId) {
    return { authorized: true };
  }

  // Or has OWNER role in the team
  return checkBoardAccess(board, userContext, UserRole.OWNER);
}

/**
 * Determine if a Yjs message is an edit operation
 */
export function isEditOperation(messageType: number): boolean {
  // Yjs message types:
  // 0 = sync step 1
  // 1 = sync step 2
  // 2 = update (edit operation)
  // 3+ = awareness
  return messageType === 2;
}

/**
 * Error messages for authorization failures
 */
export const AuthorizationErrors = {
  CROSS_ORG_ACCESS_DENIED: 'Access denied: board belongs to a different organization',
  CROSS_TEAM_ACCESS_DENIED: 'Access denied: you are not a member of this team',
  NO_TEAM_ROLE: 'Access denied: no role found for this team',
  INSUFFICIENT_ROLE: 'Access denied: insufficient permissions',
  VIEWER_CANNOT_EDIT: 'Access denied: viewers cannot edit boards',
  JWT_ORG_MISMATCH: 'Access denied: organization ID does not match JWT claims',
  JWT_TEAM_MISMATCH: 'Access denied: team ID does not match JWT claims',
} as const;

/**
 * SECURITY FIX: Create enhanced user context from JWT payload
 * Fetches team memberships from database to build full user context
 *
 * NOTE: Also exported as 'createEnhancedUserContext' for compatibility with routes.ts
 *
 * @param jwtUser - User object from JWT token (contains userId, orgId, email, roles)
 * @param db - Database client to fetch team memberships
 * @returns Enhanced user context with team memberships
 */
export async function createEnhancedUserContextAsync(
  jwtUser: any,
  db: DatabaseClient
): Promise<EnhancedUserContext> {
  // SECURITY: Extract orgId from JWT token (trusted source)
  const userId = jwtUser.userId || jwtUser.sub || jwtUser.id;
  const orgId = jwtUser.orgId;
  const email = jwtUser.email;
  const roles = jwtUser.roles || [];

  // Fetch team memberships from database
  // This is the trusted source for team access and roles
  const teamMemberships = await db.getUserTeamMemberships(userId, orgId);

  const teamIds = teamMemberships.map((m) => m.teamId);

  return {
    userId,
    orgId,
    email,
    roles,
    teamMemberships,
    teamIds,
    getTeamRole(teamId: string): UserRole | null {
      const membership = teamMemberships.find((m) => m.teamId === teamId);
      return membership ? membership.role : null;
    },
  };
}

/**
 * SECURITY FIX: Implementation of async checkBoardAccess
 * Validates orgId/teamId against JWT claims by fetching board from database
 *
 * @param boardId - The board ID to check access for
 * @param userContext - User context from JWT (validated)
 * @param db - Database client to fetch board data
 * @param requiredRole - Minimum role required ('VIEWER' | 'EDITOR' | 'ADMIN' | 'OWNER')
 * @returns Enhanced authorization result with orgId, teamId, and role
 */
async function checkBoardAccessAsyncImpl(
  boardId: string,
  userContext: EnhancedUserContext,
  db: DatabaseClient,
  requiredRole: 'VIEWER' | 'EDITOR' | 'ADMIN' | 'OWNER'
): Promise<EnhancedAuthorizationResult> {
  try {
    // Fetch board from database (trusted source)
    const board = await db.getBoard(boardId);

    if (!board) {
      return {
        hasAccess: false,
        reason: 'Board not found',
      };
    }

    // SECURITY: Validate orgId against JWT claims
    // The board's orgId comes from the database (trusted)
    // The userContext.orgId should match the JWT orgId
    if (board.orgId !== userContext.orgId) {
      return {
        hasAccess: false,
        reason: 'CROSS_ORG_ACCESS_DENIED',
      };
    }

    // Check team membership
    if (!userContext.teamIds.includes(board.teamId)) {
      return {
        hasAccess: false,
        reason: 'CROSS_TEAM_ACCESS_DENIED',
      };
    }

    // Get user's role for this team
    const userRole = userContext.getTeamRole(board.teamId);
    if (!userRole) {
      return {
        hasAccess: false,
        reason: 'NO_TEAM_ROLE',
      };
    }

    // Convert string role to UserRole enum
    const requiredRoleEnum = UserRole[requiredRole as keyof typeof UserRole];

    // Check if user has sufficient role
    if (!hasAccess(userRole, requiredRoleEnum)) {
      return {
        hasAccess: false,
        reason: 'INSUFFICIENT_ROLE',
      };
    }

    // Access granted - return trusted orgId and teamId from database
    return {
      hasAccess: true,
      orgId: board.orgId,    // From database, not from client
      teamId: board.teamId,  // From database, not from client
      role: userRole,
    };
  } catch (error) {
    return {
      hasAccess: false,
      reason: 'Internal error checking board access',
    };
  }
}
