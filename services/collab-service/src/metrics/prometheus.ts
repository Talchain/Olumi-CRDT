/**
 * Prometheus Metrics for Olumi Collaboration Service
 *
 * Comprehensive observability with:
 * - HTTP request/response metrics
 * - WebSocket connection metrics
 * - Business logic metrics (reviews, snapshots, etc.)
 * - System health metrics
 *
 * NOTE: Install prom-client dependency: npm install prom-client@^15.1.0
 */

// Simple in-memory metrics until prom-client is installed
// This provides the same interface so integration code works

export interface MetricsRegistry {
  httpRequestDuration: Histogram;
  httpRequestsTotal: Counter;
  websocketConnectionsTotal: Gauge;
  websocketMessagesTotal: Counter;
  reviewsCreatedTotal: Counter;
  reviewsCompletedTotal: Counter;
  snapshotsCreatedTotal: Counter;
  activeCollaborators: Gauge;
  databaseQueryDuration: Histogram;
  eventBusPublishTotal: Counter;
}

interface Histogram {
  observe(value: number): void;
  observe(labels: Record<string, string>, value: number): void;
}

interface Counter {
  inc(value?: number): void;
  inc(labels: Record<string, string>, value?: number): void;
}

interface Gauge {
  set(value: number): void;
  set(labels: Record<string, string>, value: number): void;
  inc(value?: number): void;
  inc(labels: Record<string, string>, value?: number): void;
  dec(value?: number): void;
  dec(labels: Record<string, string>, value?: number): void;
}

class SimpleHistogram implements Histogram {
  private name: string;
  private help: string;
  private values: number[] = [];

  constructor(name: string, help: string) {
    this.name = name;
    this.help = help;
  }

  observe(labelsOrValue: Record<string, string> | number, value?: number): void {
    const v = typeof labelsOrValue === 'number' ? labelsOrValue : value!;
    this.values.push(v);
    // Keep only last 1000 values
    if (this.values.length > 1000) {
      this.values.shift();
    }
  }

  getMetrics(): string {
    if (this.values.length === 0) return '';
    const sorted = [...this.values].sort((a, b) => a - b);
    const p50 = sorted[Math.floor(sorted.length * 0.5)];
    const p95 = sorted[Math.floor(sorted.length * 0.95)];
    const p99 = sorted[Math.floor(sorted.length * 0.99)];
    const sum = sorted.reduce((a, b) => a + b, 0);
    const count = sorted.length;

    return `# HELP ${this.name} ${this.help}
# TYPE ${this.name} histogram
${this.name}_sum ${sum.toFixed(3)}
${this.name}_count ${count}
${this.name}_bucket{le="0.01"} ${sorted.filter(v => v <= 0.01).length}
${this.name}_bucket{le="0.05"} ${sorted.filter(v => v <= 0.05).length}
${this.name}_bucket{le="0.1"} ${sorted.filter(v => v <= 0.1).length}
${this.name}_bucket{le="0.5"} ${sorted.filter(v => v <= 0.5).length}
${this.name}_bucket{le="1"} ${sorted.filter(v => v <= 1).length}
${this.name}_bucket{le="5"} ${sorted.filter(v => v <= 5).length}
${this.name}_bucket{le="+Inf"} ${count}
# P50: ${p50.toFixed(3)}s, P95: ${p95.toFixed(3)}s, P99: ${p99.toFixed(3)}s
`;
  }
}

class SimpleCounter implements Counter {
  private name: string;
  private help: string;
  private value = 0;
  private labeledValues = new Map<string, number>();

  constructor(name: string, help: string) {
    this.name = name;
    this.help = help;
  }

  inc(labelsOrValue?: Record<string, string> | number, value?: number): void {
    if (typeof labelsOrValue === 'number') {
      this.value += labelsOrValue;
    } else if (labelsOrValue) {
      const key = JSON.stringify(labelsOrValue);
      const current = this.labeledValues.get(key) || 0;
      this.labeledValues.set(key, current + (value || 1));
    } else {
      this.value += 1;
    }
  }

  getMetrics(): string {
    let output = `# HELP ${this.name} ${this.help}\n`;
    output += `# TYPE ${this.name} counter\n`;
    output += `${this.name}_total ${this.value}\n`;

    for (const [key, val] of this.labeledValues) {
      const labels = JSON.parse(key);
      const labelStr = Object.entries(labels)
        .map(([k, v]) => `${k}="${v}"`)
        .join(',');
      output += `${this.name}_total{${labelStr}} ${val}\n`;
    }

    return output;
  }
}

class SimpleGauge implements Gauge {
  private name: string;
  private help: string;
  private value = 0;
  private labeledValues = new Map<string, number>();

  constructor(name: string, help: string) {
    this.name = name;
    this.help = help;
  }

  set(labelsOrValue: Record<string, string> | number, value?: number): void {
    if (typeof labelsOrValue === 'number') {
      this.value = labelsOrValue;
    } else {
      const key = JSON.stringify(labelsOrValue);
      this.labeledValues.set(key, value!);
    }
  }

  inc(labelsOrValue?: Record<string, string> | number, value?: number): void {
    if (typeof labelsOrValue === 'number') {
      this.value += labelsOrValue;
    } else if (labelsOrValue) {
      const key = JSON.stringify(labelsOrValue);
      const current = this.labeledValues.get(key) || 0;
      this.labeledValues.set(key, current + (value || 1));
    } else {
      this.value += 1;
    }
  }

  dec(labelsOrValue?: Record<string, string> | number, value?: number): void {
    if (typeof labelsOrValue === 'number') {
      this.value -= labelsOrValue;
    } else if (labelsOrValue) {
      const key = JSON.stringify(labelsOrValue);
      const current = this.labeledValues.get(key) || 0;
      this.labeledValues.set(key, current - (value || 1));
    } else {
      this.value -= 1;
    }
  }

  getMetrics(): string {
    let output = `# HELP ${this.name} ${this.help}\n`;
    output += `# TYPE ${this.name} gauge\n`;
    output += `${this.name} ${this.value}\n`;

    for (const [key, val] of this.labeledValues) {
      const labels = JSON.parse(key);
      const labelStr = Object.entries(labels)
        .map(([k, v]) => `${k}="${v}"`)
        .join(',');
      output += `${this.name}{${labelStr}} ${val}\n`;
    }

    return output;
  }
}

/**
 * Create metrics registry
 */
export function createMetricsRegistry(): MetricsRegistry {
  return {
    // HTTP Metrics
    httpRequestDuration: new SimpleHistogram(
      'http_request_duration_seconds',
      'Duration of HTTP requests in seconds'
    ),
    httpRequestsTotal: new SimpleCounter(
      'http_requests',
      'Total number of HTTP requests'
    ),

    // WebSocket Metrics
    websocketConnectionsTotal: new SimpleGauge(
      'websocket_connections_total',
      'Current number of WebSocket connections'
    ),
    websocketMessagesTotal: new SimpleCounter(
      'websocket_messages',
      'Total number of WebSocket messages'
    ),

    // Business Metrics
    reviewsCreatedTotal: new SimpleCounter(
      'reviews_created',
      'Total number of review requests created'
    ),
    reviewsCompletedTotal: new SimpleCounter(
      'reviews_completed',
      'Total number of reviews completed'
    ),
    snapshotsCreatedTotal: new SimpleCounter(
      'snapshots_created',
      'Total number of snapshots created'
    ),
    activeCollaborators: new SimpleGauge(
      'active_collaborators',
      'Number of users actively collaborating on boards'
    ),

    // Infrastructure Metrics
    databaseQueryDuration: new SimpleHistogram(
      'database_query_duration_seconds',
      'Duration of database queries in seconds'
    ),
    eventBusPublishTotal: new SimpleCounter(
      'event_bus_publish',
      'Total number of events published to event bus'
    ),
  };
}

/**
 * Export metrics in Prometheus format
 */
export function getMetricsText(registry: MetricsRegistry): string {
  const metrics = Object.values(registry);
  return metrics
    .map((metric: any) => {
      if (typeof metric.getMetrics === 'function') {
        return metric.getMetrics();
      }
      return '';
    })
    .join('\n');
}

/**
 * HTTP middleware to track request metrics
 */
export function createMetricsMiddleware(registry: MetricsRegistry) {
  return async (request: any, reply: any) => {
    const start = Date.now();
    const { method, url } = request;

    // Track request
    registry.httpRequestsTotal.inc({
      method,
      route: url.split('?')[0], // Remove query params
    });

    // Track duration on response
    reply.addHook('onSend', async () => {
      const duration = (Date.now() - start) / 1000;
      registry.httpRequestDuration.observe(
        {
          method,
          route: url.split('?')[0],
          status: reply.statusCode.toString(),
        },
        duration
      );
    });
  };
}

/**
 * WebSocket instrumentation helpers
 */
export class WebSocketMetrics {
  constructor(private registry: MetricsRegistry) {}

  onConnect(boardId: string): void {
    this.registry.websocketConnectionsTotal.inc({ board_id: boardId });
  }

  onDisconnect(boardId: string): void {
    this.registry.websocketConnectionsTotal.dec({ board_id: boardId });
  }

  onMessage(boardId: string, messageType: string): void {
    this.registry.websocketMessagesTotal.inc({
      board_id: boardId,
      type: messageType,
    });
  }
}

/**
 * Business metrics helpers
 */
export class BusinessMetrics {
  constructor(private registry: MetricsRegistry) {}

  onReviewCreated(boardId: string): void {
    this.registry.reviewsCreatedTotal.inc({ board_id: boardId });
  }

  onReviewCompleted(boardId: string, outcome: string): void {
    this.registry.reviewsCompletedTotal.inc({
      board_id: boardId,
      outcome,
    });
  }

  onSnapshotCreated(boardId: string): void {
    this.registry.snapshotsCreatedTotal.inc({ board_id: boardId });
  }

  setActiveCollaborators(boardId: string, count: number): void {
    this.registry.activeCollaborators.set({ board_id: boardId }, count);
  }
}

/**
 * Database instrumentation helper
 */
export function trackDatabaseQuery<T>(
  registry: MetricsRegistry,
  operation: string,
  fn: () => Promise<T>
): Promise<T> {
  const start = Date.now();
  return fn().finally(() => {
    const duration = (Date.now() - start) / 1000;
    registry.databaseQueryDuration.observe({ operation }, duration);
  });
}
