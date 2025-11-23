/**
 * Event Bus Metrics
 */

import { createCounter, createHistogram, createGauge } from '@olumi/telemetry';

/**
 * Events published total
 */
export const eventsPublishedTotal = createCounter({
  name: 'event_bus_events_published_total',
  help: 'Total number of events published',
  labelNames: ['event_type'],
});

/**
 * Events consumed total
 */
export const eventsConsumedTotal = createCounter({
  name: 'event_bus_events_consumed_total',
  help: 'Total number of events consumed',
  labelNames: ['event_type', 'consumer_id', 'status'],
});

/**
 * Event processing duration
 */
export const eventProcessingDuration = createHistogram({
  name: 'event_bus_event_processing_duration_seconds',
  help: 'Event processing duration in seconds',
  labelNames: ['event_type', 'consumer_id'],
  buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 5],
});

/**
 * Stream length (number of pending messages)
 */
export const streamLength = createGauge({
  name: 'event_bus_stream_length',
  help: 'Number of messages in the stream',
});

/**
 * Active consumers
 */
export const activeConsumers = createGauge({
  name: 'event_bus_active_consumers',
  help: 'Number of active consumers',
});

/**
 * Pending messages per consumer
 */
export const pendingMessages = createGauge({
  name: 'event_bus_pending_messages',
  help: 'Number of pending messages per consumer',
  labelNames: ['consumer_id'],
});
