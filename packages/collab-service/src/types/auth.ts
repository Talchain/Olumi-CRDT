/**
 * Authentication and authorization types
 */

export interface JWTPayload {
  userId: string;
  orgId: string;
  email: string;
  roles: string[];
  exp: number;
  iat: number;
}

export interface TeamMembership {
  teamId: string;
  role: UserRole;
}

export interface UserContext {
  userId: string;
  orgId: string;
  email: string;
  roles: string[]; // Legacy: org-level roles
  teamMemberships: TeamMembership[]; // Team-specific roles
}

export interface EnhancedUserContext extends UserContext {
  teamIds: string[];
  getTeamRole(teamId: string): UserRole | null;
}

export interface AwarenessUser {
  id: string;
  name: string;
  email: string;
  color: string;
  avatarUrl?: string;
}

export interface AwarenessState {
  user: AwarenessUser;
  cursor?: {
    x: number;
    y: number;
    entityId?: string;
  };
  selection?: {
    entityIds: string[];
  };
  lastSeen: number;
}

export enum UserRole {
  VIEWER = 'viewer',   // Read-only, can see comments
  EDITOR = 'editor',   // Can edit, comment
  ADMIN = 'admin',     // Can manage permissions
  OWNER = 'owner',     // Full control
}

export function hasAccess(role: string, requiredRole: UserRole): boolean {
  const hierarchy = [UserRole.VIEWER, UserRole.EDITOR, UserRole.ADMIN, UserRole.OWNER];
  const userLevel = hierarchy.indexOf(role as UserRole);
  const requiredLevel = hierarchy.indexOf(requiredRole);
  return userLevel >= requiredLevel;
}

/**
 * Helper to create an enhanced user context with team role lookup
 */
export function createEnhancedUserContext(
  userContext: UserContext
): EnhancedUserContext {
  const teamIds = userContext.teamMemberships.map((m) => m.teamId);

  return {
    ...userContext,
    teamIds,
    getTeamRole(teamId: string): UserRole | null {
      const membership = userContext.teamMemberships.find(
        (m) => m.teamId === teamId
      );
      return membership ? membership.role : null;
    },
  };
}
