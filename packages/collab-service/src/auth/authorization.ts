/**
 * Authorization helpers for multi-tenant security
 */

import { EnhancedUserContext, UserRole, hasAccess } from '../types/auth';
import { BoardDocument } from '../types/board';

export interface AuthorizationResult {
  authorized: boolean;
  reason?: string;
}

/**
 * Check if user has access to a board based on org → team → board hierarchy
 */
export function checkBoardAccess(
  board: BoardDocument,
  userContext: EnhancedUserContext,
  requiredRole: UserRole = UserRole.VIEWER
): AuthorizationResult {
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
} as const;
