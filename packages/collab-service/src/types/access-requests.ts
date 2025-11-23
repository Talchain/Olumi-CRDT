/**
 * Access Request types for confidential element access workflow
 */

export type AccessRequestStatus = 'pending' | 'approved' | 'denied' | 'expired';

export interface AccessRequest {
  request_id: string;
  board_id: string;
  element_id: string;

  requester_user_id: string;
  requested_at: string; // ISO timestamp
  rationale?: string;

  status: AccessRequestStatus;

  // Approval path
  approved_by_user_id?: string;
  approved_at?: string;
  expires_at?: string; // Time-boxed access

  // Denial path
  denied_by_user_id?: string;
  denied_at?: string;
  denial_reason?: string;

  // Metadata
  created_at: string;
  updated_at: string;
}

export interface CreateAccessRequestParams {
  board_id: string;
  element_id: string;
  requester_user_id: string;
  rationale?: string;
}

export interface ApproveAccessRequestParams {
  request_id: string;
  approved_by_user_id: string;
  expires_in_days?: number; // Default: 7, max: 90
}

export interface DenyAccessRequestParams {
  request_id: string;
  denied_by_user_id: string;
  denial_reason?: string;
}

export interface AccessRequestWithRequester extends AccessRequest {
  requester_name: string;
  requester_email: string;
}
