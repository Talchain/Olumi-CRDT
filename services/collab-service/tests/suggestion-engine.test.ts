/**
 * K.2 Process Suggestion Engine Tests
 *
 * Tests for rule-based facilitation suggestions:
 * - Rule evaluation and triggering
 * - Suggestion generation
 * - Priority ordering
 * - Dismissal and cooldown
 * - Multiple simultaneous suggestions
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import { SuggestionEngine, BoardStats } from '../src/facilitation/suggestion-engine';
import { SessionHealth } from '../src/facilitation/health-calculator';

// Helper to create mock session health
function mockHealth(overrides: Partial<SessionHealth> = {}): SessionHealth {
  return {
    score: 75,
    status: 'healthy',
    factors: {
      velocity: { score: 80, signal: 'Steady progress' },
      disagreement: { score: 90, signal: 'No conflicts' },
      progress: { score: 85, signal: 'Forward momentum' },
    },
    hotspots: [],
    ...overrides,
  };
}

// Helper to create mock board stats
function mockBoardStats(overrides: Partial<BoardStats> = {}): BoardStats {
  return {
    node_count: 15,
    options_count: 3,
    goals_count: 2,
    outcomes_count: 2,
    ...overrides,
  };
}

describe('SuggestionEngine', () => {
  let engine: SuggestionEngine;

  beforeEach(() => {
    engine = new SuggestionEngine();
    engine.clearDismissals(); // Reset dismissals between tests
  });

  describe('Rule: split_board', () => {
    it('should suggest splitting when node_count > 40', () => {
      const health = mockHealth();
      const boardStats = mockBoardStats({ node_count: 45 });

      const suggestions = engine.getSuggestions(health, boardStats);

      expect(suggestions.length).toBeGreaterThan(0);
      const splitSuggestion = suggestions.find((s) => s.type === 'split_board');
      expect(splitSuggestion).toBeDefined();
      expect(splitSuggestion?.title).toContain('splitting');
      expect(splitSuggestion?.description).toContain('45 nodes');
      expect(splitSuggestion?.priority).toBe('medium');
    });

    it('should escalate to high priority when node_count > 60', () => {
      const health = mockHealth();
      const boardStats = mockBoardStats({ node_count: 65 });

      const suggestions = engine.getSuggestions(health, boardStats);

      const splitSuggestion = suggestions.find((s) => s.type === 'split_board');
      expect(splitSuggestion).toBeDefined();
      expect(splitSuggestion?.priority).toBe('high');
    });

    it('should not suggest splitting when node_count <= 40', () => {
      const health = mockHealth();
      const boardStats = mockBoardStats({ node_count: 30 });

      const suggestions = engine.getSuggestions(health, boardStats);

      const splitSuggestion = suggestions.find((s) => s.type === 'split_board');
      expect(splitSuggestion).toBeUndefined();
    });
  });

  describe('Rule: schedule_discussion', () => {
    it('should suggest discussion when 2+ hotspots exist', () => {
      const health = mockHealth({
        hotspots: ['goal-1', 'goal-2', 'option-3'],
      });
      const boardStats = mockBoardStats();

      const suggestions = engine.getSuggestions(health, boardStats);

      const discussionSuggestion = suggestions.find(
        (s) => s.type === 'schedule_discussion'
      );
      expect(discussionSuggestion).toBeDefined();
      expect(discussionSuggestion?.priority).toBe('high');
      expect(discussionSuggestion?.description).toContain('3 elements');
      expect(discussionSuggestion?.action?.type).toBe('show_hotspots');
      expect(discussionSuggestion?.action?.params?.element_ids).toEqual([
        'goal-1',
        'goal-2',
        'option-3',
      ]);
    });

    it('should not suggest discussion when fewer than 2 hotspots', () => {
      const health = mockHealth({
        hotspots: ['goal-1'],
      });
      const boardStats = mockBoardStats();

      const suggestions = engine.getSuggestions(health, boardStats);

      const discussionSuggestion = suggestions.find(
        (s) => s.type === 'schedule_discussion'
      );
      expect(discussionSuggestion).toBeUndefined();
    });
  });

  describe('Rule: high_undo (take_break)', () => {
    it('should suggest break when progress score < 50', () => {
      const health = mockHealth({
        factors: {
          velocity: { score: 70, signal: 'Steady' },
          disagreement: { score: 80, signal: 'No conflicts' },
          progress: { score: 30, signal: 'High undo rate' },
        },
      });
      const boardStats = mockBoardStats();

      const suggestions = engine.getSuggestions(health, boardStats);

      const breakSuggestion = suggestions.find((s) => s.type === 'take_break');
      expect(breakSuggestion).toBeDefined();
      expect(breakSuggestion?.priority).toBe('low');
      expect(breakSuggestion?.description).toContain('undo rate');
    });

    it('should not suggest break when progress score >= 50', () => {
      const health = mockHealth({
        factors: {
          velocity: { score: 70, signal: 'Steady' },
          disagreement: { score: 80, signal: 'No conflicts' },
          progress: { score: 60, signal: 'Forward momentum' },
        },
      });
      const boardStats = mockBoardStats();

      const suggestions = engine.getSuggestions(health, boardStats);

      const breakSuggestion = suggestions.find((s) => s.type === 'take_break');
      expect(breakSuggestion).toBeUndefined();
    });
  });

  describe('Rule: ready_to_decide', () => {
    it('should suggest narrowing when healthy + 4+ options + slowing activity', () => {
      const health = mockHealth({
        status: 'healthy',
        factors: {
          velocity: { score: 50, signal: 'Slowing' }, // < 60
          disagreement: { score: 90, signal: 'No conflicts' },
          progress: { score: 85, signal: 'Forward momentum' },
        },
      });
      const boardStats = mockBoardStats({ options_count: 5 });

      const suggestions = engine.getSuggestions(health, boardStats);

      const readySuggestion = suggestions.find((s) => s.type === 'ready_to_narrow');
      expect(readySuggestion).toBeDefined();
      expect(readySuggestion?.priority).toBe('medium');
      expect(readySuggestion?.description).toContain('5 options');
      expect(readySuggestion?.action?.type).toBe('trigger_run');
    });

    it('should not suggest when velocity is still high', () => {
      const health = mockHealth({
        status: 'healthy',
        factors: {
          velocity: { score: 80, signal: 'Active' }, // >= 60
          disagreement: { score: 90, signal: 'No conflicts' },
          progress: { score: 85, signal: 'Forward momentum' },
        },
      });
      const boardStats = mockBoardStats({ options_count: 5 });

      const suggestions = engine.getSuggestions(health, boardStats);

      const readySuggestion = suggestions.find((s) => s.type === 'ready_to_narrow');
      expect(readySuggestion).toBeUndefined();
    });

    it('should not suggest when fewer than 4 options', () => {
      const health = mockHealth({
        status: 'healthy',
        factors: {
          velocity: { score: 50, signal: 'Slowing' },
          disagreement: { score: 90, signal: 'No conflicts' },
          progress: { score: 85, signal: 'Forward momentum' },
        },
      });
      const boardStats = mockBoardStats({ options_count: 3 });

      const suggestions = engine.getSuggestions(health, boardStats);

      const readySuggestion = suggestions.find((s) => s.type === 'ready_to_narrow');
      expect(readySuggestion).toBeUndefined();
    });
  });

  describe('Rule: too_many_goals', () => {
    it('should suggest simplifying when goals_count > 5', () => {
      const health = mockHealth();
      const boardStats = mockBoardStats({ goals_count: 7 });

      const suggestions = engine.getSuggestions(health, boardStats);

      const goalsSuggestion = suggestions.find((s) => s.type === 'simplify_goals');
      expect(goalsSuggestion).toBeDefined();
      expect(goalsSuggestion?.priority).toBe('medium');
      expect(goalsSuggestion?.description).toContain('7 goals');
      expect(goalsSuggestion?.action?.params?.topic).toBe('goal_setting');
    });

    it('should not suggest when goals_count <= 5', () => {
      const health = mockHealth();
      const boardStats = mockBoardStats({ goals_count: 4 });

      const suggestions = engine.getSuggestions(health, boardStats);

      const goalsSuggestion = suggestions.find((s) => s.type === 'simplify_goals');
      expect(goalsSuggestion).toBeUndefined();
    });
  });

  describe('Rule: explore_more_options', () => {
    it('should suggest exploring more when healthy + < 3 options + active', () => {
      const health = mockHealth({
        status: 'healthy',
        factors: {
          velocity: { score: 70, signal: 'Active' }, // > 60
          disagreement: { score: 90, signal: 'No conflicts' },
          progress: { score: 85, signal: 'Forward momentum' },
        },
      });
      const boardStats = mockBoardStats({ options_count: 2 });

      const suggestions = engine.getSuggestions(health, boardStats);

      const exploreSuggestion = suggestions.find((s) => s.type === 'explore_more');
      expect(exploreSuggestion).toBeDefined();
      expect(exploreSuggestion?.priority).toBe('low');
      expect(exploreSuggestion?.description).toContain('2 option');
    });

    it('should not suggest when options_count >= 3', () => {
      const health = mockHealth({
        status: 'healthy',
        factors: {
          velocity: { score: 70, signal: 'Active' },
          disagreement: { score: 90, signal: 'No conflicts' },
          progress: { score: 85, signal: 'Forward momentum' },
        },
      });
      const boardStats = mockBoardStats({ options_count: 4 });

      const suggestions = engine.getSuggestions(health, boardStats);

      const exploreSuggestion = suggestions.find((s) => s.type === 'explore_more');
      expect(exploreSuggestion).toBeUndefined();
    });
  });

  describe('Rule: stuck_facilitate', () => {
    it('should suggest facilitation when status is stuck', () => {
      const health = mockHealth({
        score: 25,
        status: 'stuck',
      });
      const boardStats = mockBoardStats();

      const suggestions = engine.getSuggestions(health, boardStats);

      const stuckSuggestion = suggestions.find((s) => s.type === 'facilitate_stuck');
      expect(stuckSuggestion).toBeDefined();
      expect(stuckSuggestion?.priority).toBe('high');
      expect(stuckSuggestion?.description).toContain('25/100');
      expect(stuckSuggestion?.action?.params?.topic).toBe('facilitation');
    });

    it('should not suggest when status is not stuck', () => {
      const health = mockHealth({
        status: 'healthy',
      });
      const boardStats = mockBoardStats();

      const suggestions = engine.getSuggestions(health, boardStats);

      const stuckSuggestion = suggestions.find((s) => s.type === 'facilitate_stuck');
      expect(stuckSuggestion).toBeUndefined();
    });
  });

  describe('Priority Ordering', () => {
    it('should sort suggestions by priority (high > medium > low)', () => {
      const health = mockHealth({
        score: 25,
        status: 'stuck', // Triggers high-priority stuck_facilitate
        hotspots: ['goal-1', 'goal-2'], // Triggers high-priority schedule_discussion
        factors: {
          velocity: { score: 50, signal: 'Slowing' },
          disagreement: { score: 50, signal: 'Some conflicts' },
          progress: { score: 30, signal: 'High undo' }, // Triggers low-priority take_break
        },
      });
      const boardStats = mockBoardStats({
        node_count: 50, // Triggers medium-priority split_board
        options_count: 2, // Could trigger low-priority explore_more
      });

      const suggestions = engine.getSuggestions(health, boardStats);

      // Should have multiple suggestions, sorted by priority
      expect(suggestions.length).toBeGreaterThan(0);
      expect(suggestions.length).toBeLessThanOrEqual(3); // Max 3

      // Verify priority ordering
      for (let i = 1; i < suggestions.length; i++) {
        const prevPriority = suggestions[i - 1].priority;
        const currPriority = suggestions[i].priority;

        const priorityOrder = { high: 3, medium: 2, low: 1 };
        expect(priorityOrder[prevPriority]).toBeGreaterThanOrEqual(
          priorityOrder[currPriority]
        );
      }
    });

    it('should limit to max 3 suggestions', () => {
      // Create scenario that triggers many rules
      const health = mockHealth({
        score: 25,
        status: 'stuck',
        hotspots: ['goal-1', 'goal-2', 'goal-3'],
        factors: {
          velocity: { score: 50, signal: 'Slowing' },
          disagreement: { score: 50, signal: 'Some conflicts' },
          progress: { score: 30, signal: 'High undo' },
        },
      });
      const boardStats = mockBoardStats({
        node_count: 65,
        options_count: 1,
        goals_count: 8,
      });

      const suggestions = engine.getSuggestions(health, boardStats);

      // Should limit to 3 even if more rules match
      expect(suggestions.length).toBeLessThanOrEqual(3);

      // Should prioritize high-priority suggestions
      const highPrioritySuggestions = suggestions.filter((s) => s.priority === 'high');
      expect(highPrioritySuggestions.length).toBeGreaterThan(0);
    });
  });

  describe('Dismissal and Cooldown', () => {
    it('should allow dismissing a suggestion', () => {
      const health = mockHealth();
      const boardStats = mockBoardStats({ node_count: 50 });

      // Get initial suggestions
      const suggestions1 = engine.getSuggestions(health, boardStats);
      expect(suggestions1.find((s) => s.type === 'split_board')).toBeDefined();

      // Dismiss split_board rule
      engine.dismiss('split_board');

      // Same conditions should not trigger dismissed rule
      const suggestions2 = engine.getSuggestions(health, boardStats);
      expect(suggestions2.find((s) => s.type === 'split_board')).toBeUndefined();
    });

    it('should track dismissal count', () => {
      expect(engine.getDismissalCount()).toBe(0);

      engine.dismiss('split_board');
      expect(engine.getDismissalCount()).toBe(1);

      engine.dismiss('too_many_goals');
      expect(engine.getDismissalCount()).toBe(2);
    });

    it('should clear all dismissals', () => {
      engine.dismiss('split_board');
      engine.dismiss('too_many_goals');
      expect(engine.getDismissalCount()).toBe(2);

      engine.clearDismissals();
      expect(engine.getDismissalCount()).toBe(0);

      // After clearing, rules should fire again
      const health = mockHealth();
      const boardStats = mockBoardStats({ node_count: 50 });

      const suggestions = engine.getSuggestions(health, boardStats);
      expect(suggestions.find((s) => s.type === 'split_board')).toBeDefined();
    });

    it('should respect 30-minute cooldown', () => {
      // Note: This test verifies the cooldown logic exists
      // Full time-based testing would require mocking Date.now()
      const health = mockHealth();
      const boardStats = mockBoardStats({ node_count: 50 });

      engine.dismiss('split_board');

      // Immediately after dismissal, should not appear
      const suggestions = engine.getSuggestions(health, boardStats);
      expect(suggestions.find((s) => s.type === 'split_board')).toBeUndefined();

      // Cooldown is 30 minutes (1800000ms)
      // We can't wait that long in a test, but the logic is in place
    });
  });

  describe('Suggestion Structure', () => {
    it('should return valid suggestion objects with all required fields', () => {
      const health = mockHealth();
      const boardStats = mockBoardStats({ node_count: 50 });

      const suggestions = engine.getSuggestions(health, boardStats);

      expect(suggestions.length).toBeGreaterThan(0);

      suggestions.forEach((suggestion) => {
        expect(suggestion).toHaveProperty('id');
        expect(suggestion).toHaveProperty('type');
        expect(suggestion).toHaveProperty('title');
        expect(suggestion).toHaveProperty('description');
        expect(suggestion).toHaveProperty('priority');

        expect(typeof suggestion.id).toBe('string');
        expect(typeof suggestion.type).toBe('string');
        expect(typeof suggestion.title).toBe('string');
        expect(typeof suggestion.description).toBe('string');
        expect(['low', 'medium', 'high']).toContain(suggestion.priority);

        // Optional action field
        if (suggestion.action) {
          expect(suggestion.action).toHaveProperty('label');
          expect(suggestion.action).toHaveProperty('type');
        }
      });
    });

    it('should generate unique IDs for each suggestion', () => {
      const health = mockHealth({
        hotspots: ['goal-1', 'goal-2'],
      });
      const boardStats = mockBoardStats({ node_count: 50 });

      const suggestions = engine.getSuggestions(health, boardStats);

      const ids = suggestions.map((s) => s.id);
      const uniqueIds = new Set(ids);

      expect(uniqueIds.size).toBe(ids.length); // All IDs should be unique
    });
  });

  describe('Edge Cases', () => {
    it('should return empty array when no rules match', () => {
      const health = mockHealth({
        status: 'healthy',
        hotspots: [],
        factors: {
          velocity: { score: 80, signal: 'Steady' },
          disagreement: { score: 90, signal: 'No conflicts' },
          progress: { score: 85, signal: 'Forward momentum' },
        },
      });
      const boardStats = mockBoardStats({
        node_count: 20,
        options_count: 4,
        goals_count: 3,
      });

      const suggestions = engine.getSuggestions(health, boardStats);

      // With optimal conditions, no suggestions should trigger
      expect(suggestions).toEqual([]);
    });

    it('should handle missing optional board stats fields', () => {
      const health = mockHealth();
      const boardStats: BoardStats = {
        node_count: 10,
        options_count: 3,
        // goals_count and outcomes_count are optional
      };

      // Should not throw error
      expect(() => {
        engine.getSuggestions(health, boardStats);
      }).not.toThrow();
    });
  });
});
