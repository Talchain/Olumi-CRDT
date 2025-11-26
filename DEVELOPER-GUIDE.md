# Olumi CRDT - Developer Guide

> Practical guide for contributing to the Olumi collaboration platform

**Audience**: Engineers contributing code to the platform
**Prerequisites**: Familiarity with Node.js, TypeScript, React, PostgreSQL

---

## Table of Contents

1. [Local Development Setup](#local-development-setup)
2. [Project Structure](#project-structure)
3. [Development Workflow](#development-workflow)
4. [Testing](#testing)
5. [Code Patterns](#code-patterns)
6. [Deployment](#deployment)
7. [Troubleshooting](#troubleshooting)

---

## Local Development Setup

### Prerequisites

- **Node.js** ≥ 18.0.0
- **PostgreSQL** ≥ 14.0
- **npm** ≥ 9.0.0
- **Git**

### Step 1: Clone and Install

```bash
git clone <repository-url>
cd Olumi-CRDT
npm install
```

This installs dependencies for the monorepo and all packages.

### Step 2: Database Setup

1. **Create database**:
```bash
createdb olumi_collab
```

2. **Configure connection**:
```bash
cd services/collab-service
cp .env.example .env
```

3. **Edit `.env`**:
```env
NODE_ENV=development
PORT=3001
HOST=0.0.0.0

DATABASE_URL=postgresql://localhost:5432/olumi_collab

# Generate: openssl rand -base64 48
JWT_SECRET=your-development-secret-change-me-in-production

REALTIME_COLLAB=on

LOG_LEVEL=debug

ALLOWED_ORIGINS=http://localhost:3000,http://localhost:5173
```

4. **Database schema**: Auto-initializes on first start

### Step 3: Start Development Server

```bash
cd services/collab-service
npm run dev
```

**Output**:
```
[INFO] Database initialized
[INFO] Document manager initialized
[INFO] WebSocket server initialized
[INFO] Collaboration service started on port 3001
```

**Endpoints**:
- WebSocket: `ws://localhost:3001/api/collab/boards/:boardId`
- REST API: `http://localhost:3001/api/`
- Health: `http://localhost:3001/health`
- Metrics: `http://localhost:3001/metrics`

### Step 4: Verify Setup

```bash
# Run tests
npm test

# Check TypeScript compilation
npm run type-check

# Build for production
npm run build
```

---

## Project Structure

```
Olumi-CRDT/
├── services/
│   └── collab-service/           # Main collaboration service
│       ├── src/
│       │   ├── collab/          # CRDT document management
│       │   │   ├── websocket-server.ts
│       │   │   └── document-manager.ts
│       │   ├── database/        # PostgreSQL clients
│       │   │   ├── client.ts
│       │   │   ├── client-reviews.ts
│       │   │   └── client-webhooks.ts
│       │   ├── api/             # REST routes
│       │   │   ├── routes.ts
│       │   │   ├── routes-reviews.ts
│       │   │   └── routes-facilitation.ts
│       │   ├── facilitation/    # K.1-K.2 Smart Facilitation
│       │   │   ├── session-metrics.ts
│       │   │   ├── health-calculator.ts
│       │   │   ├── suggestion-engine.ts
│       │   │   ├── yjs-edit-extractor.ts
│       │   │   └── index.ts
│       │   ├── webhooks/        # I.1-I.2 Webhooks
│       │   │   ├── webhook-types.ts
│       │   │   ├── webhook-delivery.ts
│       │   │   └── webhook-manager.ts
│       │   ├── integrations/    # External integrations
│       │   │   └── slack-formatter.ts
│       │   ├── notifications/   # Email templates
│       │   │   ├── email-templates.ts
│       │   │   └── notification-service.ts
│       │   ├── metrics/         # Prometheus metrics
│       │   │   ├── prometheus.ts
│       │   │   └── collector.ts
│       │   ├── jobs/            # Background jobs
│       │   │   └── review-reminder-job.ts
│       │   ├── types/           # TypeScript types
│       │   ├── config.ts        # Configuration
│       │   └── index.ts         # Entry point
│       ├── tests/               # Unit & integration tests
│       │   ├── session-metrics.test.ts
│       │   ├── suggestion-engine.test.ts
│       │   ├── document-manager.test.ts
│       │   └── integration.test.ts
│       ├── package.json
│       ├── tsconfig.json
│       └── .env.example
├── packages/
│   └── collab-client/           # React client library (future)
├── docs/
│   └── collab/                  # Legacy documentation (archived)
├── README.md
├── TECHNICAL-SPECIFICATION.md
├── DEVELOPER-GUIDE.md           # This file
└── package.json                 # Root package (monorepo)
```

### Key Files

| File | Purpose |
|------|---------|
| `src/index.ts` | Application entry point |
| `src/config.ts` | Configuration management (env vars) |
| `src/collab/websocket-server.ts` | WebSocket server + Yjs sync |
| `src/collab/document-manager.ts` | Yjs document lifecycle |
| `src/database/client.ts` | PostgreSQL connection + queries |
| `src/api/routes-facilitation.ts` | K.1-K.2 API endpoints |
| `src/facilitation/session-metrics.ts` | Real-time metrics collection |
| `tests/session-metrics.test.ts` | K.1 tests (19 passing) |
| `tests/suggestion-engine.test.ts` | K.2 tests (26 passing) |

---

## Development Workflow

### Adding a New Feature

1. **Create feature branch**:
```bash
git checkout -b feature/my-feature
```

2. **Implement feature**:
   - Add code in `src/`
   - Follow existing patterns (see [Code Patterns](#code-patterns))
   - Update TypeScript types in `src/types/`

3. **Write tests**:
```bash
# Create test file
touch tests/my-feature.test.ts

# Write tests using Jest
import { describe, it, expect } from '@jest/globals';
```

4. **Run tests**:
```bash
npm test -- my-feature.test.ts
npm test -- --coverage  # Check coverage
```

5. **Type check**:
```bash
npm run type-check
```

6. **Commit and push**:
```bash
git add .
git commit -m "feat: Add my feature"
git push origin feature/my-feature
```

### Making API Changes

**Example: Adding a new endpoint**

1. **Define route** (`src/api/routes-my-feature.ts`):
```typescript
import { FastifyInstance } from 'fastify';
import { DatabaseClient } from '../database/client';

export async function registerMyFeatureRoutes(
  app: FastifyInstance,
  db: DatabaseClient
): Promise<void> {

  app.get('/api/my-endpoint', {
    preHandler: [(app as any).authenticate],
  }, async (request, reply) => {
    const userId = (request.user as any).userId;

    const data = await db.getMyData(userId);

    reply.send({
      success: true,
      data
    });
  });
}
```

2. **Register in main** (`src/index.ts`):
```typescript
import { registerMyFeatureRoutes } from './api/routes-my-feature';

await registerMyFeatureRoutes(app, db);
```

3. **Add database method** (`src/database/client.ts`):
```typescript
async getMyData(userId: string): Promise<MyData> {
  const result = await this.pool.query(
    'SELECT * FROM my_table WHERE user_id = $1',
    [userId]
  );
  return result.rows[0];
}
```

4. **Write tests** (`tests/my-feature.test.ts`):
```typescript
describe('MyFeature API', () => {
  it('should return data for authenticated user', async () => {
    // Test implementation
  });
});
```

---

## Testing

### Test Stack

- **Framework**: Jest 29.x
- **Assertion**: @jest/globals
- **Coverage**: ts-jest

### Running Tests

```bash
# All tests
npm test

# Specific test file
npm test -- session-metrics.test.ts

# Watch mode
npm run test:watch

# Coverage report
npm test -- --coverage
```

### Writing Tests

**Unit Test Example** (`tests/my-module.test.ts`):
```typescript
import { describe, it, expect, beforeEach } from '@jest/globals';
import { MyClass } from '../src/my-module';

describe('MyClass', () => {
  let instance: MyClass;

  beforeEach(() => {
    instance = new MyClass();
  });

  it('should do something', () => {
    const result = instance.doSomething('input');
    expect(result).toBe('expected output');
  });

  it('should handle edge case', () => {
    expect(() => instance.doSomething(null)).toThrow();
  });
});
```

**Integration Test Example** (`tests/integration.test.ts`):
```typescript
import { describe, it, expect } from '@jest/globals';
import * as Y from 'yjs';
import WebSocket from 'ws';

describe('Real-time Collaboration', () => {
  it('should sync two clients', async () => {
    const doc1 = new Y.Doc();
    const doc2 = new Y.Doc();

    const ws1 = new WebSocket('ws://localhost:3001/...');
    const ws2 = new WebSocket('ws://localhost:3001/...');

    // Test synchronization
    doc1.getMap('board').set('title', 'Test');

    await waitForSync();

    expect(doc2.getMap('board').get('title')).toBe('Test');
  });
});
```

### Test Coverage Goals

| Module | Target | Current |
|--------|--------|---------|
| K.1-K.2 Smart Facilitation | >80% | ~95% ✅ |
| Review Workflows | >80% | Pending |
| Webhooks | >80% | Pending |
| CRDT Sync | >80% | ~85% ✅ |

---

## Code Patterns

### Error Handling

**Pattern**: Use try-catch with structured logging

```typescript
async function myFunction(): Promise<Result> {
  try {
    const data = await database.query(...);
    return { success: true, data };
  } catch (err) {
    logger.error({ err }, 'Failed to fetch data');
    throw new Error('Database query failed');
  }
}
```

### API Response Format

**Standard success response**:
```typescript
reply.send({
  success: true,
  data: { ... }
});
```

**Standard error response**:
```typescript
reply.code(400).send({
  success: false,
  error: 'Invalid input',
  details: { field: 'email', reason: 'Required' }
});
```

### Logging

**Use Pino structured logging**:
```typescript
import { logger } from './logger';

logger.info({ boardId, userId }, 'User joined board');
logger.error({ err, context }, 'Operation failed');
logger.debug({ data }, 'Processing data');
```

**Log Levels**:
- `debug`: Verbose operational info
- `info`: Standard operational events
- `warn`: Warning conditions
- `error`: Error conditions (with error object)

### TypeScript Types

**Define interfaces for all data**:
```typescript
// src/types/my-feature.ts
export interface MyData {
  id: string;
  name: string;
  createdAt: Date;
}

export interface MyRequest {
  query: string;
  filters?: string[];
}
```

### Database Queries

**Use parameterized queries** (prevent SQL injection):
```typescript
// ✅ Good
const result = await pool.query(
  'SELECT * FROM boards WHERE id = $1',
  [boardId]
);

// ❌ Bad (SQL injection risk)
const result = await pool.query(
  `SELECT * FROM boards WHERE id = '${boardId}'`
);
```

**Handle errors**:
```typescript
try {
  const result = await pool.query(...);
  return result.rows[0];
} catch (err) {
  logger.error({ err }, 'Database query failed');
  throw err;
}
```

---

## Deployment

### Environment Variables (Production)

**Critical**:
```env
NODE_ENV=production
PORT=3001

# Security (MUST change)
JWT_SECRET=<64+ character random string>
DATABASE_URL=postgresql://user:pass@host:5432/db

# CORS
ALLOWED_ORIGINS=https://app.example.com

# Proxy (if behind load balancer)
TRUST_PROXY=true
TRUSTED_PROXY_IPS=10.0.0.0/8,172.16.0.0/12
```

### Docker Build

```bash
# Build image
docker build -t olumi/collab-service:latest services/collab-service

# Run locally
docker run -p 3001:3001 --env-file .env olumi/collab-service:latest
```

### Kubernetes Deployment

See **[TECHNICAL-SPECIFICATION.md](TECHNICAL-SPECIFICATION.md)** for full Kubernetes manifests.

**Quick deploy**:
```bash
kubectl apply -f k8s/deployment.yaml
kubectl apply -f k8s/service.yaml
kubectl apply -f k8s/ingress.yaml
```

### Health Checks

**Liveness**: `GET /health`
- Returns 200 if service is alive
- Kubernetes restarts pod if unhealthy

**Readiness**: `GET /ready`
- Returns 200 if service is ready (DB connected)
- Kubernetes removes from load balancer if not ready

---

## Troubleshooting

### Common Issues

#### Database Connection Failed

**Error**: `Database connection failed`

**Solution**:
1. Check DATABASE_URL in `.env`
2. Verify PostgreSQL is running: `pg_isready`
3. Check connection: `psql $DATABASE_URL`
4. Ensure database exists: `createdb olumi_collab`

#### WebSocket Connection Refused

**Error**: `WebSocket connection to 'ws://localhost:3001/...' failed`

**Solution**:
1. Check service is running: `curl http://localhost:3001/health`
2. Verify JWT token is valid
3. Check CORS settings in `ALLOWED_ORIGINS`
4. Check browser console for errors

#### TypeScript Compilation Errors

**Error**: `TS2345: Argument of type 'X' is not assignable to type 'Y'`

**Solution**:
1. Run `npm run type-check` to see all errors
2. Check type definitions in `src/types/`
3. Ensure dependencies are up to date: `npm update`
4. Clear build cache: `rm -rf dist/`

#### Tests Failing

**Error**: `Jest failed with 1 test failed`

**Solution**:
1. Run single test: `npm test -- my-test.test.ts`
2. Enable verbose output: `npm test -- --verbose`
3. Check test database is clean
4. Ensure no port conflicts (3001 in use)

### Debugging

**Enable debug logging**:
```env
LOG_LEVEL=debug
```

**Attach debugger** (VS Code):
```json
// .vscode/launch.json
{
  "type": "node",
  "request": "launch",
  "name": "Debug Service",
  "runtimeArgs": ["--loader", "tsx"],
  "args": ["${workspaceFolder}/services/collab-service/src/index.ts"],
  "env": {
    "NODE_ENV": "development"
  }
}
```

**Check metrics**:
```bash
curl http://localhost:3001/metrics
```

**Database queries**:
```bash
psql $DATABASE_URL
\dt  # List tables
SELECT * FROM yjs_updates LIMIT 10;
```

### Performance Issues

**Slow API responses**:
1. Check Prometheus metrics: `GET /metrics`
2. Look for slow database queries in logs
3. Check database indexes
4. Verify connection pool not exhausted

**High memory usage**:
1. Check number of active Yjs documents
2. Reduce `DOCUMENT_EVICTION_TIMEOUT`
3. Increase pod memory limits
4. Check for memory leaks: `node --inspect`

---

## Getting Help

- **Documentation**: [README.md](README.md), [TECHNICAL-SPECIFICATION.md](TECHNICAL-SPECIFICATION.md)
- **Issues**: Submit via GitHub issues
- **Questions**: Contact platform team
- **Code Review**: Create pull request

---

## Contributing Guidelines

1. **Code Style**: Follow existing patterns
2. **Tests**: Write tests for new features (>80% coverage)
3. **Types**: Use TypeScript strictly (no `any`)
4. **Documentation**: Update docs for API changes
5. **Commits**: Use conventional commits (`feat:`, `fix:`, `docs:`, etc.)
6. **Pull Requests**: Include description, testing notes, breaking changes

---

**Last Updated**: 2025-11-25
**Maintainers**: Olumi Platform Team
