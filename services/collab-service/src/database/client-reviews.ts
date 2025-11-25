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

export interface ReviewOutcome {
  outcome_id: string;
  review_id: string;
  overall_result: 'approved' | 'changes_needed' | 'mixed' | 'no_consensus';
  approvals_count: number;
  changes_requested_count: number;
  comment_only_count: number;
  declined_count: number;
  total_reviewers: number;
  key_concerns: string[]; // Element IDs with change requests
  recommendation: string;
  created_at: string;
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

      -- Review outcomes table (G.3)
      CREATE TABLE IF NOT EXISTS review_outcomes (
        outcome_id TEXT PRIMARY KEY,
        review_id TEXT NOT NULL UNIQUE,

        overall_result TEXT NOT NULL CHECK (overall_result IN ('approved', 'changes_needed', 'mixed', 'no_consensus')),
        approvals_count INTEGER NOT NULL DEFAULT 0,
        changes_requested_count INTEGER NOT NULL DEFAULT 0,
        comment_only_count INTEGER NOT NULL DEFAULT 0,
        declined_count INTEGER NOT NULL DEFAULT 0,
        total_reviewers INTEGER NOT NULL,

        key_concerns JSONB DEFAULT '[]'::jsonb, -- Array of element IDs with concerns
        recommendation TEXT NOT NULL,

        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

        CONSTRAINT fk_review FOREIGN KEY (review_id) REFERENCES review_requests(review_id) ON DELETE CASCADE
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

      CREATE INDEX IF NOT EXISTS idx_outcomes_review ON review_outcomes(review_id);
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
   * Generate and store review outcome (G.3)
   */
  async generateReviewOutcome(review_id: string): Promise<ReviewOutcome> {
    const review = await this.getReviewRequest(review_id);
    if (!review) {
      throw new Error(`Review ${review_id} not found`);
    }

    const assignments = await this.getReviewerAssignments(review_id);
    const comments = await this.getReviewComments(review_id);

    // Count decisions
    const approvals_count = assignments.filter((a) => a.decision === 'approve').length;
    const changes_requested_count = assignments.filter((a) => a.decision === 'request_changes').length;
    const comment_only_count = assignments.filter((a) => a.decision === 'comment_only').length;
    const declined_count = assignments.filter((a) => a.status === 'declined').length;
    const total_reviewers = assignments.length;

    // Find elements with change request comments
    const key_concerns: string[] = Array.from(
      new Set(
        comments
          .filter((c) => {
            const assignment = assignments.find((a) => a.assignment_id === c.assignment_id);
            return assignment?.decision === 'request_changes' && c.element_id;
          })
          .map((c) => c.element_id!)
      )
    );

    // Determine overall result
    let overall_result: 'approved' | 'changes_needed' | 'mixed' | 'no_consensus';
    if (changes_requested_count === 0 && approvals_count > 0) {
      overall_result = 'approved';
    } else if (changes_requested_count > approvals_count) {
      overall_result = 'changes_needed';
    } else if (approvals_count > 0 && changes_requested_count > 0) {
      overall_result = 'mixed';
    } else {
      overall_result = 'no_consensus';
    }

    // Generate recommendation text
    let recommendation: string;
    switch (overall_result) {
      case 'approved':
        recommendation = `Review complete: ${approvals_count} of ${total_reviewers} reviewers approved. Ready to proceed.`;
        break;
      case 'changes_needed':
        recommendation = `Review complete: ${changes_requested_count} of ${total_reviewers} reviewers requested changes. Address concerns before proceeding.`;
        break;
      case 'mixed':
        recommendation = `Review complete: Mixed results (${approvals_count} approved, ${changes_requested_count} requested changes). Review feedback and decide next steps.`;
        break;
      case 'no_consensus':
        recommendation = `Review complete: No clear consensus reached. Consider additional review or discussion.`;
        break;
    }

    if (key_concerns.length > 0) {
      recommendation += ` Key concerns raised for ${key_concerns.length} element(s).`;
    }

    // Store outcome
    const outcome_id = uuidv4();
    const result = await this.pool.query<ReviewOutcome>(
      `INSERT INTO review_outcomes (
        outcome_id, review_id, overall_result,
        approvals_count, changes_requested_count, comment_only_count,
        declined_count, total_reviewers, key_concerns, recommendation,
        created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
      RETURNING *`,
      [
        outcome_id,
        review_id,
        overall_result,
        approvals_count,
        changes_requested_count,
        comment_only_count,
        declined_count,
        total_reviewers,
        JSON.stringify(key_concerns),
        recommendation,
      ]
    );

    return this.mapReviewOutcome(result.rows[0]);
  }

  /**
   * Get review outcome
   */
  async getReviewOutcome(review_id: string): Promise<ReviewOutcome | null> {
    const result = await this.pool.query<ReviewOutcome>(
      'SELECT * FROM review_outcomes WHERE review_id = $1',
      [review_id]
    );

    return result.rows.length > 0 ? this.mapReviewOutcome(result.rows[0]) : null;
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

  /**
   * Get enriched review inbox for a user (G.2)
   * Returns reviews with board names, requester info, and progress
   */
  async getUserReviewInbox(user_id: string): Promise<{
    reviews: Array<{
      review_id: string;
      board_id: string;
      board_name: string;
      requester: { user_id: string; name: string };
      my_status: 'pending' | 'in_progress' | 'complete' | 'declined';
      due_date: string | null;
      context_message: string | null;
      created_at: string;
      progress: { completed: number; total: number };
    }>;
    total_pending: number;
    total_in_progress: number;
  }> {
    // Get reviews with enriched data
    const result = await this.pool.query(
      `SELECT
        r.review_id,
        r.board_id,
        r.due_date,
        r.context_message,
        r.requested_at as created_at,
        a.status as my_status,
        b.name as board_name,
        u.user_id as requester_user_id,
        u.name as requester_name,
        (SELECT COUNT(*) FROM reviewer_assignments WHERE review_id = r.review_id) as total_reviewers,
        (SELECT COUNT(*) FROM reviewer_assignments WHERE review_id = r.review_id AND status = 'complete') as completed_reviewers
       FROM review_requests r
       JOIN reviewer_assignments a ON r.review_id = a.review_id
       JOIN boards b ON r.board_id = b.id
       JOIN users u ON r.requested_by_user_id = u.user_id
       WHERE a.user_id = $1
         AND r.status NOT IN ('expired')
         AND NOT (r.status = 'complete' AND r.completed_at < NOW() - INTERVAL '30 days')
       ORDER BY
         CASE a.status
           WHEN 'in_progress' THEN 1
           WHEN 'pending' THEN 2
           WHEN 'complete' THEN 3
           WHEN 'declined' THEN 4
         END,
         r.due_date NULLS LAST,
         r.requested_at DESC
       LIMIT 100`,
      [user_id]
    );

    const reviews = result.rows.map((row) => ({
      review_id: row.review_id,
      board_id: row.board_id,
      board_name: row.board_name,
      requester: {
        user_id: row.requester_user_id,
        name: row.requester_name,
      },
      my_status: row.my_status,
      due_date: row.due_date,
      context_message: row.context_message,
      created_at: row.created_at,
      progress: {
        completed: parseInt(row.completed_reviewers),
        total: parseInt(row.total_reviewers),
      },
    }));

    const total_pending = reviews.filter((r) => r.my_status === 'pending').length;
    const total_in_progress = reviews.filter((r) => r.my_status === 'in_progress').length;

    return {
      reviews,
      total_pending,
      total_in_progress,
    };
  }

  /**
   * Get full review context for review mode (G.2)
   */
  async getReviewContext(review_id: string, user_id: string): Promise<{
    review: ReviewRequest;
    snapshot: any;
    my_assignment: ReviewerAssignment | null;
    all_reviewers: Array<{ user_id: string; name: string; status: string; decision: string | null }>;
    board_changed_since_request: boolean;
  } | null> {
    // Get review
    const review = await this.getReviewRequest(review_id);
    if (!review) return null;

    // Get snapshot from snapshot_records
    const snapshotResult = await this.pool.query(
      'SELECT * FROM snapshot_records WHERE snapshot_id = $1',
      [review.snapshot_id]
    );
    if (snapshotResult.rows.length === 0) return null;
    const snapshot = snapshotResult.rows[0];

    // Get user's assignment
    const myAssignmentResult = await this.pool.query(
      'SELECT * FROM reviewer_assignments WHERE review_id = $1 AND user_id = $2',
      [review_id, user_id]
    );
    const my_assignment = myAssignmentResult.rows.length > 0
      ? this.mapReviewerAssignment(myAssignmentResult.rows[0])
      : null;

    // Get all reviewers with names
    const reviewersResult = await this.pool.query(
      `SELECT a.user_id, u.name, a.status, a.decision
       FROM reviewer_assignments a
       JOIN users u ON a.user_id = u.user_id
       WHERE a.review_id = $1
       ORDER BY a.created_at`,
      [review_id]
    );
    const all_reviewers = reviewersResult.rows;

    // Check if board has changed since review was requested
    const boardResult = await this.pool.query(
      'SELECT updated_at FROM boards WHERE id = $1',
      [review.board_id]
    );
    const board_changed_since_request =
      boardResult.rows.length > 0 &&
      new Date(boardResult.rows[0].updated_at) > new Date(review.requested_at);

    return {
      review,
      snapshot,
      my_assignment,
      all_reviewers,
      board_changed_since_request,
    };
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

  private mapReviewOutcome(row: any): ReviewOutcome {
    return {
      outcome_id: row.outcome_id,
      review_id: row.review_id,
      overall_result: row.overall_result,
      approvals_count: row.approvals_count,
      changes_requested_count: row.changes_requested_count,
      comment_only_count: row.comment_only_count,
      declined_count: row.declined_count,
      total_reviewers: row.total_reviewers,
      key_concerns: typeof row.key_concerns === 'string'
        ? JSON.parse(row.key_concerns)
        : row.key_concerns,
      recommendation: row.recommendation,
      created_at: row.created_at,
    };
  }
}
