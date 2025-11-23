/**
 * Metrics collector for collaboration service
 *
 * Provides comprehensive metrics for:
 * - Connection health
 * - Message rates
 * - Latency tracking
 * - Resource utilization
 */

import { pino } from 'pino';
import { config } from '../config';

const logger = pino({ level: config.logging.level });

export interface MetricLabels {
  boardId?: string;
  orgId?: string;
  teamId?: string;
  userId?: string;
  operation?: string;
  status?: 'success' | 'failure' | 'timeout';
}

export interface LatencyMetric {
  operation: string;
  durationMs: number;
  labels: MetricLabels;
  timestamp: number;
}

export interface CounterMetric {
  name: string;
  value: number;
  labels: MetricLabels;
  timestamp: number;
}

export interface GaugeMetric {
  name: string;
  value: number;
  labels: MetricLabels;
  timestamp: number;
}

/**
 * In-memory metrics storage with time-series capability
 */
class MetricsStore {
  private latencies: Map<string, LatencyMetric[]> = new Map();
  private counters: Map<string, number> = new Map();
  private gauges: Map<string, GaugeMetric> = new Map();
  private maxSamples: number = 1000; // Keep last 1000 samples per metric

  recordLatency(metric: LatencyMetric): void {
    const key = this.getKey(metric.operation, metric.labels);

    if (!this.latencies.has(key)) {
      this.latencies.set(key, []);
    }

    const samples = this.latencies.get(key)!;
    samples.push(metric);

    // Keep only recent samples
    if (samples.length > this.maxSamples) {
      samples.shift();
    }
  }

  incrementCounter(name: string, labels: MetricLabels, value: number = 1): void {
    const key = this.getKey(name, labels);
    const current = this.counters.get(key) || 0;
    this.counters.set(key, current + value);
  }

  setGauge(name: string, value: number, labels: MetricLabels): void {
    const key = this.getKey(name, labels);
    this.gauges.set(key, {
      name,
      value,
      labels,
      timestamp: Date.now(),
    });
  }

  getLatencyPercentile(operation: string, labels: MetricLabels, percentile: number): number | null {
    const key = this.getKey(operation, labels);
    const samples = this.latencies.get(key);

    if (!samples || samples.length === 0) {
      return null;
    }

    const sorted = samples.map(s => s.durationMs).sort((a, b) => a - b);
    const index = Math.ceil((percentile / 100) * sorted.length) - 1;
    return sorted[Math.max(0, index)];
  }

  getCounter(name: string, labels: MetricLabels): number {
    const key = this.getKey(name, labels);
    return this.counters.get(key) || 0;
  }

  getGauge(name: string, labels: MetricLabels): number | null {
    const key = this.getKey(name, labels);
    const gauge = this.gauges.get(key);
    return gauge ? gauge.value : null;
  }

  getAllMetrics(): {
    latencies: Map<string, LatencyMetric[]>;
    counters: Map<string, number>;
    gauges: Map<string, GaugeMetric>;
  } {
    return {
      latencies: this.latencies,
      counters: this.counters,
      gauges: this.gauges,
    };
  }

  private getKey(name: string, labels: MetricLabels): string {
    const labelParts = Object.entries(labels)
      .filter(([_, value]) => value !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => `${key}:${value}`)
      .join(',');

    return labelParts ? `${name}{${labelParts}}` : name;
  }

  reset(): void {
    this.latencies.clear();
    this.counters.clear();
    this.gauges.clear();
  }
}

/**
 * Global metrics collector singleton
 */
export class MetricsCollector {
  private store: MetricsStore;
  private static instance: MetricsCollector;

  private constructor() {
    this.store = new MetricsStore();
  }

  static getInstance(): MetricsCollector {
    if (!MetricsCollector.instance) {
      MetricsCollector.instance = new MetricsCollector();
    }
    return MetricsCollector.instance;
  }

  /**
   * Record latency for an operation
   */
  recordLatency(operation: string, durationMs: number, labels: MetricLabels = {}): void {
    this.store.recordLatency({
      operation,
      durationMs,
      labels,
      timestamp: Date.now(),
    });

    // Log high latencies
    if (durationMs > 1000) {
      logger.warn(
        { operation, durationMs, labels },
        'High latency detected'
      );
    }
  }

  /**
   * Increment a counter
   */
  incrementCounter(name: string, labels: MetricLabels = {}, value: number = 1): void {
    this.store.incrementCounter(name, labels, value);
  }

  /**
   * Set a gauge value
   */
  setGauge(name: string, value: number, labels: MetricLabels = {}): void {
    this.store.setGauge(name, value, labels);
  }

  /**
   * Get percentile for latency metric
   */
  getLatencyPercentile(operation: string, percentile: number, labels: MetricLabels = {}): number | null {
    return this.store.getLatencyPercentile(operation, labels, percentile);
  }

  /**
   * Get counter value
   */
  getCounter(name: string, labels: MetricLabels = {}): number {
    return this.store.getCounter(name, labels);
  }

  /**
   * Get gauge value
   */
  getGauge(name: string, labels: MetricLabels = {}): number | null {
    return this.store.getGauge(name, labels);
  }

  /**
   * Get all metrics
   */
  getAllMetrics() {
    return this.store.getAllMetrics();
  }

  /**
   * Get metrics summary for monitoring
   */
  getMetricsSummary(): {
    latencies: { [key: string]: { p50: number; p95: number; p99: number } };
    counters: { [key: string]: number };
    gauges: { [key: string]: number };
  } {
    const all = this.store.getAllMetrics();
    const summary: any = {
      latencies: {},
      counters: {},
      gauges: {},
    };

    // Summarize latencies
    for (const [key] of all.latencies) {
      const parts = key.split('{');
      const operation = parts[0];
      const labels = parts[1] ? this.parseLabels(parts[1].slice(0, -1)) : {};

      const p50 = this.store.getLatencyPercentile(operation, labels, 50) || 0;
      const p95 = this.store.getLatencyPercentile(operation, labels, 95) || 0;
      const p99 = this.store.getLatencyPercentile(operation, labels, 99) || 0;

      summary.latencies[key] = { p50, p95, p99 };
    }

    // Copy counters
    for (const [key, value] of all.counters) {
      summary.counters[key] = value;
    }

    // Copy gauges
    for (const [key, gauge] of all.gauges) {
      summary.gauges[key] = gauge.value;
    }

    return summary;
  }

  /**
   * Reset all metrics
   */
  reset(): void {
    this.store.reset();
  }

  private parseLabels(labelStr: string): MetricLabels {
    const labels: MetricLabels = {};
    const pairs = labelStr.split(',');

    for (const pair of pairs) {
      const [key, value] = pair.split(':');
      if (key && value) {
        labels[key as keyof MetricLabels] = value;
      }
    }

    return labels;
  }
}

/**
 * Convenience function to get metrics collector instance
 */
export function getMetrics(): MetricsCollector {
  return MetricsCollector.getInstance();
}

/**
 * Timer utility for measuring operation duration
 */
export class MetricsTimer {
  private startTime: number;

  constructor(private operation: string, private labels: MetricLabels = {}) {
    this.startTime = Date.now();
  }

  /**
   * Stop timer and record latency
   */
  stop(): number {
    const durationMs = Date.now() - this.startTime;
    getMetrics().recordLatency(this.operation, durationMs, this.labels);
    return durationMs;
  }
}

/**
 * Decorator for measuring function execution time
 */
export function measureLatency(operation: string, labels: MetricLabels = {}) {
  return function (
    target: any,
    propertyKey: string,
    descriptor: PropertyDescriptor
  ) {
    const originalMethod = descriptor.value;

    descriptor.value = async function (...args: any[]) {
      const timer = new MetricsTimer(operation, labels);
      try {
        const result = await originalMethod.apply(this, args);
        timer.stop();
        return result;
      } catch (error) {
        timer.stop();
        throw error;
      }
    };

    return descriptor;
  };
}
