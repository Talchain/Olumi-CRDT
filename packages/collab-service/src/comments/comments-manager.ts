/**
 * Comments Manager
 *
 * Manages board comments with evidence integration.
 * Comments are stored in the database (not Yjs) for:
 * - Better queryability
 * - Permission-aware access
 * - Simpler implementation
 * - Clear lifecycle management
 *
 * Real-time updates are broadcast via WebSocket events (not CRDT sync).
 */

import { pino } from 'pino';
import { DatabaseClient } from '../database/client';
import { Comment, CommentThread, CommentOperationType, CommentStats } from '../types/comments';

const logger = pino({ name: 'comments-manager' });

export class CommentsManager {
  constructor(private db: DatabaseClient) {}

  /**
   * Create a new comment
   */
  async createComment(
    boardId: string,
    orgId: string,
    teamId: string,
    userId: string,
    userName: string,
    comment: {
      entityId: string;
      entityType: 'goal' | 'option' | 'outcome' | 'assumption' | 'evidence' | 'edge';
      content: string;
      evidenceRefs?: string[];
      replyTo?: string;
    }
  ): Promise<Comment> {
    const commentId = `comment_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    const now = new Date().toISOString();

    const newComment: Comment = {
      id: commentId,
      boardId,
      attachedTo: {
        type: comment.entityType,
        entityId: comment.entityId,
      },
      authorId: userId,
      authorName: userName,
      content: comment.content,
      evidenceRefs: comment.evidenceRefs || [],
      createdAt: now,
      updatedAt: now,
      resolved: false,
      replyTo: comment.replyTo,
    };

    await this.db.createComment(newComment, orgId, teamId);

    logger.info(
      {
        commentId,
        boardId,
        entityId: comment.entityId,
        userId,
      },
      'Comment created'
    );

    return newComment;
  }

  /**
   * Update a comment
   */
  async updateComment(
    commentId: string,
    userId: string,
    updates: {
      content?: string;
      evidenceRefs?: string[];
    }
  ): Promise<Comment | null> {
    const existingComment = await this.db.getComment(commentId);

    if (!existingComment) {
      logger.warn({ commentId }, 'Comment not found for update');
      return null;
    }

    // Only author can update
    if (existingComment.authorId !== userId) {
      throw new Error('Only comment author can update');
    }

    const updatedComment: Comment = {
      ...existingComment,
      content: updates.content !== undefined ? updates.content : existingComment.content,
      evidenceRefs:
        updates.evidenceRefs !== undefined ? updates.evidenceRefs : existingComment.evidenceRefs,
      updatedAt: new Date().toISOString(),
    };

    await this.db.updateComment(commentId, updatedComment);

    logger.info({ commentId, userId }, 'Comment updated');

    return updatedComment;
  }

  /**
   * Delete a comment (soft delete)
   */
  async deleteComment(commentId: string, userId: string): Promise<boolean> {
    const existingComment = await this.db.getComment(commentId);

    if (!existingComment) {
      logger.warn({ commentId }, 'Comment not found for deletion');
      return false;
    }

    // Only author can delete
    if (existingComment.authorId !== userId) {
      throw new Error('Only comment author can delete');
    }

    await this.db.deleteComment(commentId);

    logger.info({ commentId, userId }, 'Comment deleted');

    return true;
  }

  /**
   * Resolve a comment
   */
  async resolveComment(commentId: string, userId: string): Promise<Comment | null> {
    const existingComment = await this.db.getComment(commentId);

    if (!existingComment) {
      logger.warn({ commentId }, 'Comment not found for resolution');
      return null;
    }

    const resolvedComment: Comment = {
      ...existingComment,
      resolved: true,
      resolvedBy: userId,
      resolvedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await this.db.updateComment(commentId, resolvedComment);

    logger.info({ commentId, userId }, 'Comment resolved');

    return resolvedComment;
  }

  /**
   * Unresolve a comment
   */
  async unresolveComment(commentId: string, userId: string): Promise<Comment | null> {
    const existingComment = await this.db.getComment(commentId);

    if (!existingComment) {
      logger.warn({ commentId }, 'Comment not found for unresolution');
      return null;
    }

    const unresolvedComment: Comment = {
      ...existingComment,
      resolved: false,
      resolvedBy: undefined,
      resolvedAt: undefined,
      updatedAt: new Date().toISOString(),
    };

    await this.db.updateComment(commentId, unresolvedComment);

    logger.info({ commentId, userId }, 'Comment unresolved');

    return unresolvedComment;
  }

  /**
   * Get all comments for a board
   */
  async getComments(
    boardId: string,
    options?: {
      entityId?: string;
      resolved?: boolean;
      includeDeleted?: boolean;
    }
  ): Promise<Comment[]> {
    return this.db.getComments(boardId, options);
  }

  /**
   * Get comment threads grouped by entity
   */
  async getCommentThreads(
    boardId: string,
    options?: {
      entityId?: string;
      resolved?: boolean;
    }
  ): Promise<CommentThread[]> {
    const comments = await this.getComments(boardId, {
      entityId: options?.entityId,
      resolved: options?.resolved,
      includeDeleted: false,
    });

    // Group comments by entity
    const threadMap = new Map<string, CommentThread>();

    for (const comment of comments) {
      const entityId = comment.attachedTo.entityId;

      if (!threadMap.has(entityId)) {
        threadMap.set(entityId, {
          id: entityId,
          entityId,
          entityType: comment.attachedTo.type,
          comments: [],
          unresolvedCount: 0,
        });
      }

      const thread = threadMap.get(entityId)!;
      thread.comments.push(comment);

      if (!comment.resolved) {
        thread.unresolvedCount++;
      }
    }

    // Sort comments within each thread by createdAt
    for (const thread of threadMap.values()) {
      thread.comments.sort((a, b) => {
        return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      });
    }

    return Array.from(threadMap.values());
  }

  /**
   * Get comment statistics for a board
   */
  async getCommentStats(boardId: string): Promise<CommentStats> {
    const comments = await this.getComments(boardId, { includeDeleted: false });

    const stats: CommentStats = {
      totalComments: comments.length,
      unresolvedComments: comments.filter((c) => !c.resolved).length,
      commentsByType: {},
      recentActivity: 0,
    };

    // Count by entity type
    for (const comment of comments) {
      const type = comment.attachedTo.type;
      stats.commentsByType[type] = (stats.commentsByType[type] || 0) + 1;
    }

    // Recent activity (last 24 hours)
    const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
    stats.recentActivity = comments.filter((c) => {
      return new Date(c.createdAt).getTime() > oneDayAgo;
    }).length;

    return stats;
  }

  /**
   * Get a single comment by ID
   */
  async getComment(commentId: string): Promise<Comment | null> {
    return this.db.getComment(commentId);
  }

  /**
   * Get comments that reference a specific evidence entity
   */
  async getCommentsByEvidence(boardId: string, evidenceId: string): Promise<Comment[]> {
    const allComments = await this.getComments(boardId, { includeDeleted: false });

    return allComments.filter((comment) => comment.evidenceRefs.includes(evidenceId));
  }
}
