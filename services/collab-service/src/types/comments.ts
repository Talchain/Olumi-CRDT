/**
 * Comment Types
 *
 * Comments enable team discussion attached to board entities (goals, options, etc.).
 * Comments can reference evidence to support scientific reasoning.
 */

/**
 * Comment attached to a board entity
 */
export interface Comment {
  /** Unique comment ID */
  id: string;

  /** Board this comment belongs to */
  boardId: string;

  /** Entity this comment is attached to */
  attachedTo: {
    /** Type of entity (goal, option, outcome, assumption, edge) */
    type: 'goal' | 'option' | 'outcome' | 'assumption' | 'evidence' | 'edge';
    /** ID of the entity */
    entityId: string;
  };

  /** Author of the comment */
  authorId: string;
  authorName: string;

  /** Comment content (markdown supported) */
  content: string;

  /** References to evidence entities that support this comment */
  evidenceRefs: string[];

  /** Timestamps */
  createdAt: string;
  updatedAt: string;

  /** Resolution status */
  resolved: boolean;
  resolvedBy?: string;
  resolvedAt?: string;

  /** Optional reply-to for threading */
  replyTo?: string; // ID of parent comment

  /** Deleted flag for tombstone (CRDT soft delete) */
  deleted?: boolean;
}

/**
 * Comment thread grouping comments by entity
 */
export interface CommentThread {
  /** Thread ID (same as entityId for convenience) */
  id: string;

  /** Entity this thread is attached to */
  entityId: string;
  entityType: 'goal' | 'option' | 'outcome' | 'assumption' | 'evidence' | 'edge';

  /** Comments in this thread (ordered by createdAt) */
  comments: Comment[];

  /** Count of unresolved comments */
  unresolvedCount: number;
}

/**
 * Comment operation types for audit logging
 */
export type CommentOperationType =
  | 'comment_create'
  | 'comment_update'
  | 'comment_delete'
  | 'comment_resolve'
  | 'comment_unresolve';

/**
 * Comment statistics for a board
 */
export interface CommentStats {
  /** Total comments on board */
  totalComments: number;

  /** Unresolved comments */
  unresolvedComments: number;

  /** Comments by entity type */
  commentsByType: Record<string, number>;

  /** Recent activity (last 24 hours) */
  recentActivity: number;
}

/**
 * Comment notification event
 */
export interface CommentEvent {
  type: CommentOperationType;
  commentId: string;
  entityId: string;
  entityType: string;
  authorId: string;
  timestamp: string;
}
