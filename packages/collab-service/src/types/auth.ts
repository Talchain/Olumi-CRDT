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

export interface UserContext {
  userId: string;
  orgId: string;
  email: string;
  roles: string[];
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
  OWNER = 'owner',
  ADMIN = 'admin',
  MEMBER = 'member',
  VIEWER = 'viewer',
}

export function hasAccess(role: string, requiredRole: UserRole): boolean {
  const hierarchy = [UserRole.VIEWER, UserRole.MEMBER, UserRole.ADMIN, UserRole.OWNER];
  const userLevel = hierarchy.indexOf(role as UserRole);
  const requiredLevel = hierarchy.indexOf(requiredRole);
  return userLevel >= requiredLevel;
}
