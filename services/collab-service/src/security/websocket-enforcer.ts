/**
 * WebSocket Security Enforcer
 * Filters Yjs updates to prevent unauthorized access to confidential elements
 */

import * as Y from 'yjs';
import { pino } from 'pino';
import { VisibilityManager } from '../visibility/visibility-manager';
import { SecurityAuditLogger } from '../audit/security-audit-logger';
import { UserRole } from '../types/auth';

const logger = pino();

export class WebSocketEnforcer {
  private permissionCache = new Map<string, CachedPermissions>();
  private readonly CACHE_TTL = 300000; // 5 minutes

  constructor(
    private visibilityManager: VisibilityManager,
    private auditLogger: SecurityAuditLogger
  ) {}

  /**
   * Filter Yjs update to remove unauthorized elements
   */
  async filterYjsUpdate(
    update: Uint8Array,
    userId: string,
    boardId: string,
    userRole: string
  ): Promise<Uint8Array> {
    const startTime = performance.now();

    try {
      // Decode the update to inspect what elements are being modified
      const doc = new Y.Doc();
      Y.applyUpdate(doc, update);

      // Extract element IDs from the update
      const elementIds = this.extractElementIds(doc);

      if (elementIds.length === 0) {
        // No elements to check, return original update
        return update;
      }

      // Check permissions for all elements (cached)
      const accessible = await this.checkBatchAccess(userId, elementIds, boardId, userRole);

      // Find unauthorized elements
      const unauthorized = elementIds.filter((id) => !accessible.has(id));

      if (unauthorized.length > 0) {
        // Log security event
        await this.auditLogger.logEvent({
          event_type: 'UNAUTHORIZED_ACCESS_BLOCKED',
          severity: 'warning',
          action: 'websocket_access',
          description: `Blocked unauthorized WebSocket access to ${unauthorized.length} elements`,
          outcome: 'denied',
          user_id: userId,
          board_id: boardId,
          metadata: {
            element_ids: unauthorized,
            method: 'websocket_update',
            blocked_count: unauthorized.length,
          },
        });

        logger.warn(
          {
            userId,
            boardId,
            unauthorized_elements: unauthorized,
            total_elements: elementIds.length,
          },
          'Blocked unauthorized WebSocket access'
        );

        // Filter out unauthorized elements from the update
        return this.removeUnauthorizedElements(doc, unauthorized);
      }

      const duration = performance.now() - startTime;
      logger.debug(
        { userId, boardId, elements: elementIds.length, duration_ms: duration },
        'WebSocket update filtered'
      );

      return update;
    } catch (err) {
      logger.error({ err, userId, boardId }, 'Error filtering WebSocket update');
      // On error, fail closed - return empty update
      return new Uint8Array(0);
    }
  }

  /**
   * Check batch element access with caching
   */
  private async checkBatchAccess(
    userId: string,
    elementIds: string[],
    boardId: string,
    userRole: string
  ): Promise<Set<string>> {
    const cacheKey = `${userId}:${boardId}`;
    const now = Date.now();

    // Check cache
    const cached = this.permissionCache.get(cacheKey);
    if (cached && now - cached.timestamp < this.CACHE_TTL) {
      logger.debug({ userId, boardId }, 'Permission cache hit');
      return cached.accessible;
    }

    // Query permissions for all elements
    const accessible = new Set<string>();

    await Promise.all(
      elementIds.map(async (elementId) => {
        try {
          const result = await this.visibilityManager.canViewElement(
            boardId,
            elementId,
            userId,
            userRole as UserRole
          );

          if (result.can_view) {
            accessible.add(elementId);
          }
        } catch (err) {
          logger.error({ err, elementId }, 'Error checking element access');
          // On error, deny access (fail closed)
        }
      })
    );

    // Cache result
    this.permissionCache.set(cacheKey, {
      accessible,
      timestamp: now,
    });

    // Clean up old cache entries
    this.cleanupCache();

    logger.debug(
      { userId, boardId, accessible: accessible.size, total: elementIds.length },
      'Permission check completed'
    );

    return accessible;
  }

  /**
   * Extract element IDs from Yjs document
   */
  private extractElementIds(doc: Y.Doc): string[] {
    const elementIds: string[] = [];

    try {
      // Get the shared data map
      const data = doc.getMap('data');

      // Extract IDs from nodes, edges, goals, etc.
      const collections = ['nodes', 'edges', 'goals', 'actions', 'metrics'];

      collections.forEach((collection) => {
        const map = data.get(collection);
        if (map instanceof Y.Map) {
          map.forEach((_value, key) => {
            elementIds.push(key);
          });
        }
      });
    } catch (err) {
      logger.error({ err }, 'Error extracting element IDs from Yjs doc');
    }

    return elementIds;
  }

  /**
   * Remove unauthorized elements from Yjs document
   */
  private removeUnauthorizedElements(doc: Y.Doc, unauthorizedIds: string[]): Uint8Array {
    try {
      const data = doc.getMap('data');
      const collections = ['nodes', 'edges', 'goals', 'actions', 'metrics'];

      collections.forEach((collection) => {
        const map = data.get(collection);
        if (map instanceof Y.Map) {
          unauthorizedIds.forEach((id) => {
            if (map.has(id)) {
              map.delete(id);
            }
          });
        }
      });

      return Y.encodeStateAsUpdate(doc);
    } catch (err) {
      logger.error({ err }, 'Error removing unauthorized elements');
      // Return empty update on error
      return new Uint8Array(0);
    }
  }

  /**
   * Clean up expired cache entries
   */
  private cleanupCache(): void {
    const now = Date.now();
    const keysToDelete: string[] = [];

    this.permissionCache.forEach((value, key) => {
      if (now - value.timestamp > this.CACHE_TTL) {
        keysToDelete.push(key);
      }
    });

    keysToDelete.forEach((key) => this.permissionCache.delete(key));

    if (keysToDelete.length > 0) {
      logger.debug({ cleaned: keysToDelete.length }, 'Cleaned up permission cache');
    }
  }

  /**
   * Clear cache for specific user/board
   */
  clearCache(userId?: string, boardId?: string): void {
    if (userId && boardId) {
      this.permissionCache.delete(`${userId}:${boardId}`);
    } else {
      this.permissionCache.clear();
    }
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): { size: number; ttl_ms: number } {
    return {
      size: this.permissionCache.size,
      ttl_ms: this.CACHE_TTL,
    };
  }
}

interface CachedPermissions {
  accessible: Set<string>;
  timestamp: number;
}
