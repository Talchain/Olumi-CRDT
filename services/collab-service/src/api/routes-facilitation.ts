/**
 * Smart Facilitation API Routes (K.1-K.2)
 *
 * Session health scoring and process suggestions
 */

import { FastifyInstance } from 'fastify';
import { DatabaseClient } from '../database/client';
import { MetricsCollector } from '../facilitation/session-metrics';
import { HealthCalculator } from '../facilitation/health-calculator';
import { SuggestionEngine } from '../facilitation/suggestion-engine';
import { pino } from 'pino';
import { config } from '../config';

const logger = pino({ level: config.logging.level });

interface BoardIdParams {
  boardId: string;
}

interface SuggestionIdParams {
  boardId: string;
  ruleId: string;
}

export async function registerFacilitationRoutes(
  app: FastifyInstance,
  db: DatabaseClient,
  metricsCollector: MetricsCollector
): Promise<void> {
  const healthCalculator = new HealthCalculator();
  const suggestionEngine = new SuggestionEngine();

  /**
   * GET /boards/:boardId/session/health
   * Get real-time session health metrics
   */
  app.get<{ Params: BoardIdParams }>(
    '/api/boards/:boardId/session/health',
    {
      preHandler: [(app as any).authenticate],
    },
    async (request, reply) => {
      const req = request as any;
      const { boardId } = request.params;

      try {
        // Verify board access
        const board = await db.getBoardMetadata(boardId);
        if (!board) {
          return reply.code(404).send({
            success: false,
            error: 'Board not found',
          });
        }

        // Get metrics and calculate health
        const metrics = metricsCollector.getMetrics(boardId);
        const health = healthCalculator.calculate(metrics);

        logger.debug(
          {
            boardId,
            userId: req.user.userId,
            score: health.score,
            status: health.status,
          },
          'Session health retrieved'
        );

        reply.send({
          success: true,
          data: {
            ...health,
            // Include raw metrics for debugging
            metrics: {
              edit_count: metrics.edit_count,
              unique_editor_count: metrics.unique_editor_count,
              edits_per_minute: metrics.edits_per_minute,
              reversion_rate: metrics.reversion_rate,
              window_start: metrics.window_start,
              window_end: metrics.window_end,
            },
          },
        });
      } catch (err) {
        logger.error({ err, boardId }, 'Failed to get session health');
        reply.code(500).send({
          success: false,
          error: 'Internal server error',
        });
      }
    }
  );

  /**
   * GET /boards/:boardId/facilitation/suggestions
   * Get process suggestions based on session health
   */
  app.get<{ Params: BoardIdParams }>(
    '/api/boards/:boardId/facilitation/suggestions',
    {
      preHandler: [(app as any).authenticate],
    },
    async (request, reply) => {
      const req = request as any;
      const { boardId } = request.params;

      try {
        // Verify board access
        const board = await db.getBoardMetadata(boardId);
        if (!board) {
          return reply.code(404).send({
            success: false,
            error: 'Board not found',
          });
        }

        // Get session health
        const metrics = metricsCollector.getMetrics(boardId);
        const health = healthCalculator.calculate(metrics);

        // Get board stats (count nodes/options)
        const boardData = await db.getBoard(boardId);
        const boardStats = {
          node_count: countAllNodes(boardData),
          options_count: (boardData?.options || []).length,
          goals_count: (boardData?.goals || []).length,
          outcomes_count: (boardData?.outcomes || []).length,
        };

        // Get suggestions
        const suggestions = suggestionEngine.getSuggestions(health, boardStats);

        logger.debug(
          {
            boardId,
            userId: req.user.userId,
            suggestionCount: suggestions.length,
            healthScore: health.score,
          },
          'Suggestions generated'
        );

        reply.send({
          success: true,
          data: {
            suggestions,
            health_score: health.score,
            health_status: health.status,
          },
        });
      } catch (err) {
        logger.error({ err, boardId }, 'Failed to get suggestions');
        reply.code(500).send({
          success: false,
          error: 'Internal server error',
        });
      }
    }
  );

  /**
   * POST /boards/:boardId/facilitation/suggestions/:ruleId/dismiss
   * Dismiss a suggestion (applies 30-min cooldown)
   */
  app.post<{ Params: SuggestionIdParams }>(
    '/api/boards/:boardId/facilitation/suggestions/:ruleId/dismiss',
    {
      preHandler: [(app as any).authenticate],
    },
    async (request, reply) => {
      const { boardId, ruleId } = request.params;

      try {
        // Verify board access
        const board = await db.getBoardMetadata(boardId);
        if (!board) {
          return reply.code(404).send({
            success: false,
            error: 'Board not found',
          });
        }

        suggestionEngine.dismiss(ruleId);

        logger.debug({ boardId, ruleId }, 'Suggestion dismissed');

        reply.send({
          success: true,
          data: { dismissed: true, cooldown_minutes: 30 },
        });
      } catch (err) {
        logger.error({ err, boardId, ruleId }, 'Failed to dismiss suggestion');
        reply.code(500).send({
          success: false,
          error: 'Internal server error',
        });
      }
    }
  );

  /**
   * Helper to count all nodes in board
   */
  function countAllNodes(boardData: any): number {
    if (!boardData) return 0;

    return (
      (boardData.goals || []).length +
      (boardData.options || []).length +
      (boardData.outcomes || []).length +
      (boardData.assumptions || []).length +
      (boardData.evidence || []).length
    );
  }

  logger.info('Facilitation routes registered');
}
