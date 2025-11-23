/**
 * Database Client - Comments Extension
 *
 * Database operations for comment management.
 */

import { Pool } from 'pg';
import { Comment } from '../types/comments';

export class DatabaseClientCommentsExtension {
  constructor(private pool: Pool) {}

  /**
   * Create comments table if not exists
   */
  async initializeCommentsSchema(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS board_comments (
        id TEXT PRIMARY KEY,
        board_id TEXT NOT NULL,
        org_id TEXT NOT NULL,
        team_id TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        author_id TEXT NOT NULL,
        author_name TEXT NOT NULL,
        content TEXT NOT NULL,
        evidence_refs JSONB DEFAULT '[]'::jsonb,
        created_at TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL,
        resolved BOOLEAN DEFAULT FALSE,
        resolved_by TEXT,
        resolved_at TIMESTAMPTZ,
        reply_to TEXT,
        deleted BOOLEAN DEFAULT FALSE,

        -- Indexes
        CONSTRAINT fk_board FOREIGN KEY (board_id) REFERENCES boards(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_board_comments_board_id ON board_comments(board_id);
      CREATE INDEX IF NOT EXISTS idx_board_comments_entity_id ON board_comments(entity_id);
      CREATE INDEX IF NOT EXISTS idx_board_comments_author_id ON board_comments(author_id);
      CREATE INDEX IF NOT EXISTS idx_board_comments_resolved ON board_comments(resolved) WHERE NOT deleted;
      CREATE INDEX IF NOT EXISTS idx_board_comments_created_at ON board_comments(created_at);
    `);
  }

  /**
   * Create a new comment
   */
  async createComment(comment: Comment, orgId: string, teamId: string): Promise<void> {
    await this.pool.query(
      `
      INSERT INTO board_comments (
        id, board_id, org_id, team_id, entity_id, entity_type,
        author_id, author_name, content, evidence_refs,
        created_at, updated_at, resolved, resolved_by, resolved_at, reply_to, deleted
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
    `,
      [
        comment.id,
        comment.boardId,
        orgId,
        teamId,
        comment.attachedTo.entityId,
        comment.attachedTo.type,
        comment.authorId,
        comment.authorName,
        comment.content,
        JSON.stringify(comment.evidenceRefs || []),
        comment.createdAt,
        comment.updatedAt,
        comment.resolved,
        comment.resolvedBy || null,
        comment.resolvedAt || null,
        comment.replyTo || null,
        comment.deleted || false,
      ]
    );
  }

  /**
   * Get a comment by ID
   */
  async getComment(commentId: string): Promise<Comment | null> {
    const result = await this.pool.query(
      `
      SELECT * FROM board_comments WHERE id = $1 AND NOT deleted
    `,
      [commentId]
    );

    if (result.rows.length === 0) {
      return null;
    }

    return this.rowToComment(result.rows[0]);
  }

  /**
   * Update a comment
   */
  async updateComment(commentId: string, comment: Comment): Promise<void> {
    await this.pool.query(
      `
      UPDATE board_comments
      SET
        content = $1,
        evidence_refs = $2,
        updated_at = $3,
        resolved = $4,
        resolved_by = $5,
        resolved_at = $6
      WHERE id = $7
    `,
      [
        comment.content,
        JSON.stringify(comment.evidenceRefs || []),
        comment.updatedAt,
        comment.resolved,
        comment.resolvedBy || null,
        comment.resolvedAt || null,
        commentId,
      ]
    );
  }

  /**
   * Delete a comment (soft delete)
   */
  async deleteComment(commentId: string): Promise<void> {
    await this.pool.query(
      `
      UPDATE board_comments
      SET deleted = TRUE, updated_at = NOW()
      WHERE id = $1
    `,
      [commentId]
    );
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
    let query = `SELECT * FROM board_comments WHERE board_id = $1`;
    const params: any[] = [boardId];
    let paramIndex = 2;

    if (!options?.includeDeleted) {
      query += ` AND NOT deleted`;
    }

    if (options?.entityId) {
      query += ` AND entity_id = $${paramIndex}`;
      params.push(options.entityId);
      paramIndex++;
    }

    if (options?.resolved !== undefined) {
      query += ` AND resolved = $${paramIndex}`;
      params.push(options.resolved);
      paramIndex++;
    }

    query += ` ORDER BY created_at ASC`;

    const result = await this.pool.query(query, params);

    return result.rows.map((row) => this.rowToComment(row));
  }

  /**
   * Convert database row to Comment object
   */
  private rowToComment(row: any): Comment {
    return {
      id: row.id,
      boardId: row.board_id,
      attachedTo: {
        type: row.entity_type,
        entityId: row.entity_id,
      },
      authorId: row.author_id,
      authorName: row.author_name,
      content: row.content,
      evidenceRefs: JSON.parse(row.evidence_refs || '[]'),
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
      resolved: row.resolved,
      resolvedBy: row.resolved_by,
      resolvedAt: row.resolved_at?.toISOString(),
      replyTo: row.reply_to,
      deleted: row.deleted,
    };
  }
}
