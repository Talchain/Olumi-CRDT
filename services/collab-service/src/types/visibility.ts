/**
 * Element-Level Visibility Types
 *
 * Enables selective information sharing for confidential board elements.
 * Part of Phase 4, Section H.1: Element-Level Visibility Model
 */

export type VisibilityMode = 'public' | 'confidential';

export type ElementType = 'goal' | 'option' | 'outcome' | 'assumption' | 'evidence' | 'edge';

/**
 * Visibility configuration for a single board element
 */
export interface ElementVisibility {
  /** Unique visibility record ID */
  visibility_id: string;

  /** Board this visibility rule belongs to */
  board_id: string;

  /** Element this rule applies to */
  element_id: string;
  element_type: ElementType;

  /** Visibility mode */
  visibility_mode: VisibilityMode;

  /** Only for confidential mode: user IDs with access */
  viewer_whitelist?: string[];

  /** Only for confidential mode: roles with access (e.g., 'owner', 'admin') */
  viewer_roles?: string[];

  /** Who set this visibility */
  set_by_user_id: string;
  set_at: string; // ISO timestamp

  /** Optional rationale for confidential marking */
  rationale?: string;

  /** Audit trail */
  created_at: string;
  updated_at: string;
}

/**
 * Board-level visibility policy
 */
export interface VisibilityPolicy {
  policy_id: string;

  /** Board this policy applies to */
  board_id: string;
  org_id: string;
  team_id: string;

  /** Default visibility for new elements */
  default_visibility: VisibilityMode;

  /** Whether to allow viewer whitelisting */
  allow_viewer_whitelist: boolean;

  /** Whether only owners can mark elements confidential */
  require_owner_for_confidential: boolean;

  /** Timestamps */
  created_at: string;
  updated_at: string;
}

/**
 * Visibility change event for audit trail
 */
export interface VisibilityChangeEvent {
  event_id: string;

  board_id: string;
  element_id: string;
  element_type: ElementType;

  /** User who made the change */
  changed_by_user_id: string;
  changed_at: string;

  /** Previous and new visibility settings */
  old_visibility: VisibilityMode | null; // null if first setting
  new_visibility: VisibilityMode;

  /** Previous and new viewer lists (if applicable) */
  old_viewer_whitelist?: string[];
  new_viewer_whitelist?: string[];

  /** Rationale for change */
  rationale?: string;

  /** Cascaded changes (edges affected by node visibility change) */
  cascaded_elements?: string[];
}

/**
 * Visibility check result
 */
export interface VisibilityCheckResult {
  /** Whether user can view element */
  can_view: boolean;

  /** Reason if cannot view */
  reason?: 'confidential' | 'not_whitelisted' | 'insufficient_role';

  /** Whether user can edit visibility settings */
  can_edit_visibility: boolean;
}

/**
 * Redacted element placeholder
 */
export interface RedactedElement {
  element_id: string;
  element_type: ElementType;
  redacted: true;
  placeholder_text: string; // e.g., "[Confidential Outcome]"
}

/**
 * Visibility statistics for a board
 */
export interface VisibilityStats {
  board_id: string;

  total_elements: number;
  confidential_elements: number;
  public_elements: number;

  confidential_by_type: Record<ElementType, number>;

  /** Number of elements with viewer whitelists */
  whitelisted_elements: number;
}
