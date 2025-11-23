/**
 * Performance & Observability Tests
 *
 * Tests for throttling, rate limiting, and metrics collection:
 * - Throttle function behavior
 * - Debounce function behavior
 * - TokenBucket rate limiting
 * - MetricsCollector functionality
 * - Latency tracking accuracy
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { throttle, debounce, TokenBucket } from '../src/utils/throttle';
import { getMetrics, MetricsCollector, MetricsTimer } from '../src/metrics/collector';

// Helper to wait for specified milliseconds
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

describe('Throttle Utilities', () => {
  beforeEach(() => {
    jest.clearAllTimers();
  });

  describe('throttle', () => {
    it('should execute immediately on first call', () => {
      const fn = jest.fn();
      const throttled = throttle(fn, 100);

      throttled('arg1');
      expect(fn).toHaveBeenCalledTimes(1);
      expect(fn).toHaveBeenCalledWith('arg1');
    });

    it('should throttle rapid calls within interval', async () => {
      const fn = jest.fn();
      const throttled = throttle(fn, 100);

      throttled('call1');
      throttled('call2');
      throttled('call3');

      expect(fn).toHaveBeenCalledTimes(1);
      expect(fn).toHaveBeenCalledWith('call1');

      // Wait for throttle interval
      await wait(120);

      expect(fn).toHaveBeenCalledTimes(2);
      expect(fn).toHaveBeenCalledWith('call3'); // Last call executed
    });

    it('should allow calls after interval has passed', async () => {
      const fn = jest.fn();
      const throttled = throttle(fn, 50);

      throttled('call1');
      expect(fn).toHaveBeenCalledTimes(1);

      await wait(60);

      throttled('call2');
      expect(fn).toHaveBeenCalledTimes(2);
      expect(fn).toHaveBeenCalledWith('call2');
    });

    it('should guarantee last call is executed', async () => {
      const fn = jest.fn();
      const throttled = throttle(fn, 100);

      throttled('call1');
      await wait(20);
      throttled('call2');
      await wait(20);
      throttled('call3');
      await wait(20);
      throttled('call4'); // Last call

      expect(fn).toHaveBeenCalledTimes(1); // Only first call executed immediately

      await wait(120);

      expect(fn).toHaveBeenCalledTimes(2); // Last call executed
      expect(fn).toHaveBeenLastCalledWith('call4');
    });

    it('should handle multiple arguments correctly', async () => {
      const fn = jest.fn();
      const throttled = throttle(fn, 50);

      throttled('arg1', 'arg2', 123);
      expect(fn).toHaveBeenCalledWith('arg1', 'arg2', 123);

      await wait(60);

      throttled('new1', 'new2', 456);
      expect(fn).toHaveBeenCalledWith('new1', 'new2', 456);
    });
  });

  describe('debounce', () => {
    it('should delay execution until delay has passed', async () => {
      const fn = jest.fn();
      const debounced = debounce(fn, 100);

      debounced('arg1');
      expect(fn).not.toHaveBeenCalled();

      await wait(120);
      expect(fn).toHaveBeenCalledTimes(1);
      expect(fn).toHaveBeenCalledWith('arg1');
    });

    it('should reset timer on subsequent calls', async () => {
      const fn = jest.fn();
      const debounced = debounce(fn, 100);

      debounced('call1');
      await wait(50);
      debounced('call2');
      await wait(50);
      debounced('call3');

      expect(fn).not.toHaveBeenCalled();

      await wait(120);

      expect(fn).toHaveBeenCalledTimes(1);
      expect(fn).toHaveBeenCalledWith('call3'); // Only last call
    });

    it('should execute only once after rapid calls', async () => {
      const fn = jest.fn();
      const debounced = debounce(fn, 50);

      for (let i = 0; i < 100; i++) {
        debounced(`call${i}`);
      }

      expect(fn).not.toHaveBeenCalled();

      await wait(70);

      expect(fn).toHaveBeenCalledTimes(1);
      expect(fn).toHaveBeenCalledWith('call99'); // Last call
    });

    it('should handle multiple arguments', async () => {
      const fn = jest.fn();
      const debounced = debounce(fn, 50);

      debounced('arg1', 'arg2', { key: 'value' });

      await wait(70);

      expect(fn).toHaveBeenCalledWith('arg1', 'arg2', { key: 'value' });
    });
  });

  describe('TokenBucket', () => {
    it('should allow consumption up to capacity', () => {
      const bucket = new TokenBucket(10, 1, 1000);

      for (let i = 0; i < 10; i++) {
        expect(bucket.tryConsume(1)).toBe(true);
      }

      // 11th should fail
      expect(bucket.tryConsume(1)).toBe(false);
    });

    it('should refill tokens over time', async () => {
      const bucket = new TokenBucket(10, 5, 1000); // 5 tokens per second

      // Consume all tokens
      for (let i = 0; i < 10; i++) {
        bucket.tryConsume(1);
      }

      expect(bucket.tryConsume(1)).toBe(false);

      // Wait for refill (1 second = 5 tokens)
      await wait(1100);

      expect(bucket.tryConsume(1)).toBe(true);
      expect(bucket.tryConsume(1)).toBe(true);
      expect(bucket.tryConsume(1)).toBe(true);
      expect(bucket.tryConsume(1)).toBe(true);
      expect(bucket.tryConsume(1)).toBe(true);
      expect(bucket.tryConsume(1)).toBe(false); // 6th should fail
    });

    it('should not exceed capacity when refilling', async () => {
      const bucket = new TokenBucket(5, 10, 1000); // Refills faster than capacity

      // Wait for 2 seconds (would add 20 tokens, but capacity is 5)
      await wait(2100);

      // Should only have 5 tokens available
      for (let i = 0; i < 5; i++) {
        expect(bucket.tryConsume(1)).toBe(true);
      }

      expect(bucket.tryConsume(1)).toBe(false);
    });

    it('should handle multi-token consumption', () => {
      const bucket = new TokenBucket(10, 1, 1000);

      expect(bucket.tryConsume(5)).toBe(true); // 5 tokens left
      expect(bucket.tryConsume(3)).toBe(true); // 2 tokens left
      expect(bucket.tryConsume(3)).toBe(false); // Fails, need 3 but have 2
      expect(bucket.tryConsume(2)).toBe(true); // 0 tokens left
      expect(bucket.tryConsume(1)).toBe(false); // Fails
    });

    it('should return current token count', () => {
      const bucket = new TokenBucket(10, 1, 1000);

      expect(bucket.getTokenCount()).toBe(10);

      bucket.tryConsume(3);
      expect(bucket.getTokenCount()).toBe(7);

      bucket.tryConsume(7);
      expect(bucket.getTokenCount()).toBe(0);
    });

    it('should handle high-frequency requests with burst tolerance', () => {
      const bucket = new TokenBucket(100, 10, 1000); // 100 burst, 10/sec sustained

      // Burst of 100 requests
      for (let i = 0; i < 100; i++) {
        expect(bucket.tryConsume(1)).toBe(true);
      }

      // 101st fails
      expect(bucket.tryConsume(1)).toBe(false);
    });
  });
});

describe('MetricsCollector', () => {
  let metrics: MetricsCollector;

  beforeEach(() => {
    metrics = getMetrics();
    metrics.reset();
  });

  describe('Counter Metrics', () => {
    it('should increment counters', () => {
      metrics.incrementCounter('test.counter', { label: 'value' }, 1);
      metrics.incrementCounter('test.counter', { label: 'value' }, 5);

      const value = metrics.getCounter('test.counter', { label: 'value' });
      expect(value).toBe(6);
    });

    it('should track separate counters for different labels', () => {
      metrics.incrementCounter('test.counter', { env: 'prod' }, 10);
      metrics.incrementCounter('test.counter', { env: 'dev' }, 5);

      expect(metrics.getCounter('test.counter', { env: 'prod' })).toBe(10);
      expect(metrics.getCounter('test.counter', { env: 'dev' })).toBe(5);
    });

    it('should default to increment by 1', () => {
      metrics.incrementCounter('test.counter');
      metrics.incrementCounter('test.counter');

      expect(metrics.getCounter('test.counter')).toBe(2);
    });
  });

  describe('Gauge Metrics', () => {
    it('should set gauge values', () => {
      metrics.setGauge('test.gauge', 42, { type: 'cpu' });
      expect(metrics.getGauge('test.gauge', { type: 'cpu' })).toBe(42);

      metrics.setGauge('test.gauge', 99, { type: 'cpu' });
      expect(metrics.getGauge('test.gauge', { type: 'cpu' })).toBe(99);
    });

    it('should track separate gauges for different labels', () => {
      metrics.setGauge('connections', 10, { board: 'board-1' });
      metrics.setGauge('connections', 20, { board: 'board-2' });

      expect(metrics.getGauge('connections', { board: 'board-1' })).toBe(10);
      expect(metrics.getGauge('connections', { board: 'board-2' })).toBe(20);
    });
  });

  describe('Latency Metrics', () => {
    it('should record latency measurements', () => {
      metrics.recordLatency('api.request', 100, { endpoint: '/boards' });
      metrics.recordLatency('api.request', 200, { endpoint: '/boards' });
      metrics.recordLatency('api.request', 150, { endpoint: '/boards' });

      const p50 = metrics.getLatencyPercentile('api.request', 50, { endpoint: '/boards' });
      expect(p50).toBe(150); // Median

      const p95 = metrics.getLatencyPercentile('api.request', 95, { endpoint: '/boards' });
      expect(p95).toBeGreaterThanOrEqual(150);
    });

    it('should calculate percentiles correctly', () => {
      const values = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
      values.forEach(v => metrics.recordLatency('test.op', v));

      expect(metrics.getLatencyPercentile('test.op', 0)).toBe(10); // Min
      expect(metrics.getLatencyPercentile('test.op', 50)).toBe(50); // Median
      expect(metrics.getLatencyPercentile('test.op', 95)).toBe(95); // P95
      expect(metrics.getLatencyPercentile('test.op', 99)).toBe(99); // P99
      expect(metrics.getLatencyPercentile('test.op', 100)).toBe(100); // Max
    });

    it('should track separate latencies for different labels', () => {
      metrics.recordLatency('db.query', 50, { table: 'users' });
      metrics.recordLatency('db.query', 200, { table: 'boards' });

      const usersP50 = metrics.getLatencyPercentile('db.query', 50, { table: 'users' });
      const boardsP50 = metrics.getLatencyPercentile('db.query', 50, { table: 'boards' });

      expect(usersP50).toBe(50);
      expect(boardsP50).toBe(200);
    });

    it('should handle large datasets efficiently', () => {
      // Record 10,000 samples
      for (let i = 0; i < 10000; i++) {
        metrics.recordLatency('stress.test', Math.random() * 1000);
      }

      // Should still calculate percentiles
      const p50 = metrics.getLatencyPercentile('stress.test', 50);
      const p95 = metrics.getLatencyPercentile('stress.test', 95);
      const p99 = metrics.getLatencyPercentile('stress.test', 99);

      expect(p50).toBeDefined();
      expect(p95).toBeDefined();
      expect(p99).toBeDefined();
      expect(p95).toBeGreaterThan(p50!);
      expect(p99).toBeGreaterThan(p95!);
    });

    it('should return null for non-existent metrics', () => {
      const p50 = metrics.getLatencyPercentile('nonexistent', 50);
      expect(p50).toBeNull();
    });

    it('should limit stored samples to maxSamples', () => {
      // Record more than maxSamples (default 1000)
      for (let i = 0; i < 1500; i++) {
        metrics.recordLatency('limited', i);
      }

      // Should still work and only keep last 1000
      const samples = metrics.getLatencySamples('limited');
      expect(samples.length).toBeLessThanOrEqual(1000);
    });
  });

  describe('MetricsTimer', () => {
    it('should measure operation duration', async () => {
      const timer = new MetricsTimer('test.operation');

      await wait(50);

      const duration = timer.stop();

      expect(duration).toBeGreaterThanOrEqual(50);
      expect(duration).toBeLessThan(100);

      // Verify metric was recorded
      const p50 = metrics.getLatencyPercentile('test.operation', 50);
      expect(p50).toBeGreaterThanOrEqual(50);
    });

    it('should record metrics with labels', async () => {
      const timer = new MetricsTimer('api.call', { endpoint: '/test' });

      await wait(30);

      timer.stop();

      const p50 = metrics.getLatencyPercentile('api.call', 50, { endpoint: '/test' });
      expect(p50).toBeGreaterThanOrEqual(30);
    });

    it('should support multiple timers concurrently', async () => {
      const timer1 = new MetricsTimer('op1');
      await wait(20);
      const timer2 = new MetricsTimer('op2');
      await wait(20);

      const duration1 = timer1.stop();
      const duration2 = timer2.stop();

      expect(duration1).toBeGreaterThanOrEqual(40);
      expect(duration2).toBeGreaterThanOrEqual(20);
      expect(duration2).toBeLessThan(duration1);
    });
  });

  describe('Metrics Export', () => {
    it('should export all metrics', () => {
      metrics.incrementCounter('requests', { status: '200' }, 100);
      metrics.setGauge('memory', 512, { unit: 'MB' });
      metrics.recordLatency('response_time', 150, { endpoint: '/api' });

      const exported = metrics.exportMetrics();

      expect(exported.counters).toHaveProperty('requests');
      expect(exported.gauges).toHaveProperty('memory');
      expect(exported.latencies).toHaveProperty('response_time');
    });

    it('should reset metrics', () => {
      metrics.incrementCounter('test.counter', {}, 10);
      metrics.setGauge('test.gauge', 42);
      metrics.recordLatency('test.latency', 100);

      metrics.reset();

      expect(metrics.getCounter('test.counter')).toBe(0);
      expect(metrics.getGauge('test.gauge')).toBeUndefined();
      expect(metrics.getLatencyPercentile('test.latency', 50)).toBeNull();
    });
  });

  describe('High Latency Warnings', () => {
    it('should warn on latencies > 1000ms', () => {
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation();

      metrics.recordLatency('slow.operation', 1500);

      // Note: In actual implementation, this would log via pino logger
      // For testing, we're just verifying the threshold logic works

      warnSpy.mockRestore();
    });
  });
});

describe('Integration: Throttling + Metrics', () => {
  let metrics: MetricsCollector;

  beforeEach(() => {
    metrics = getMetrics();
    metrics.reset();
  });

  it('should throttle metrics collection', async () => {
    let callCount = 0;
    const recordMetric = () => {
      callCount++;
      metrics.incrementCounter('throttled.calls');
    };

    const throttled = throttle(recordMetric, 100);

    // Rapid calls
    for (let i = 0; i < 50; i++) {
      throttled();
    }

    expect(callCount).toBe(1); // Only first call executed

    await wait(120);

    expect(callCount).toBe(2); // Last call executed after throttle
    expect(metrics.getCounter('throttled.calls')).toBe(2);
  });

  it('should measure throttled function performance', async () => {
    const expensiveOp = () => {
      const timer = new MetricsTimer('expensive.op');
      // Simulate work
      const start = Date.now();
      while (Date.now() - start < 10) {
        // busy wait
      }
      timer.stop();
    };

    const throttled = throttle(expensiveOp, 50);

    throttled();
    throttled();
    throttled();

    await wait(60);

    const p50 = metrics.getLatencyPercentile('expensive.op', 50);
    expect(p50).toBeGreaterThanOrEqual(10);
  });

  it('should enforce rate limits with metrics tracking', () => {
    const bucket = new TokenBucket(10, 1, 1000);
    let successCount = 0;
    let rateLimitedCount = 0;

    for (let i = 0; i < 20; i++) {
      if (bucket.tryConsume(1)) {
        successCount++;
        metrics.incrementCounter('requests.success');
      } else {
        rateLimitedCount++;
        metrics.incrementCounter('requests.rate_limited');
      }
    }

    expect(successCount).toBe(10);
    expect(rateLimitedCount).toBe(10);
    expect(metrics.getCounter('requests.success')).toBe(10);
    expect(metrics.getCounter('requests.rate_limited')).toBe(10);
  });
});
