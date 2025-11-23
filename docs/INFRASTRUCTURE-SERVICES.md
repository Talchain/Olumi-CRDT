# Olumi Infrastructure Services

This document describes the foundational infrastructure services that power Olumi's collaboration platform: Event Bus, Job Scheduler, and Notification Service.

## Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [Services](#services)
- [Quick Start](#quick-start)
- [Configuration](#configuration)
- [API Documentation](#api-documentation)
- [Monitoring](#monitoring)
- [Testing](#testing)
- [Deployment](#deployment)
- [Troubleshooting](#troubleshooting)

## Overview

The infrastructure services provide:

- **Event Bus**: Async event distribution using Redis Streams for inter-service communication
- **Job Scheduler**: Background job processing using BullMQ for time-based automation
- **Notification Service**: Multi-channel notification delivery (email, Slack, in-app)

These services support Phase 4 features (G-L) including access request workflows, expiration jobs, and user notifications.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                      Collab Service                              │
│  (WebSocket + REST API)                                          │
└───────┬─────────────────────┬──────────────────────┬────────────┘
        │                     │                      │
        │ Publishes Events    │ Schedules Jobs       │ Requests Notifications
        │                     │                      │
        v                     v                      v
┌───────────────┐     ┌──────────────────┐   ┌────────────────────┐
│  Event Bus    │────▶│ Job Scheduler    │   │ Notification Svc   │
│ (Redis)       │     │ (BullMQ)         │──▶│ (Email/Slack)      │
└───────────────┘     └──────────────────┘   └────────────────────┘
        │                     │                      │
        └─────────────────────┴──────────────────────┘
                              │
                       ┌──────▼──────┐
                       │  PostgreSQL │
                       │  (State)    │
                       └─────────────┘
```

### Data Flow Example: Access Request Workflow

1. **User requests access** (Collab Service)
2. **Event published** to Event Bus: `ACCESS_REQUEST_CREATED`
3. **Notification Service** consumes event → sends email to admin
4. **Admin approves** (Collab Service)
5. **Event published**: `ACCESS_REQUEST_APPROVED`
6. **Job Scheduler** schedules expiration job (30 days)
7. **Notification Service** sends confirmation email to user
8. **After 30 days**, Job Scheduler triggers expiration
9. **Event published**: `ACCESS_REQUEST_EXPIRED`
10. **Collab Service** revokes access, Notification Service notifies user

## Services

### 1. Event Bus Service

**Purpose**: Distributed event streaming for async inter-service communication

**Technology**: Redis Streams with consumer groups

**Key Features**:
- Pub/sub event distribution
- At-least-once delivery guarantee
- Consumer groups for parallel processing
- Event filtering by type
- Persistent event log

**Metrics**:
- `event_bus_events_published_total`
- `event_bus_events_consumed_total`
- `event_bus_stream_length`

**Health Check**: `GET http://localhost:3001/health`

**Port**: 3001

### 2. Job Scheduler Service

**Purpose**: Background job processing with cron-like scheduling

**Technology**: BullMQ (Redis-backed job queue)

**Key Features**:
- Cron-based recurring jobs
- One-time delayed jobs
- Automatic retries with exponential backoff
- Job prioritization
- Queue management (pause/resume)
- Failed job inspection and retry

**Configured Jobs**:
1. **Expire Access Requests** - Every 5 minutes
2. **Notify Expiring Access** - Daily at 9 AM
3. **Cleanup Old Audit Logs** - Weekly on Sunday at 2 AM
4. **Cleanup Expired Sessions** - Daily at 3 AM
5. **Generate Daily Analytics** - Daily at 1 AM

**Metrics**:
- `job_scheduler_jobs_scheduled_total`
- `job_scheduler_jobs_completed_total`
- `job_scheduler_jobs_failed_total`
- `job_scheduler_queue_size`

**Health Check**: `GET http://localhost:3002/health`

**Port**: 3002

### 3. Notification Service

**Purpose**: Multi-channel notification delivery with user preferences

**Technology**: PostgreSQL + Email (Brevo) + Slack

**Key Features**:
- Multi-channel delivery (email, in-app, Slack)
- User notification preferences
- Do-not-disturb settings
- Notification templates
- Delivery status tracking
- In-app notification storage

**Supported Notification Types**:
- Access request created/approved/denied/expired
- Board created
- Element visibility changed
- User role changed

**Metrics**:
- `notification_service_notifications_sent_total`
- `notification_service_notifications_failed_total`
- `notification_service_delivery_duration_seconds`

**Health Check**: `GET http://localhost:3003/health`

**Port**: 3003

## Quick Start

### Using Docker Compose (Recommended)

```bash
# Start all services
docker-compose up -d

# Verify services are running
docker-compose ps

# View logs
docker-compose logs -f event-bus
docker-compose logs -f job-scheduler
docker-compose logs -f notification-service

# Stop all services
docker-compose down
```

### Local Development

```bash
# 1. Start Redis and PostgreSQL
docker-compose up -d redis postgres

# 2. Build shared packages
cd packages/contracts && npm run build && cd ../..
cd packages/telemetry && npm run build && cd ../..

# 3. Start Event Bus
cd services/event-bus
cp .env.example .env
npm install
npm run dev

# 4. Start Job Scheduler
cd services/job-scheduler
cp .env.example .env
npm install
npm run dev

# 5. Start Notification Service
cd services/notification-service
cp .env.example .env
# Edit .env with EMAIL_API_KEY, SLACK_WEBHOOK_URL
npm install
npm run dev
```

## Configuration

### Environment Variables

Each service is configured via environment variables. See `.env.example` in each service directory.

#### Common Settings

```env
NODE_ENV=development
LOG_LEVEL=info
LOG_PRETTY=true
REDIS_HOST=localhost
REDIS_PORT=6379
```

#### Event Bus

```env
PORT=3001
STREAM_NAME=olumi:events
CONSUMER_GROUP=event-bus-consumers
```

#### Job Scheduler

```env
PORT=3002
QUEUE_NAME_PREFIX=olumi:jobs
CONCURRENCY=5

# Override default cron schedules
EXPIRE_ACCESS_REQUESTS_CRON="*/5 * * * *"
NOTIFY_EXPIRING_ACCESS_CRON="0 9 * * *"
```

#### Notification Service

```env
PORT=3003
POSTGRES_DB=olumi_notifications

# Email (Brevo)
EMAIL_PROVIDER=brevo
EMAIL_API_KEY=your-api-key
EMAIL_FROM_ADDRESS=noreply@olumi.com
EMAIL_FROM_NAME=Olumi

# Slack
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/YOUR/WEBHOOK/URL
```

## API Documentation

### Event Bus Service

**Base URL**: `http://localhost:3001`

#### Endpoints

- `GET /health` - Health check
- `GET /ready` - Readiness check
- `GET /metrics` - Prometheus metrics
- `GET /stream/info` - Stream information

**Example**:
```bash
curl http://localhost:3001/stream/info
```

**Response**:
```json
{
  "length": 142,
  "groups": 2,
  "lastId": "1234567890-0"
}
```

### Job Scheduler Service

**Base URL**: `http://localhost:3002`

#### Endpoints

- `GET /health` - Health check
- `GET /ready` - Readiness check
- `GET /metrics` - Prometheus metrics
- `GET /jobs/counts` - Get job counts for all queues
- `GET /jobs/:jobType/counts` - Get job counts for specific queue
- `GET /jobs/:jobType/failed?limit=10` - Get failed jobs
- `POST /jobs/:jobType/:jobId/retry` - Retry a failed job
- `DELETE /jobs/:jobType/:jobId` - Remove a job
- `POST /jobs/:jobType/pause` - Pause a queue
- `POST /jobs/:jobType/resume` - Resume a queue

**Example**:
```bash
# Get all job counts
curl http://localhost:3002/jobs/counts

# Get failed jobs
curl http://localhost:3002/jobs/EXPIRE_ACCESS_REQUESTS/failed?limit=5

# Retry a failed job
curl -X POST http://localhost:3002/jobs/EXPIRE_ACCESS_REQUESTS/123/retry
```

**Response (job counts)**:
```json
{
  "EXPIRE_ACCESS_REQUESTS": {
    "waiting": 0,
    "active": 1,
    "completed": 1523,
    "failed": 2,
    "delayed": 0
  },
  ...
}
```

### Notification Service

**Base URL**: `http://localhost:3003`

#### Endpoints

- `GET /health` - Health check
- `GET /metrics` - Prometheus metrics
- `GET /notifications/:userId?limit=50&offset=0` - Get in-app notifications
- `GET /preferences/:userId` - Get user notification preferences
- `PUT /preferences/:userId` - Update user notification preferences
- `GET /notifications/:notificationId/delivery` - Get delivery status
- `GET /stats?startDate=...&endDate=...&channel=email` - Get statistics

**Example**:
```bash
# Get in-app notifications for user
curl http://localhost:3003/notifications/user_123?limit=20

# Get user preferences
curl http://localhost:3003/preferences/user_123

# Update preferences
curl -X PUT http://localhost:3003/preferences/user_123 \
  -H "Content-Type: application/json" \
  -d '{
    "global_settings": {
      "email_enabled": true,
      "in_app_enabled": true,
      "slack_enabled": false
    }
  }'

# Get delivery statistics
curl "http://localhost:3003/stats?channel=email"
```

**Response (notifications)**:
```json
[
  {
    "notification_id": "notif_123",
    "notification_type": "ACCESS_REQUEST_APPROVED",
    "recipient_user_id": "user_123",
    "recipient_email": "user@example.com",
    "priority": "normal",
    "channels": ["email", "in_app"],
    "subject": "Access Request Approved",
    "message": "Your access request has been approved...",
    "created_at": "2025-11-23T10:30:00Z"
  }
]
```

## Monitoring

### Prometheus Metrics

All services expose Prometheus metrics at `/metrics`.

**Start Prometheus and Grafana**:
```bash
docker-compose --profile monitoring up -d
```

**Access**:
- Prometheus: http://localhost:9090
- Grafana: http://localhost:3001 (admin/admin)

### Key Metrics to Monitor

**Event Bus**:
- Stream length - indicates backlog
- Consumer lag - events not yet consumed
- Events published/consumed rates

**Job Scheduler**:
- Queue size - pending jobs
- Failed job count - errors
- Job execution duration - performance

**Notification Service**:
- Notifications sent - delivery rate
- Failed notifications - error rate
- Delivery duration - performance

### Alerts

Recommended alerts:

1. **Event Bus stream length > 1000** - Processing backlog
2. **Job failed count increasing** - Recurring failures
3. **Notification failure rate > 5%** - Delivery issues
4. **Service health check failing** - Service down

## Testing

### Unit Tests

```bash
# Event Bus
cd services/event-bus && npm test

# Job Scheduler
cd services/job-scheduler && npm test

# Notification Service
cd services/notification-service && npm test
```

### Integration Tests

```bash
# Ensure Redis and PostgreSQL are running
docker-compose up -d redis postgres

# Run integration tests
cd integration-tests
npm test
```

### Test Coverage

```bash
cd services/event-bus && npm run test:coverage
cd services/job-scheduler && npm run test:coverage
cd services/notification-service && npm run test:coverage
```

## Deployment

### Docker Deployment

**Build images**:
```bash
docker-compose build
```

**Start services**:
```bash
docker-compose up -d
```

**Scale services**:
```bash
docker-compose up -d --scale notification-service=3
```

### Kubernetes Deployment

*(To be added based on your k8s setup)*

```bash
kubectl apply -f k8s/
```

### Production Checklist

- [ ] Set secure `EMAIL_API_KEY`
- [ ] Set secure `SLACK_WEBHOOK_URL`
- [ ] Configure PostgreSQL with strong password
- [ ] Enable Redis password authentication
- [ ] Set up TLS for all HTTP endpoints
- [ ] Configure log aggregation (e.g., ELK, Datadog)
- [ ] Set up alerting (Prometheus Alertmanager)
- [ ] Configure backup for PostgreSQL
- [ ] Enable Redis persistence (AOF)
- [ ] Set resource limits (CPU/memory)
- [ ] Configure auto-scaling policies
- [ ] Set up health check monitoring

## Troubleshooting

### Services won't start

**Check logs**:
```bash
docker-compose logs -f event-bus
docker-compose logs -f job-scheduler
docker-compose logs -f notification-service
```

**Common issues**:
1. Redis not available → Check `docker-compose ps redis`
2. PostgreSQL not available → Check `docker-compose ps postgres`
3. Port already in use → Stop conflicting service or change port

### Redis connection errors

```bash
# Test Redis connection
docker-compose exec redis redis-cli ping
# Expected: PONG

# Check Redis logs
docker-compose logs redis

# Restart Redis
docker-compose restart redis
```

### PostgreSQL connection errors

```bash
# Test PostgreSQL connection
docker-compose exec postgres psql -U postgres -c "SELECT 1"

# Check PostgreSQL logs
docker-compose logs postgres

# Recreate database
docker-compose down -v postgres
docker-compose up -d postgres
```

### Email delivery failures

**Check**:
1. `EMAIL_API_KEY` is valid
2. `EMAIL_FROM_ADDRESS` is verified in Brevo
3. Check Brevo dashboard for delivery status
4. Review notification service logs

**Test email manually**:
```bash
curl -X POST http://localhost:3003/notifications/test_user \
  -H "Content-Type: application/json" \
  -d '{
    "notificationType": "ACCESS_REQUEST_CREATED",
    "recipientEmail": "test@example.com",
    "channels": ["email"]
  }'
```

### Job not running

**Check**:
1. Job queue is not paused
2. Worker is registered for job type
3. Check job counts: `curl http://localhost:3002/jobs/counts`
4. Inspect failed jobs: `curl http://localhost:3002/jobs/JOB_TYPE/failed`

**Retry failed job**:
```bash
curl -X POST http://localhost:3002/jobs/EXPIRE_ACCESS_REQUESTS/JOB_ID/retry
```

### Event not consumed

**Check**:
1. Consumer is subscribed to correct event types
2. Consumer is running
3. Check stream info: `curl http://localhost:3001/stream/info`
4. Check Event Bus logs for errors

## Additional Resources

- [Phase 4 Delivery Summary](./PHASE-4-DELIVERY-SUMMARY.md)
- [Security Assessment](../packages/collab-service/docs/SECURITY-ASSESSMENT.md)
- [Access Request UI Patterns](./ACCESS-REQUEST-UI-PATTERNS.md)
- [Shared Contracts Package](../packages/contracts/README.md) *(to be created)*
- [Telemetry Package](../packages/telemetry/README.md) *(to be created)*

## Support

For questions or issues:
- Check service logs first
- Review this documentation
- Open an issue on GitHub
- Contact the platform team

---

**Last Updated**: 2025-11-23
