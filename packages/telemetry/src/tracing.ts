/**
 * Distributed Tracing Helpers
 * Provides correlation ID management and trace context propagation
 */

import { randomUUID } from 'crypto';

/**
 * Generate a unique correlation ID
 */
export function generateCorrelationId(): string {
  return randomUUID();
}

/**
 * Trace context for distributed tracing
 */
export interface TraceContext {
  correlation_id: string;
  parent_span_id?: string;
  trace_id?: string;
  user_id?: string;
  org_id?: string;
}

/**
 * Extract trace context from HTTP headers
 */
export function extractTraceContext(headers: Record<string, string | string[] | undefined>): Partial<TraceContext> {
  const correlationId = getHeader(headers, 'x-correlation-id') || getHeader(headers, 'x-request-id');
  const traceId = getHeader(headers, 'x-trace-id');
  const parentSpanId = getHeader(headers, 'x-parent-span-id');
  const userId = getHeader(headers, 'x-user-id');
  const orgId = getHeader(headers, 'x-org-id');

  return {
    correlation_id: correlationId || generateCorrelationId(),
    trace_id: traceId,
    parent_span_id: parentSpanId,
    user_id: userId,
    org_id: orgId,
  };
}

/**
 * Inject trace context into HTTP headers
 */
export function injectTraceContext(context: TraceContext): Record<string, string> {
  const headers: Record<string, string> = {
    'x-correlation-id': context.correlation_id,
  };

  if (context.trace_id) {
    headers['x-trace-id'] = context.trace_id;
  }

  if (context.parent_span_id) {
    headers['x-parent-span-id'] = context.parent_span_id;
  }

  if (context.user_id) {
    headers['x-user-id'] = context.user_id;
  }

  if (context.org_id) {
    headers['x-org-id'] = context.org_id;
  }

  return headers;
}

/**
 * Helper to get header value (handles string | string[])
 */
function getHeader(headers: Record<string, string | string[] | undefined>, name: string): string | undefined {
  const value = headers[name.toLowerCase()] || headers[name];
  if (Array.isArray(value)) {
    return value[0];
  }
  return value;
}

/**
 * Async local storage for trace context (Node.js 14+)
 */
import { AsyncLocalStorage } from 'async_hooks';

export const traceContextStorage = new AsyncLocalStorage<TraceContext>();

/**
 * Run a function with trace context
 */
export function runWithTraceContext<T>(
  context: TraceContext,
  fn: () => T
): T {
  return traceContextStorage.run(context, fn);
}

/**
 * Get current trace context
 */
export function getCurrentTraceContext(): TraceContext | undefined {
  return traceContextStorage.getStore();
}

/**
 * Measure execution time of an async function
 */
export async function measureAsync<T>(
  fn: () => Promise<T>
): Promise<{ result: T; duration: number }> {
  const start = Date.now();
  const result = await fn();
  const duration = (Date.now() - start) / 1000; // Convert to seconds
  return { result, duration };
}

/**
 * Measure execution time of a sync function
 */
export function measure<T>(
  fn: () => T
): { result: T; duration: number } {
  const start = Date.now();
  const result = fn();
  const duration = (Date.now() - start) / 1000; // Convert to seconds
  return { result, duration };
}
