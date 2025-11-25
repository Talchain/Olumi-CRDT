/**
 * Process Suggestion Engine (K.2)
 *
 * Rule-based pattern matching to suggest facilitation interventions.
 * Simple if/then rules - no ML required.
 */

import { SessionHealth } from './health-calculator';
import { randomUUID } from 'crypto';

export interface ProcessSuggestion {
  id: string;
  type: string;
  title: string;
  description: string;
  priority: 'low' | 'medium' | 'high';
  action?: {
    label: string;
    type: string;
    params?: any;
  };
}

export interface BoardStats {
  node_count: number;
  options_count: number;
  goals_count?: number;
  outcomes_count?: number;
}

interface SuggestionRule {
  id: string;
  check: (health: SessionHealth, boardStats: BoardStats) => boolean;
  generate: (health: SessionHealth, boardStats: BoardStats) => ProcessSuggestion;
}

/**
 * Generates process suggestions based on session health and board state
 */
export class SuggestionEngine {
  private dismissed = new Map<string, number>(); // ruleId -> dismissedAt
  private readonly COOLDOWN_MS = 30 * 60 * 1000; // 30 minutes

  private rules: SuggestionRule[] = [
    // Rule 1: Suggest splitting large boards
    {
      id: 'split_board',
      check: (_, board) => board.node_count > 40,
      generate: (_, board) => ({
        id: randomUUID(),
        type: 'split_board',
        title: 'Consider splitting this decision',
        description: `This board has ${board.node_count} nodes. Breaking into smaller decisions may help the team focus.`,
        priority: board.node_count > 60 ? 'high' : 'medium',
        action: {
          label: 'Learn How',
          type: 'open_guide',
          params: { topic: 'splitting' },
        },
      }),
    },

    // Rule 2: Suggest discussion for hotspots
    {
      id: 'schedule_discussion',
      check: (health) => health.hotspots.length >= 2,
      generate: (health) => ({
        id: randomUUID(),
        type: 'schedule_discussion',
        title: 'Schedule a quick sync',
        description: `${health.hotspots.length} elements have competing edits. A 15-min call might help align the team.`,
        priority: 'high',
        action: {
          label: 'View Hotspots',
          type: 'show_hotspots',
          params: { element_ids: health.hotspots },
        },
      }),
    },

    // Rule 3: Suggest break for high undo rate
    {
      id: 'high_undo',
      check: (health) => health.factors.progress.score < 50,
      generate: () => ({
        id: randomUUID(),
        type: 'take_break',
        title: 'Consider a short break',
        description:
          'High undo rate suggests uncertainty. Stepping away for 10 minutes often helps gain clarity.',
        priority: 'low',
      }),
    },

    // Rule 4: Ready to decide (healthy + slowing activity)
    {
      id: 'ready_to_decide',
      check: (health, board) =>
        health.status === 'healthy' &&
        board.options_count >= 4 &&
        health.factors.velocity.score < 60, // Activity slowing
      generate: (_, board) => ({
        id: randomUUID(),
        type: 'ready_to_narrow',
        title: 'Ready to narrow down?',
        description: `You've explored ${board.options_count} options and activity is slowing. It might be time to analyze and decide.`,
        priority: 'medium',
        action: {
          label: 'Run Analysis',
          type: 'trigger_run',
        },
      }),
    },

    // Rule 5: Too many goals
    {
      id: 'too_many_goals',
      check: (_, board) => (board.goals_count || 0) > 5,
      generate: (_, board) => ({
        id: randomUUID(),
        type: 'simplify_goals',
        title: 'Simplify your goals',
        description: `${board.goals_count} goals is a lot. Consider consolidating to 2-3 primary objectives.`,
        priority: 'medium',
        action: {
          label: 'Learn About Goal Setting',
          type: 'open_guide',
          params: { topic: 'goal_setting' },
        },
      }),
    },

    // Rule 6: Low options count
    {
      id: 'explore_more_options',
      check: (health, board) =>
        health.status === 'healthy' &&
        board.options_count < 3 &&
        health.factors.velocity.score > 60, // Still active
      generate: (_, board) => ({
        id: randomUUID(),
        type: 'explore_more',
        title: 'Explore more options?',
        description: `Only ${board.options_count} option(s) so far. Consider exploring 2-3 more alternatives before deciding.`,
        priority: 'low',
      }),
    },

    // Rule 7: Stuck status - facilitate discussion
    {
      id: 'stuck_facilitate',
      check: (health) => health.status === 'stuck',
      generate: (health) => ({
        id: randomUUID(),
        type: 'facilitate_stuck',
        title: 'Session appears stuck',
        description: `Health score: ${health.score}/100. Consider using a facilitation technique like dot voting or timeboxing.`,
        priority: 'high',
        action: {
          label: 'View Techniques',
          type: 'open_guide',
          params: { topic: 'facilitation' },
        },
      }),
    },
  ];

  /**
   * Get suggestions for current session
   */
  getSuggestions(health: SessionHealth, boardStats: BoardStats): ProcessSuggestion[] {
    const now = Date.now();

    return (
      this.rules
        .filter((rule) => {
          // Check cooldown
          const dismissedAt = this.dismissed.get(rule.id);
          if (dismissedAt && now - dismissedAt < this.COOLDOWN_MS) {
            return false;
          }

          // Check rule condition
          return rule.check(health, boardStats);
        })
        .map((rule) => rule.generate(health, boardStats))
        // Sort by priority
        .sort(
          (a, b) =>
            this.priorityOrder(b.priority) - this.priorityOrder(a.priority)
        )
        // Limit to top 3
        .slice(0, 3)
    );
  }

  /**
   * Dismiss a suggestion (apply cooldown)
   */
  dismiss(ruleId: string): void {
    this.dismissed.set(ruleId, Date.now());
  }

  /**
   * Clear dismissals (for testing)
   */
  clearDismissals(): void {
    this.dismissed.clear();
  }

  /**
   * Get dismissal stats
   */
  getDismissalCount(): number {
    return this.dismissed.size;
  }

  /**
   * Priority ordering for sorting
   */
  private priorityOrder(p: string): number {
    return { high: 3, medium: 2, low: 1 }[p] || 0;
  }
}
