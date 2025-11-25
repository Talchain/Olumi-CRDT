/**
 * Smart Facilitation Module Exports (K.1-K.2)
 *
 * Global instances for session health tracking and process suggestions
 */

export { MetricsCollector, SessionMetrics, EditRecord } from './session-metrics';
export { HealthCalculator, SessionHealth, HealthFactor } from './health-calculator';
export { SuggestionEngine, ProcessSuggestion, BoardStats } from './suggestion-engine';

// Global metrics collector instance (shared across all boards)
import { MetricsCollector } from './session-metrics';
export const metricsCollector = new MetricsCollector();
