/**
 * Session Health Calculator (K.1)
 *
 * Calculates health scores from session metrics using simple arithmetic.
 * No ML required - just thresholds and weighted averages.
 */

import { SessionMetrics } from './session-metrics';

export interface HealthFactor {
  score: number; // 0-100
  signal: string; // Human-readable explanation
}

export interface SessionHealth {
  score: number; // 0-100 overall
  status: 'healthy' | 'warning' | 'stuck';
  factors: {
    velocity: HealthFactor;
    disagreement: HealthFactor;
    progress: HealthFactor;
  };
  hotspots: string[]; // Element IDs with high disagreement
}

/**
 * Calculates session health from metrics
 */
export class HealthCalculator {
  /**
   * Calculate overall health score
   */
  calculate(metrics: SessionMetrics): SessionHealth {
    const velocity = this.scoreVelocity(metrics);
    const disagreement = this.scoreDisagreement(metrics);
    const progress = this.scoreProgress(metrics);

    // Weighted average: disagreement is most important
    const score = Math.round(
      velocity.score * 0.3 + disagreement.score * 0.4 + progress.score * 0.3
    );

    const status = score >= 70 ? 'healthy' : score >= 40 ? 'warning' : 'stuck';

    return {
      score,
      status,
      factors: { velocity, disagreement, progress },
      hotspots: this.findHotspots(metrics),
    };
  }

  /**
   * Score velocity (edit rate)
   *
   * Sweet spot: 1-15 edits/min
   * Too low: stalled
   * Too high: possible confusion
   */
  private scoreVelocity(m: SessionMetrics): HealthFactor {
    const v = m.edits_per_minute;

    if (v === 0) {
      return { score: 30, signal: 'No recent activity' };
    }
    if (v < 1) {
      return { score: 50, signal: 'Low activity' };
    }
    if (v <= 15) {
      return { score: 100, signal: 'Steady progress' };
    }
    if (v <= 30) {
      return { score: 70, signal: 'High activity' };
    }
    return { score: 40, signal: 'Very high activity - possible confusion' };
  }

  /**
   * Score disagreement (conflicting edits on same elements)
   *
   * Conflict indicators:
   * - 2+ editors on same element
   * - 3+ edits on that element
   * - High edit/editor ratio (thrashing)
   */
  private scoreDisagreement(m: SessionMetrics): HealthFactor {
    let maxConflict = 0;
    let conflictElements = 0;

    for (const [_, stats] of m.element_edit_counts) {
      // Require multiple editors AND multiple edits
      if (stats.unique_editors.size >= 2 && stats.edit_count >= 3) {
        conflictElements++;

        // Conflict intensity: edits per editor
        const conflict = stats.edit_count / stats.unique_editors.size;
        maxConflict = Math.max(maxConflict, conflict);
      }
    }

    if (conflictElements === 0) {
      return { score: 100, signal: 'Team aligned' };
    }
    if (maxConflict < 3) {
      return { score: 80, signal: 'Minor disagreements' };
    }
    if (maxConflict < 5) {
      return {
        score: 50,
        signal: `Disagreement on ${conflictElements} element(s)`,
      };
    }
    return {
      score: 20,
      signal: `High conflict on ${conflictElements} element(s)`,
    };
  }

  /**
   * Score progress (forward momentum vs. thrashing)
   *
   * High undo rate = uncertainty/thrashing
   */
  private scoreProgress(m: SessionMetrics): HealthFactor {
    const reversionPenalty = Math.min(50, m.reversion_rate * 100);
    const score = Math.max(0, 100 - reversionPenalty);

    if (m.reversion_rate < 0.1) {
      return { score, signal: 'Forward progress' };
    }
    if (m.reversion_rate < 0.3) {
      return { score, signal: 'Some uncertainty' };
    }
    return { score, signal: 'High undo rate - team uncertain' };
  }

  /**
   * Find hotspot elements (high conflict)
   *
   * Criteria:
   * - 2+ editors
   * - 4+ edits
   * Returns top 5 by edit count
   */
  private findHotspots(m: SessionMetrics): string[] {
    return Array.from(m.element_edit_counts.entries())
      .filter(([_, s]) => s.unique_editors.size >= 2 && s.edit_count >= 4)
      .sort((a, b) => b[1].edit_count - a[1].edit_count)
      .slice(0, 5)
      .map(([id]) => id);
  }
}
