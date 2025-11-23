/**
 * Shared Job Type Definitions for Job Scheduler
 * Defines all background job types and their payloads
 */

/**
 * Base job interface that all jobs must implement
 */
export interface BaseJob {
  job_id: string;
  job_type: string;
  created_at: string;
  scheduled_for?: string;
  retry_count?: number;
  max_retries?: number;
}

// ============================================================================
// ACCESS REQUEST JOBS
// ============================================================================

export interface ExpireAccessRequestsJob extends BaseJob {
  job_type: 'EXPIRE_ACCESS_REQUESTS';
  payload: {
    dry_run?: boolean;
  };
}

export interface NotifyExpiringAccessJob extends BaseJob {
  job_type: 'NOTIFY_EXPIRING_ACCESS';
  payload: {
    days_before_expiry: number;
  };
}

// ============================================================================
// CLEANUP JOBS
// ============================================================================

export interface CleanupOldAuditLogsJob extends BaseJob {
  job_type: 'CLEANUP_OLD_AUDIT_LOGS';
  payload: {
    retention_days: number;
  };
}

export interface CleanupExpiredSessionsJob extends BaseJob {
  job_type: 'CLEANUP_EXPIRED_SESSIONS';
  payload: {
    expired_before: string;
  };
}

// ============================================================================
// ANALYTICS JOBS
// ============================================================================

export interface GenerateDailyAnalyticsJob extends BaseJob {
  job_type: 'GENERATE_DAILY_ANALYTICS';
  payload: {
    date: string;
    org_id?: string;
  };
}

// ============================================================================
// UNION TYPE OF ALL JOBS
// ============================================================================

export type OlumiJob =
  | ExpireAccessRequestsJob
  | NotifyExpiringAccessJob
  | CleanupOldAuditLogsJob
  | CleanupExpiredSessionsJob
  | GenerateDailyAnalyticsJob;

// ============================================================================
// JOB TYPE CONSTANTS
// ============================================================================

export const JOB_TYPES = {
  EXPIRE_ACCESS_REQUESTS: 'EXPIRE_ACCESS_REQUESTS',
  NOTIFY_EXPIRING_ACCESS: 'NOTIFY_EXPIRING_ACCESS',
  CLEANUP_OLD_AUDIT_LOGS: 'CLEANUP_OLD_AUDIT_LOGS',
  CLEANUP_EXPIRED_SESSIONS: 'CLEANUP_EXPIRED_SESSIONS',
  GENERATE_DAILY_ANALYTICS: 'GENERATE_DAILY_ANALYTICS',
} as const;

export type JobType = typeof JOB_TYPES[keyof typeof JOB_TYPES];

// ============================================================================
// JOB SCHEDULE CONFIGURATIONS
// ============================================================================

export interface JobSchedule {
  job_type: JobType;
  cron: string;
  enabled: boolean;
  timezone?: string;
  max_retries?: number;
  timeout_ms?: number;
}

export const DEFAULT_JOB_SCHEDULES: JobSchedule[] = [
  {
    job_type: 'EXPIRE_ACCESS_REQUESTS',
    cron: '*/5 * * * *', // Every 5 minutes
    enabled: true,
    max_retries: 3,
    timeout_ms: 30000,
  },
  {
    job_type: 'NOTIFY_EXPIRING_ACCESS',
    cron: '0 9 * * *', // Daily at 9 AM
    enabled: true,
    max_retries: 2,
    timeout_ms: 60000,
  },
  {
    job_type: 'CLEANUP_OLD_AUDIT_LOGS',
    cron: '0 2 * * 0', // Weekly on Sunday at 2 AM
    enabled: true,
    max_retries: 1,
    timeout_ms: 300000,
  },
  {
    job_type: 'CLEANUP_EXPIRED_SESSIONS',
    cron: '0 3 * * *', // Daily at 3 AM
    enabled: true,
    max_retries: 2,
    timeout_ms: 120000,
  },
  {
    job_type: 'GENERATE_DAILY_ANALYTICS',
    cron: '0 1 * * *', // Daily at 1 AM
    enabled: true,
    max_retries: 3,
    timeout_ms: 600000,
  },
];
