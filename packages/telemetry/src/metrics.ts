/**
 * Prometheus Metrics Helpers
 * Provides standardized metrics collection for all services
 */

import * as promClient from 'prom-client';

// Initialize default metrics (CPU, memory, etc.)
promClient.collectDefaultMetrics();

/**
 * Metrics Registry
 */
export const metricsRegistry = promClient.register;

/**
 * Create a counter metric
 */
export function createCounter(config: {
  name: string;
  help: string;
  labelNames?: string[];
}): promClient.Counter {
  return new promClient.Counter({
    name: config.name,
    help: config.help,
    labelNames: config.labelNames || [],
    registers: [metricsRegistry],
  });
}

/**
 * Create a gauge metric
 */
export function createGauge(config: {
  name: string;
  help: string;
  labelNames?: string[];
}): promClient.Gauge {
  return new promClient.Gauge({
    name: config.name,
    help: config.help,
    labelNames: config.labelNames || [],
    registers: [metricsRegistry],
  });
}

/**
 * Create a histogram metric
 */
export function createHistogram(config: {
  name: string;
  help: string;
  labelNames?: string[];
  buckets?: number[];
}): promClient.Histogram {
  return new promClient.Histogram({
    name: config.name,
    help: config.help,
    labelNames: config.labelNames || [],
    buckets: config.buckets || [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 5, 10],
    registers: [metricsRegistry],
  });
}

/**
 * Create a summary metric
 */
export function createSummary(config: {
  name: string;
  help: string;
  labelNames?: string[];
  percentiles?: number[];
}): promClient.Summary {
  return new promClient.Summary({
    name: config.name,
    help: config.help,
    labelNames: config.labelNames || [],
    percentiles: config.percentiles || [0.5, 0.9, 0.95, 0.99],
    registers: [metricsRegistry],
  });
}

/**
 * Get metrics in Prometheus format
 */
export async function getMetrics(): Promise<string> {
  return metricsRegistry.metrics();
}

/**
 * Clear all metrics (useful for testing)
 */
export function clearMetrics(): void {
  metricsRegistry.clear();
}

/**
 * Standard service metrics
 */
export class ServiceMetrics {
  // HTTP metrics
  public httpRequestsTotal: promClient.Counter;
  public httpRequestDuration: promClient.Histogram;
  public httpRequestsInFlight: promClient.Gauge;

  // Error metrics
  public errorsTotal: promClient.Counter;

  // Business metrics (generic)
  public operationsTotal: promClient.Counter;
  public operationDuration: promClient.Histogram;

  constructor(serviceName: string) {
    this.httpRequestsTotal = createCounter({
      name: `${serviceName}_http_requests_total`,
      help: 'Total number of HTTP requests',
      labelNames: ['method', 'path', 'status_code'],
    });

    this.httpRequestDuration = createHistogram({
      name: `${serviceName}_http_request_duration_seconds`,
      help: 'HTTP request duration in seconds',
      labelNames: ['method', 'path'],
      buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 5, 10],
    });

    this.httpRequestsInFlight = createGauge({
      name: `${serviceName}_http_requests_in_flight`,
      help: 'Current number of HTTP requests being processed',
    });

    this.errorsTotal = createCounter({
      name: `${serviceName}_errors_total`,
      help: 'Total number of errors',
      labelNames: ['error_type', 'operation'],
    });

    this.operationsTotal = createCounter({
      name: `${serviceName}_operations_total`,
      help: 'Total number of operations',
      labelNames: ['operation', 'status'],
    });

    this.operationDuration = createHistogram({
      name: `${serviceName}_operation_duration_seconds`,
      help: 'Operation duration in seconds',
      labelNames: ['operation'],
      buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 5, 10],
    });
  }

  /**
   * Track HTTP request
   */
  trackHttpRequest(
    method: string,
    path: string,
    statusCode: number,
    duration: number
  ): void {
    this.httpRequestsTotal.inc({ method, path, status_code: statusCode });
    this.httpRequestDuration.observe({ method, path }, duration);
  }

  /**
   * Track error
   */
  trackError(errorType: string, operation: string): void {
    this.errorsTotal.inc({ error_type: errorType, operation });
  }

  /**
   * Track operation
   */
  trackOperation(operation: string, status: 'success' | 'failure', duration: number): void {
    this.operationsTotal.inc({ operation, status });
    this.operationDuration.observe({ operation }, duration);
  }

  /**
   * Increment in-flight requests
   */
  incrementInFlight(): void {
    this.httpRequestsInFlight.inc();
  }

  /**
   * Decrement in-flight requests
   */
  decrementInFlight(): void {
    this.httpRequestsInFlight.dec();
  }
}
