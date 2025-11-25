/**
 * Fastify JSON Schema Definitions
 *
 * Centralized schemas for request/response validation across all API routes.
 * Based on validation patterns from utils/validation.ts
 *
 * Security: These schemas prevent malformed input attacks and ensure consistent
 * validation across the entire API surface.
 */

import { ValidationLimits } from '../utils/validation';

// ============================================================================
// Common Patterns & Formats
// ============================================================================

export const elementIdPattern = '^[a-z]+-[0-9a-zA-Z]+$';
export const uuidPattern = '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';

// ============================================================================
// Basic Type Schemas
// ============================================================================

export const elementIdSchema = {
  type: 'string',
  minLength: 1,
  maxLength: ValidationLimits.MAX_ELEMENT_ID_LENGTH,
  pattern: elementIdPattern,
  description: 'Element ID in format: type-identifier (e.g., goal-123)',
} as const;

export const uuidSchema = {
  type: 'string',
  minLength: 36,
  maxLength: 36,
  pattern: uuidPattern,
  description: 'UUID v4 identifier',
} as const;

export const elementTypeSchema = {
  type: 'string',
  enum: ['goal', 'option', 'outcome', 'assumption', 'evidence', 'edge'],
  description: 'Type of board element',
} as const;

export const visibilityModeSchema = {
  type: 'string',
  enum: ['public', 'confidential'],
  description: 'Visibility mode for elements',
} as const;

export const userRoleSchema = {
  type: 'string',
  enum: ['VIEWER', 'EDITOR', 'ADMIN', 'OWNER'],
  description: 'User role in team hierarchy',
} as const;

export const reviewDecisionSchema = {
  type: 'string',
  enum: ['approve', 'request_changes', 'comment_only'],
  description: 'Review decision type',
} as const;

export const completionRuleSchema = {
  type: 'string',
  enum: ['all', 'majority', 'threshold'],
  description: 'Review completion rule',
} as const;

// ============================================================================
// Params Schemas
// ============================================================================

export const boardIdParams = {
  type: 'object',
  required: ['boardId'],
  properties: {
    boardId: uuidSchema,
  },
  additionalProperties: false,
} as const;

export const snapshotIdParams = {
  type: 'object',
  required: ['snapshotId'],
  properties: {
    snapshotId: uuidSchema,
  },
  additionalProperties: false,
} as const;

export const reviewIdParams = {
  type: 'object',
  required: ['reviewId'],
  properties: {
    reviewId: uuidSchema,
  },
  additionalProperties: false,
} as const;

export const assignmentIdParams = {
  type: 'object',
  required: ['assignmentId'],
  properties: {
    assignmentId: uuidSchema,
  },
  additionalProperties: false,
} as const;

export const policyIdParams = {
  type: 'object',
  required: ['policyId'],
  properties: {
    policyId: uuidSchema,
  },
  additionalProperties: false,
} as const;

export const accessRequestIdParams = {
  type: 'object',
  required: ['requestId'],
  properties: {
    requestId: uuidSchema,
  },
  additionalProperties: false,
} as const;

// ============================================================================
// Request Body Schemas
// ============================================================================

export const createSnapshotBody = {
  type: 'object',
  required: ['name'],
  properties: {
    name: {
      type: 'string',
      minLength: 1,
      maxLength: 200,
      description: 'Snapshot name',
    },
    description: {
      type: 'string',
      maxLength: 1000,
      description: 'Optional snapshot description',
    },
  },
  additionalProperties: false,
} as const;

export const renameSnapshotBody = {
  type: 'object',
  required: ['name'],
  properties: {
    name: {
      type: 'string',
      minLength: 1,
      maxLength: 200,
      description: 'New snapshot name',
    },
  },
  additionalProperties: false,
} as const;

export const visibilityChangeBody = {
  type: 'object',
  required: ['element_id', 'new_mode'],
  properties: {
    element_id: elementIdSchema,
    new_mode: visibilityModeSchema,
    viewer_whitelist: {
      type: 'array',
      items: uuidSchema,
      maxItems: ValidationLimits.MAX_WHITELIST_SIZE,
      uniqueItems: true,
      description: 'User IDs who can view confidential element',
    },
    rationale: {
      type: 'string',
      maxLength: ValidationLimits.MAX_RATIONALE_LENGTH,
      description: 'Reason for visibility change',
    },
    cascaded: {
      type: 'array',
      items: elementIdSchema,
      maxItems: ValidationLimits.MAX_CASCADED_ELEMENTS,
      description: 'Elements to cascade visibility change to',
    },
  },
  additionalProperties: false,
} as const;

export const visibilityPolicyBody = {
  type: 'object',
  required: ['name', 'element_type', 'default_mode'],
  properties: {
    name: {
      type: 'string',
      minLength: 1,
      maxLength: ValidationLimits.MAX_POLICY_NAME_LENGTH,
      description: 'Policy name',
    },
    element_type: elementTypeSchema,
    default_mode: visibilityModeSchema,
    viewer_whitelist: {
      type: 'array',
      items: uuidSchema,
      maxItems: ValidationLimits.MAX_WHITELIST_SIZE,
      uniqueItems: true,
    },
    auto_cascade: {
      type: 'boolean',
      description: 'Automatically cascade to connected elements',
    },
  },
  additionalProperties: false,
} as const;

export const createReviewBody = {
  type: 'object',
  required: ['snapshot_id', 'reviewer_user_ids', 'completion_rule'],
  properties: {
    snapshot_id: uuidSchema,
    reviewer_user_ids: {
      type: 'array',
      items: uuidSchema,
      minItems: 1,
      maxItems: 50,
      uniqueItems: true,
      description: 'User IDs to request review from',
    },
    completion_rule: completionRuleSchema,
    threshold_count: {
      type: 'integer',
      minimum: 1,
      maximum: 50,
      description: 'Number of approvals needed (for threshold rule)',
    },
    due_date: {
      type: 'string',
      format: 'date-time',
      description: 'Review due date (ISO 8601)',
    },
    context_message: {
      type: 'string',
      maxLength: 2000,
      description: 'Context/instructions for reviewers',
    },
  },
  additionalProperties: false,
} as const;

export const updateReviewerBody = {
  type: 'object',
  required: ['decision'],
  properties: {
    decision: reviewDecisionSchema,
  },
  additionalProperties: false,
} as const;

export const addReviewCommentBody = {
  type: 'object',
  required: ['comment_text'],
  properties: {
    comment_text: {
      type: 'string',
      minLength: 1,
      maxLength: 5000,
      description: 'Comment text',
    },
    element_id: elementIdSchema,
  },
  additionalProperties: false,
} as const;

export const createAccessRequestBody = {
  type: 'object',
  required: ['board_id', 'requested_role'],
  properties: {
    board_id: uuidSchema,
    requested_role: userRoleSchema,
    rationale: {
      type: 'string',
      maxLength: ValidationLimits.MAX_RATIONALE_LENGTH,
      description: 'Reason for access request',
    },
  },
  additionalProperties: false,
} as const;

export const approveAccessRequestBody = {
  type: 'object',
  properties: {
    granted_role: userRoleSchema,
    duration_days: {
      type: 'integer',
      minimum: ValidationLimits.MIN_DAYS_TO_KEEP,
      maximum: ValidationLimits.MAX_DAYS_TO_KEEP,
      description: 'Access duration in days',
    },
  },
  additionalProperties: false,
} as const;

export const denyAccessRequestBody = {
  type: 'object',
  properties: {
    reason: {
      type: 'string',
      maxLength: 1000,
      description: 'Reason for denial',
    },
  },
  additionalProperties: false,
} as const;

export const addCommentBody = {
  type: 'object',
  required: ['element_id', 'comment_text'],
  properties: {
    element_id: elementIdSchema,
    comment_text: {
      type: 'string',
      minLength: 1,
      maxLength: 5000,
      description: 'Comment text',
    },
  },
  additionalProperties: false,
} as const;

// ============================================================================
// Query String Schemas
// ============================================================================

export const paginationQuery = {
  type: 'object',
  properties: {
    limit: {
      type: 'integer',
      minimum: 1,
      maximum: 100,
      default: 20,
      description: 'Number of results to return',
    },
    offset: {
      type: 'integer',
      minimum: 0,
      default: 0,
      description: 'Number of results to skip',
    },
  },
  additionalProperties: false,
} as const;

export const snapshotListQuery = {
  type: 'object',
  properties: {
    limit: {
      type: 'string',
      pattern: '^[0-9]+$',
      description: 'Max snapshots to return (as string)',
    },
  },
  additionalProperties: false,
} as const;

export const commentsQuery = {
  type: 'object',
  properties: {
    element_id: elementIdSchema,
  },
  additionalProperties: false,
} as const;

// ============================================================================
// Response Schemas
// ============================================================================

export const successResponse = {
  type: 'object',
  required: ['success'],
  properties: {
    success: { type: 'boolean', const: true },
    data: { type: 'object' },
  },
} as const;

export const errorResponse = {
  type: 'object',
  required: ['success', 'error'],
  properties: {
    success: { type: 'boolean', const: false },
    error: { type: 'string' },
    code: { type: 'string' },
  },
} as const;

export const healthResponse = {
  type: 'object',
  required: ['status', 'timestamp'],
  properties: {
    status: { type: 'string', enum: ['ok', 'degraded', 'down'] },
    timestamp: { type: 'string', format: 'date-time' },
    metrics: { type: 'object' },
  },
} as const;

// ============================================================================
// Complete Route Schemas (combines params + body + response)
// ============================================================================

export const routeSchemas = {
  // Health endpoint
  getHealth: {
    response: {
      200: healthResponse,
    },
  },

  // Snapshot routes
  createSnapshot: {
    params: boardIdParams,
    body: createSnapshotBody,
    response: {
      200: successResponse,
      400: errorResponse,
      401: errorResponse,
      403: errorResponse,
    },
  },

  getSnapshots: {
    params: boardIdParams,
    querystring: snapshotListQuery,
    response: {
      200: successResponse,
      401: errorResponse,
      403: errorResponse,
    },
  },

  renameSnapshot: {
    params: snapshotIdParams,
    body: renameSnapshotBody,
    response: {
      200: successResponse,
      400: errorResponse,
      401: errorResponse,
      403: errorResponse,
      404: errorResponse,
    },
  },

  // Visibility routes
  changeVisibility: {
    params: boardIdParams,
    body: visibilityChangeBody,
    response: {
      200: successResponse,
      400: errorResponse,
      401: errorResponse,
      403: errorResponse,
    },
  },

  createVisibilityPolicy: {
    params: boardIdParams,
    body: visibilityPolicyBody,
    response: {
      200: successResponse,
      400: errorResponse,
      401: errorResponse,
      403: errorResponse,
    },
  },

  // Review routes
  createReview: {
    params: boardIdParams,
    body: createReviewBody,
    response: {
      200: successResponse,
      400: errorResponse,
      401: errorResponse,
      403: errorResponse,
      404: errorResponse,
    },
  },

  updateReviewer: {
    params: assignmentIdParams,
    body: updateReviewerBody,
    response: {
      200: successResponse,
      400: errorResponse,
      401: errorResponse,
      403: errorResponse,
      404: errorResponse,
    },
  },

  addReviewComment: {
    params: reviewIdParams,
    body: addReviewCommentBody,
    response: {
      200: successResponse,
      400: errorResponse,
      401: errorResponse,
      403: errorResponse,
      404: errorResponse,
    },
  },

  // Access request routes
  createAccessRequest: {
    body: createAccessRequestBody,
    response: {
      200: successResponse,
      400: errorResponse,
      401: errorResponse,
    },
  },

  approveAccessRequest: {
    params: accessRequestIdParams,
    body: approveAccessRequestBody,
    response: {
      200: successResponse,
      400: errorResponse,
      401: errorResponse,
      403: errorResponse,
      404: errorResponse,
    },
  },

  denyAccessRequest: {
    params: accessRequestIdParams,
    body: denyAccessRequestBody,
    response: {
      200: successResponse,
      400: errorResponse,
      401: errorResponse,
      403: errorResponse,
      404: errorResponse,
    },
  },

  // Comment routes
  addComment: {
    params: boardIdParams,
    body: addCommentBody,
    response: {
      200: successResponse,
      400: errorResponse,
      401: errorResponse,
      403: errorResponse,
    },
  },

  getComments: {
    params: boardIdParams,
    querystring: commentsQuery,
    response: {
      200: successResponse,
      401: errorResponse,
      403: errorResponse,
    },
  },
} as const;
