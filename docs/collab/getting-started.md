# Getting Started with Olumi Collaboration

This guide will walk you through setting up and running the Olumi real-time collaboration system locally.

## Prerequisites

- Node.js >= 18
- PostgreSQL >= 14
- npm >= 9

## Step 1: Clone and Install

```bash
git clone <repository-url>
cd Olumi-CRDT
npm install
```

## Step 2: Database Setup

1. Create a PostgreSQL database:

```bash
createdb olumi_collab
```

2. The service will automatically create the required tables on first run.

## Step 3: Configure Environment

1. Navigate to the service directory:

```bash
cd packages/collab-service
```

2. Copy the example environment file:

```bash
cp .env.example .env
```

3. Edit `.env` with your configuration:

```env
NODE_ENV=development
PORT=3001
HOST=0.0.0.0

DATABASE_URL=postgresql://localhost:5432/olumi_collab

JWT_SECRET=your-development-secret-change-me

REALTIME_COLLAB=on

LOG_LEVEL=info

ALLOWED_ORIGINS=http://localhost:3000,http://localhost:5173
```

## Step 4: Start the Collaboration Service

```bash
cd packages/collab-service
npm run dev
```

You should see:

```
[INFO] Database initialized
[INFO] Document manager initialized
[INFO] WebSocket server initialized
[INFO] Collaboration service started on port 3001
```

## Step 5: Create a Test Client

Create a simple HTML file to test the collaboration:

```html
<!DOCTYPE html>
<html>
<head>
  <title>Olumi Collaboration Test</title>
  <script type="module">
    import * as Y from 'https://cdn.jsdelivr.net/npm/yjs@13/+esm';

    const ydoc = new Y.Doc();
    const ws = new WebSocket('ws://localhost:3001/api/collab/boards/test-board-123?token=test-token');

    ws.onopen = () => {
      console.log('Connected!');

      // Make a change
      const boardMap = ydoc.getMap('board');
      boardMap.set('title', 'My Test Board');
    };

    ws.onmessage = (event) => {
      const message = new Uint8Array(event.data);
      console.log('Message received:', message);
      // Apply updates...
    };

    ydoc.on('update', (update) => {
      console.log('Document updated:', update);
    });
  </script>
</head>
<body>
  <h1>Check the console for collaboration events</h1>
</body>
</html>
```

## Step 6: Test Multi-Client Collaboration

1. Open the test HTML file in two different browser windows
2. Make changes in one window
3. Observe the changes appearing in the other window

## Step 7: Verify with Two Concurrent Clients

For a complete test, you can run the integration test:

```bash
cd packages/collab-service
npm test -- integration.test.ts
```

## Next Steps

### Integrate with Your UI

See the [collab-client README](../../packages/collab-client/README.md) for React integration examples.

### Enable Feature Flags

Set `REALTIME_COLLAB` in your environment:
- `off`: Disabled
- `beta`: Enabled for specific orgs (requires allowlist)
- `on`: Enabled for all

### Add Authentication

The service expects JWT tokens with this payload:

```json
{
  "userId": "user-uuid",
  "orgId": "org-uuid",
  "email": "user@example.com",
  "roles": ["member"]
}
```

Generate tokens using your authentication service.

### Monitor Performance

Check the health endpoint:

```bash
curl http://localhost:3001/health
```

Response:

```json
{
  "status": "healthy",
  "timestamp": "2025-11-22T10:00:00Z",
  "metrics": {
    "activeConnections": 2,
    "activeBoards": 1,
    "memoryUsageMB": 24,
    "uptimeSeconds": 3600
  }
}
```

## Troubleshooting

### Connection Refused

- Ensure the service is running: `curl http://localhost:3001/health`
- Check firewall settings
- Verify WebSocket upgrade is allowed

### Authentication Errors

- Check JWT secret matches between client and server
- Verify token hasn't expired
- Ensure token includes required fields (userId, orgId, email, roles)

### Database Errors

- Ensure PostgreSQL is running: `pg_isready`
- Check DATABASE_URL is correct
- Verify database exists: `psql -l`

### Slow Performance

- Check active document count: GET `/api/collab/admin/boards`
- Monitor database query performance
- Consider adjusting eviction settings in `.env`

## Development Tips

### Hot Reload

The service uses `tsx watch` for hot reload in development:

```bash
npm run dev
```

### Debug Logging

Set `LOG_LEVEL=debug` in `.env` for verbose logs.

### Database Reset

To start fresh:

```bash
psql olumi_collab -c "DROP TABLE IF EXISTS boards, yjs_updates, board_snapshots CASCADE;"
```

The service will recreate tables on next start.

## Production Deployment

For production deployment, see [Deployment Guide](./deployment.md).

Key considerations:
- Use a strong JWT_SECRET
- Enable SSL/TLS for WebSocket connections
- Configure connection pooling for database
- Set up monitoring and alerting
- Configure load balancer with sticky sessions
- Set appropriate rate limits

## Questions?

See the [Architecture Documentation](./architecture.md) for design details.
