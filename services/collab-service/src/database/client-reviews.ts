/**
 * Database operations for review requests
 * G.1: Review Request System
 */

import { Pool } from 'pg';
import { pino } from 'pino';
import { v4 as uuidv4 } from 'uuid';

const logger = pino();

export type ReviewStatus = 'pending' | 'in_progress' | 'complete' | 'expired';
export type ReviewerStatus = 'pending' | 'in_progress' | 'complete' | 'declined';
export type ReviewDecision = 'approve' | 'request_changes' | 'comment_only';
export type CompletionRule = 'all' | 'majority' | 'threshold';

export interface ReviewRequest {
  review_id: string;
  board_id: string;
  snapshot_id: string;
  requested_by_user_id: string;
  requested_at: string;

  completion_rule: CompletionRule;
  threshold_count?: number;
  due_date?: string;
  context_message?: string;

  status: ReviewStatus;
  completed_at?: string;

  created_at: string;
  updated_at: string;
}

export interface ReviewerAssignment {
  assignment_id: string;
  review_id: string;
  user_id: string;

  status: ReviewerStatus;
  decision?: ReviewDecision;

  started_at?: string;
  completed_at?: string;

  created_at: string;
  updated_at: string;
}

export interface ReviewComment {
  comment_id: string;
  review_id: string;
  assignment_id: string;
  user_id: string;

  comment_text: string;
  element_id?: string; // Optional: comment on specific element

  created_at: string;
  updated_at: string;
}

export interface CreateReviewRequestParams {
  board_id: string;
  snapshot_id: string;
  requested_by_user_id: string;
  reviewer_user_ids: string[];
  completion_rule: CompletionRule;
  threshold_count?: number;
  due_date?: string;
  context_message?: string;
}

export interface UpdateReviewerParams {
  assignment_id: string;
  status: ReviewerStatus;
  decision?: ReviewDecision;
}

export interface AddCommentParams {
  review_id: string;
  assignment_id: string;
  user_id: string;
  comment_text: string;
  element_id?: string;
}

export class ReviewDatabase {
  constructor(private pool: Pool) {}

  /**
   * Initialize review system tables
   */
  async initialize(): Promise<void> {
    await this.pool.query(`
      -- Review requests table
      CREATE TABLE IF NOT EXISTS review_requests (
        review_id TEXT PRIMARY KEY,
        board_id TEXT NOT NULL,
        snapshot_id TEXT NOT NULL,
        requested_by_user_id TEXT NOT NULL,
        requested_at TIMESTAMPTZ NOT NULL,

        completion_rule TEXT NOT NULL CHECK (completion_rule IN ('all', 'majority', 'threshold')),
        threshold_count INTEGER,
        due_date TIMESTAMPTZ,
        context_message TEXT,

        status TEXT NOT NULL CHECK (status IN ('pending', 'in_progress', 'complete', 'expired')),
        completed_at TIMESTAMPTZ,

        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

        CONSTRAINT fk_board FOREIGN KEY (board_id) REFERENCES boards(id) ON DELETE CASCADE,
        CONSTRAINT fk_snapshot FOREIGN KEY (snapshot_id) REFERENCES snapshot_records(snapshot_id) ON DELETE CASCADE,
        CONSTRAINT threshold_valid CHECK (
          (completion_rule = 'threshold' AND threshold_count IS NOT NULL) OR
          (completion_rule != 'threshold')
        )
      );

      -- Reviewer assignments table
      CREATE TABLE IF NOT EXISTS reviewer_assignments (
        assignment_id TEXT PRIMARY KEY,
        review_id TEXT NOT NULL,
        user_id TEXT NOT NULL,

        status TEXT NOT NULL CHECK (status IN ('pending', 'in_progress', 'complete', 'declined')),
        decision TEXT CHECK (decision IN ('approve', 'request_changes', 'comment_only')),

        started_at TIMESTAMPTZ,
        completed_at TIMESTAMPTZ,

        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

        CONSTRAINT fk_review FOREIGN KEY (review_id) REFERENCES review_requests(review_id) ON DELETE CASCADE,
        CONSTRAINT unique_reviewer UNIQUE (review_id, user_id)
      );

      -- Review comments table
      CREATE TABLE IF NOT EXISTS review_comments (
        comment_id TEXT PRIMARY KEY,
        review_id TEXT NOT NULL,
        assignment_id TEXT NOT NULL,
        user_id TEXT NOT NULL,

        comment_text TEXT NOT NULL,
        element_id TEXT, -- Optional: comment on specific element

        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

        CONSTRAINT fk_review FOREIGN KEY (review_id) REFERENCES review_requests(review_id) ON DELETE CASCADE,
        CONSTRAINT fk_assignment FOREIGN KEY (assignment_id) REFERENCES reviewer_assignments(assignment_id) ON DELETE CASCADE
      );

      -- Indexes for performance
      CREATE INDEX IF NOT EXISTS idx_reviews_board ON review_requests(board_id);
      CREATE INDEX IF NOT EXISTS idx_reviews_snapshot ON review_requests(snapshot_id);
      CREATE INDEX IF NOT EXISTS idx_reviews_requester ON review_requests(requested_by_user_id);
      CREATE INDEX IF NOT EXISTS idx_reviews_status ON review_requests(status);
      CREATE INDEX IF NOT EXISTS idx_reviews_due_date ON review_requests(due_date) WHERE status IN ('pending', 'in_progress');

      CREATE INDEX IF NOT EXISTS idx_assignments_review ON reviewer_assignments(review_id);
      CREATE INDEX IF NOT EXISTS idx_assignments_user ON reviewer_assignments(user_id);
      CREATE INDEX IF NOT EXISTS idx_assignments_status ON reviewer_assignments(status);

      CREATE INDEX IF NOT EXISTS idx_comments_review ON review_comments(review_id);
      CREATE INDEX IF NOT EXISTS idx_comments_assignment ON review_comments(assignment_id);
      CREATE INDEX IF NOT EXISTS idx_comments_element ON review_comments(element_id) WHERE element_id IS NOT NULL;
    `);

    logger.info('Review system tables initialized');
  }

  /**
   * Create a new review request with reviewer assignments
   */
  async createReviewRequest(params: CreateReviewRequestParams): Promise<ReviewRequest> {
    const client = await this.pool.connect();

    try {
      await client.query('BEGIN');

      const review_id = uuidv4();
      const requested_at = new Date().toISOString();

      // Validate completion rule
      if (params.completion_rule === 'threshold' && !params.threshold_count) {
        throw new Error('threshold_count required for threshold completion rule');
      }

      if (params.completion_rule === 'threshold' && params.threshold_count! > params.reviewer_user_ids.length) {
        throw new Error('threshold_count cannot exceed number of reviewers');
      }

      // Create review request
      const reviewResult = await client.query<ReviewRequest>(
        `INSERT INTO review_requests (
          review_id, board_id, snapshot_id, requested_by_user_id,
          requested_at, completion_rule, threshold_count, due_date,
          context_message, status, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), NOW())
        RETURNING *`,
        [
          review_id,
          params.board_id,
          params.snapshot_id,
          params.requested_by_user_id,
          requested_at,
          params.completion_rule,
          params.threshold_count || null,
          params.due_date || null,
          params.context_message || null,
          'pending' as ReviewStatus,
        ]
      );

      // Create reviewer assignments
      for (const reviewer_id of params.reviewer_user_ids) {
        await client.query(
          `INSERT INTO reviewer_assignments (
            assignment_id, review_id, user_id, status, created_at, updated_at
          ) VALUES ($1, $2, $3, $4, NOW(), NOW())`,
          [uuidv4(), review_id, reviewer_id, 'pending' as ReviewerStatus]
        );
      }

      await client.query('COMMIT');

      return this.mapReviewRequest(reviewResult.rows[0]);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Get review request by ID
   */
  async getReviewRequest(review_id: string): Promise<ReviewRequest | null> {
    const result = await this.pool.query<ReviewRequest>(
      'SELECT * FROM review_requests WHERE review_id = $1',
      [review_id]
    );

    return result.rows.length > 0 ? this.mapReviewRequest(result.rows[0]) : null;
  }

  /**
   * Get all reviewer assignments for a review
   */
  async getReviewerAssignments(review_id: string): Promise<ReviewerAssignment[]> {
    const result = await this.pool.query<ReviewerAssignment>(
      'SELECT * FROM reviewer_assignments WHERE review_id = $1 ORDER BY created_at',
      [review_id]
    );

    return result.rows.map(this.mapReviewerAssignment);
  }

  /**
   * Update reviewer assignment status and decision
   */
  async updateReviewerAssignment(params: UpdateReviewerParams): Promise<ReviewerAssignment> {
    const now = new Date().toISOString();
    const updates: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    updates.push(`status = $${paramIndex++}`);
    values.push(params.status);

    if (params.decision) {
      updates.push(`decision = $${paramIndex++}`);
      values.push(params.decision);
    }

    if (params.status === 'in_progress') {
      updates.push(`started_at = $${paramIndex++}`);
      values.push(now);
    }

    if (params.status === 'complete' || params.status === 'declined') {
      updates.push(`completed_at = $${paramIndex++}`);
      values.push(now);
    }

    updates.push(`updated_at = $${paramIndex++}`);
    values.push(now);

    values.push(params.assignment_id); // Last parameter for WHERE clause

    const result = await this.pool.query<ReviewerAssignment>(
      `UPDATE reviewer_assignments
       SET ${updates.join(', ')}
       WHERE assignment_id = $${paramIndex}
       RETURNING *`,
      values
    );

    if (result.rows.length === 0) {
      throw new Error(`Assignment ${params.assignment_id} not found`);
    }

    return this.mapReviewerAssignment(result.rows[0]);
  }

  /**
   * Add a comment to a review
   */
  async addComment(params: AddCommentParams): Promise<ReviewComment> {
    const comment_id = uuidv4();

    const result = await this.pool.query<ReviewComment>(
      `INSERT INTO review_comments (
        comment_id, review_id, assignment_id, user_id,
        comment_text, element_id, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
      RETURNING *`,
      [
        comment_id,
        params.review_id,
        params.assignment_id,
        params.user_id,
        params.comment_text,
        params.element_id || null,
      ]
    );

    return this.mapReviewComment(result.rows[0]);
  }

  /**
   * Get all comments for a review
   */
  async getReviewComments(review_id: string): Promise<ReviewComment[]> {
    const result = await this.pool.query<ReviewComment>(
      'SELECT * FROM review_comments WHERE review_id = $1 ORDER BY created_at',
      [review_id]
    );

    return result.rows.map(this.mapReviewComment);
  }

  /**
   * Check if review is complete based on completion rule
   */
  async checkReviewCompletion(review_id: string): Promise<boolean> {
    const review = await this.getReviewRequest(review_id);
    if (!review) return false;

    const assignments = await this.getReviewerAssignments(review_id);
    const completedAssignments = assignments.filter((a) => a.status === 'complete');
    const approvedAssignments = completedAssignments.filter((a) => a.decision === 'approve');

    switch (review.completion_rule) {
      case 'all':
        // All reviewers must complete
        return completedAssignments.length === assignments.length;

      case 'majority':
        // More than half must approve
        return approvedAssignments.length > assignments.length / 2;

      case 'threshold':
        // Specific number must approve
        return approvedAssignments.length >= (review.threshold_count || 0);

      default:
        return false;
    }
  }

  /**
   * Mark review as complete
   */
  async markReviewComplete(review_id: string): Promise<ReviewRequest> {
    const result = await this.pool.query<ReviewRequest>(
      `UPDATE review_requests
       SET status = 'complete', completed_at = NOW(), updated_at = NOW()
       WHERE review_id = $1
       RETURNING *`,
      [review_id]
    );

    if (result.rows.length === 0) {
      throw new Error(`Review ${review_id} not found`);
    }

    return this.mapReviewRequest(result.rows[0]);
  }

  /**
   * List reviews for a board
   */
  async listBoardReviews(board_id: string, limit: number = 50): Promise<ReviewRequest[]> {
    const result = await this.pool.query<ReviewRequest>(
      `SELECT * FROM review_requests
       WHERE board_id = $1
       ORDER BY requested_at DESC
       LIMIT $2`,
      [board_id, limit]
    );

    return result.rows.map(this.mapReviewRequest);
  }

  /**
   * List reviews assigned to a user
   */
  async listUserReviews(user_id: string, limit: number = 50): Promise<ReviewRequest[]> {
    const result = await this.pool.query<ReviewRequest>(
      `SELECT DISTINCT r.*
       FROM review_requests r
       JOIN reviewer_assignments a ON r.review_id = a.review_id
       WHERE a.user_id = $1
       ORDER BY r.requested_at DESC
       LIMIT $2`,
      [user_id, limit]
    );

    return result.rows.map(this.mapReviewRequest);
  }

  /**
   * Find expired reviews
   */
  async findExpiredReviews(): Promise<ReviewRequest[]> {
    const result = await this.pool.query<ReviewRequest>(
      `SELECT * FROM review_requests
       WHERE status IN ('pending', 'in_progress')
       AND due_date IS NOT NULL
       AND due_date < NOW()`
    );

    return result.rows.map(this.mapReviewRequest);
  }

  /**
   * Mark review as expired
   */
  async markReviewExpired(review_id: string): Promise<ReviewRequest> {
    const result = await this.pool.query<ReviewRequest>(
      `UPDATE review_requests
       SET status = 'expired', updated_at = NOW()
       WHERE review_id = $1
       RETURNING *`,
      [review_id]
    );

    if (result.rows.length === 0) {
      throw new Error(`Review ${review_id} not found`);
    }

    return this.mapReviewRequest(result.rows[0]);
  }

  // ========================================================================
  // PRIVATE MAPPING METHODS
  // ========================================================================

  private mapReviewRequest(row: any): ReviewRequest {
    return {
      review_id: row.review_id,
      board_id: row.board_id,
      snapshot_id: row.snapshot_id,
      requested_by_user_id: row.requested_by_user_id,
      requested_at: row.requested_at,
      completion_rule: row.completion_rule,
      threshold_count: row.threshold_count,
      due_date: row.due_date,
      context_message: row.context_message,
      status: row.status,
      completed_at: row.completed_at,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }

  private mapReviewerAssignment(row: any): ReviewerAssignment {
    return {
      assignment_id: row.assignment_id,
      review_id: row.review_id,
      user_id: row.user_id,
      status: row.status,
      decision: row.decision,
      started_at: row.started_at,
      completed_at: row.completed_at,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }

  private mapReviewComment(row: any): ReviewComment {
    return {
      comment_id: row.comment_id,
      review_id: row.review_id,
      assignment_id: row.assignment_id,
      user_id: row.user_id,
      comment_text: row.comment_text,
      element_id: row.element_id,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }
}
