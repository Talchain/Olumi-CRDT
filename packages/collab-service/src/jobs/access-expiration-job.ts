/**
 * Background job to handle access request expiration
 * Runs periodically to:
 * 1. Find expired access requests
 * 2. Remove users from element viewer whitelists
 * 3. Update request status to 'expired'
 * 4. Queue expiration notifications
 */

import { DatabaseClient } from '../database/client';
import { DocumentManager } from '../collab/document-manager';
import { pino } from 'pino';
import { config } from '../config';

const logger = pino({ level: config.logging.level });

export interface ExpirationJobConfig {
  /** Interval in milliseconds between job runs (default: 5 minutes) */
  intervalMs?: number;
  /** Enable dry-run mode (no actual changes) */
  dryRun?: boolean;
}

export class AccessExpirationJob {
  private intervalHandle: NodeJS.Timeout | null = null;
  private isRunning = false;
  private config: Required<ExpirationJobConfig>;
  private db: DatabaseClient;
  private documentManager: DocumentManager;

  constructor(
    db: DatabaseClient,
    documentManager: DocumentManager,
    config?: ExpirationJobConfig
  ) {
    this.db = db;
    this.documentManager = documentManager;
    this.config = {
      intervalMs: config?.intervalMs || 5 * 60 * 1000, // 5 minutes default
      dryRun: config?.dryRun || false,
    };
  }

  /**
   * Start the background job
   */
  start(): void {
    if (this.intervalHandle) {
      logger.warn('Access expiration job already running');
      return;
    }

    logger.info(
      { intervalMs: this.config.intervalMs, dryRun: this.config.dryRun },
      'Starting access expiration job'
    );

    // Run immediately on start
    this.run().catch((err) => {
      logger.error({ err }, 'Error in initial expiration job run');
    });

    // Then run periodically
    this.intervalHandle = setInterval(() => {
      this.run().catch((err) => {
        logger.error({ err }, 'Error in expiration job run');
      });
    }, this.config.intervalMs);
  }

  /**
   * Stop the background job
   */
  stop(): void {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
      logger.info('Access expiration job stopped');
    }
  }

  /**
   * Execute one run of the expiration job
   */
  async run(): Promise<void> {
    if (this.isRunning) {
      logger.warn('Expiration job already running, skipping this iteration');
      return;
    }

    this.isRunning = true;
    const startTime = Date.now();

    try {
      logger.debug('Running access expiration job');

      // 1. Find expired requests
      const expiredRequests = await this.db.accessRequestsMethods.findExpiredRequests();

      if (expiredRequests.length === 0) {
        logger.debug('No expired access requests found');
        return;
      }

      logger.info(
        { count: expiredRequests.length },
        'Found expired access requests'
      );

      let successCount = 0;
      let errorCount = 0;

      // 2. Process each expired request
      for (const request of expiredRequests) {
        try {
          await this.processExpiredRequest(request);
          successCount++;
        } catch (err) {
          errorCount++;
          logger.error(
            { err, requestId: request.request_id, boardId: request.board_id },
            'Failed to process expired request'
          );
        }
      }

      const duration = Date.now() - startTime;
      logger.info(
        { total: expiredRequests.length, success: successCount, errors: errorCount, durationMs: duration },
        'Access expiration job completed'
      );
    } catch (err) {
      logger.error({ err }, 'Error running expiration job');
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Process a single expired access request
   */
  private async processExpiredRequest(request: any): Promise<void> {
    const { request_id, board_id, element_id, requester_user_id } = request;

    logger.info(
      { requestId: request_id, boardId: board_id, elementId: element_id, userId: requester_user_id },
      'Processing expired access request'
    );

    if (this.config.dryRun) {
      logger.info(
        { requestId: request_id },
        'DRY RUN: Would expire request and remove from whitelist'
      );
      return;
    }

    // 1. Get current visibility settings
    const visibility = await this.documentManager.visibilityManager.getElementVisibility(
      board_id,
      element_id
    );

    if (!visibility) {
      logger.warn(
        { requestId: request_id, elementId: element_id },
        'Element visibility not found, marking request as expired'
      );
      await this.db.accessRequestsMethods.markAsExpired(request_id);
      return;
    }

    // 2. Remove user from viewer whitelist
    const currentWhitelist = visibility.viewer_whitelist || [];
    if (currentWhitelist.includes(requester_user_id)) {
      const newWhitelist = currentWhitelist.filter((id) => id !== requester_user_id);

      // Get board details for authorization context
      const board = await this.db.getBoard(board_id);
      if (!board) {
        logger.error(
          { requestId: request_id, boardId: board_id },
          'Board not found, cannot update whitelist'
        );
        await this.db.accessRequestsMethods.markAsExpired(request_id);
        return;
      }

      // Update visibility with system context (OWNER role for expiration job)
      await this.documentManager.visibilityManager.setElementVisibility(
        board_id,
        board.orgId,
        board.teamId,
        'system', // System user for background jobs
        'OWNER', // System acts as OWNER for expiration
        {
          elementId: element_id,
          elementType: visibility.element_type,
          visibilityMode: visibility.visibility_mode,
          viewerWhitelist: newWhitelist,
          viewerRoles: visibility.viewer_roles,
          rationale: `Access expired for request ${request_id}`,
        }
      );

      logger.info(
        { requestId: request_id, userId: requester_user_id, elementId: element_id },
        'Removed user from viewer whitelist'
      );
    } else {
      logger.debug(
        { requestId: request_id, userId: requester_user_id },
        'User not in whitelist, skipping removal'
      );
    }

    // 3. Mark request as expired
    await this.db.accessRequestsMethods.markAsExpired(request_id);

    // 4. TODO: Queue expiration notification for requester
    logger.debug(
      { requestId: request_id, userId: requester_user_id },
      'TODO: Queue expiration notification'
    );
  }

  /**
   * Get job status for monitoring
   */
  getStatus(): {
    isRunning: boolean;
    intervalMs: number;
    dryRun: boolean;
    isActive: boolean;
  } {
    return {
      isRunning: this.isRunning,
      intervalMs: this.config.intervalMs,
      dryRun: this.config.dryRun,
      isActive: this.intervalHandle !== null,
    };
  }

  /**
   * Manual trigger for testing or admin operations
   */
  async triggerManual(): Promise<void> {
    logger.info('Manually triggered expiration job');
    await this.run();
  }
}

/**
 * Create and start expiration job with default config
 */
export function createExpirationJob(
  db: DatabaseClient,
  documentManager: DocumentManager,
  config?: ExpirationJobConfig
): AccessExpirationJob {
  const job = new AccessExpirationJob(db, documentManager, config);
  job.start();
  return job;
}
