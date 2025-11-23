# Olumi CRDT - Real-time Collaboration System

A production-ready, real-time collaboration system for Olumi's Scenario Sandbox decision boards, built on Conflict-free Replicated Data Types (CRDTs) using Yjs.

## Features

- ✨ **Real-time Collaboration**: Multiple users editing the same board simultaneously
- 🔒 **Conflict-free**: Automatic CRDT-based conflict resolution
- 👥 **Presence Awareness**: See who's editing and what they're working on
- 💾 **Persistent**: Automatic snapshots and incremental update storage
- 🔐 **Secure**: Multi-tenant with JWT authentication and authorization
- 📊 **Scalable**: Designed for 10-20 concurrent editors per board
- 🎯 **Engine Integration**: Seamless integration with PLoT engine for decision analysis
- 🚀 **Production Ready**: Docker, Kubernetes, comprehensive monitoring

## Project Structure

```
Olumi-CRDT/
├── packages/
│   ├── collab-service/      # WebSocket collaboration server (Node.js + Fastify)
│   └── collab-client/        # React client library
├── docs/
│   └── collab/               # Architecture and API documentation
├── scripts/                  # Validation and utility scripts
└── README.md                 # This file
```

## Quick Start

### Prerequisites

- Node.js >= 18
- PostgreSQL >= 14
- npm >= 9

### Installation

```bash
# Clone repository
git clone <repository-url>
cd Olumi-CRDT

# Install dependencies
npm install

# Set up environment
cd packages/collab-service
cp .env.example .env
# Edit .env with your configuration

# Start database
createdb olumi_collab

# Start service
npm run dev
```

The service will be available at `http://localhost:3001`.

### Client Integration

```bash
npm install @olumi/collab-client yjs
```

```tsx
import { useCollaboration, CollaborationBar } from '@olumi/collab-client';

function MyBoard() {
  const { ydoc, status, presence } = useCollaboration({
    serverUrl: 'wss://collab.olumi.ai',
    boardId: 'my-board-id',
    authToken: 'jwt-token',
    currentUser: {
      id: 'user-123',
      name: 'Alice',
      email: 'alice@example.com',
      color: '#3b82f6',
    },
  });

  const board = useBoardState(ydoc);
  const users = useConnectedUsers(presence);

  return (
    <>
      <CollaborationBar users={users} status={status} />
      {/* Your board UI */}
    </>
  );
}
```

## Documentation

- **[Architecture](./docs/collab/architecture.md)** - System design and components
- **[API Contracts](./docs/collab/api-contracts.md)** - WebSocket and REST API specifications
- **[Board Contracts](./docs/collab/board-contracts.md)** - Data structures and transformations
- **[Getting Started](./docs/collab/getting-started.md)** - Local development setup
- **[Deployment](./docs/collab/deployment.md)** - Production deployment guide

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         Client Layer                            │
│  React + TypeScript + Yjs Client                                │
└────────────────────────────┬────────────────────────────────────┘
                             │ WebSocket
┌────────────────────────────▼────────────────────────────────────┐
│                   Collaboration Service                          │
│  Node.js + Fastify + Yjs + PostgreSQL                           │
└────────────────────────────┬────────────────────────────────────┘
                             │ REST API
┌────────────────────────────▼────────────────────────────────────┐
│                        PLoT Engine                               │
│  Decision analysis and recommendations                           │
└──────────────────────────────────────────────────────────────────┘
```

### Key Components

1. **Collaboration Service** (`packages/collab-service`)
   - WebSocket server for real-time sync
   - Yjs document management
   - Persistence layer (PostgreSQL)
   - REST API for snapshots and status

2. **Collaboration Client** (`packages/collab-client`)
   - React hooks and components
   - Yjs client provider
   - Presence management
   - UI components (collaboration bar, connection status, etc.)

3. **CRDT Engine**
   - Yjs for conflict-free replication
   - Automatic merge and conflict resolution
   - Efficient delta synchronization
   - Undo/redo support

## Testing

### Unit Tests

```bash
# Service tests
cd packages/collab-service
npm test

# Client tests
cd packages/collab-client
npm test
```

### Integration Tests

```bash
cd packages/collab-service
npm test -- integration.test.ts
```

### End-to-End Validation

```bash
# Start service first
cd packages/collab-service
npm run dev

# In another terminal, run validation
cd ../..
npm run validate:e2e
```

The validation script tests:
- Single and multi-client connections
- Concurrent editing and CRDT convergence
- Presence/awareness synchronization

## Deployment

### Docker

```bash
cd packages/collab-service
docker build -t olumi-collab-service .
docker run -p 3001:3001 \
  -e DATABASE_URL=postgresql://... \
  -e JWT_SECRET=... \
  olumi-collab-service
```

### Kubernetes

```bash
kubectl apply -f k8s/
```

See [Deployment Guide](./docs/collab/deployment.md) for detailed instructions.

## Performance

### Benchmarks

- **Latency**: < 100ms p50, < 200ms p99 (edit to remote client)
- **Throughput**: 100+ updates/second per board
- **Concurrency**: 10-20 editors per board (tested)
- **Memory**: ~20KB per active board
- **Scalability**: 1000+ active boards per instance

### Optimization

- Binary WebSocket protocol (not JSON)
- Delta-based synchronization
- Periodic snapshot compaction
- Document eviction after inactivity
- Database connection pooling

## Security

- **Authentication**: JWT tokens with org/user context
- **Authorization**: Per-board access control
- **Multi-tenancy**: Strict org-level isolation
- **Encryption**: TLS for WebSocket connections
- **Privacy**: No raw board content in logs
- **Rate limiting**: Per-user and per-org limits

## Monitoring

### Health Check

```bash
curl http://localhost:3001/health
```

Response:

```json
{
  "status": "healthy",
  "metrics": {
    "activeConnections": 23,
    "activeBoards": 8,
    "memoryUsageMB": 156
  }
}
```

### Metrics

The service exposes Prometheus metrics at `/metrics`:

- `collab_active_connections` - Active WebSocket connections
- `collab_documents_active_count` - Active Yjs documents
- `collab_updates_received_total` - Total updates received
- `collab_snapshots_created_total` - Total snapshots created

## Roadmap

### Phase 1 (Complete)
- ✅ CRDT-based collaboration
- ✅ Multi-user editing
- ✅ Presence awareness
- ✅ Persistence and snapshots
- ✅ Engine integration
- ✅ Production deployment

### Phase 2 (Future)
- 🔲 Cursor tracking and remote cursors
- 🔲 Commenting and annotations
- 🔲 Version history and time travel
- 🔲 Conflict UI for manual resolution
- 🔲 Offline mode with sync on reconnect

### Phase 3 (Advanced)
- 🔲 Real-time engine streaming
- 🔲 Collaborative AI interactions
- 🔲 Fine-grained entity permissions
- 🔲 Multi-region edge deployment

## Contributing

1. Create a feature branch
2. Make your changes
3. Add tests
4. Run validation: `npm run validate:e2e`
5. Submit a pull request

## Troubleshooting

### Connection Issues

- Verify service is running: `curl http://localhost:3001/health`
- Check WebSocket upgrade is allowed
- Verify JWT token is valid and not expired

### Sync Issues

- Check server logs for errors
- Verify database is accessible
- Check for network latency or packet loss

### Performance Issues

- Monitor active document count
- Check database query performance
- Review connection pool settings

See [Getting Started Guide](./docs/collab/getting-started.md) for more troubleshooting tips.

## License

Proprietary - Olumi

## Support

For questions or issues:
- Check the [documentation](./docs/collab/)
- Review [architecture design](./docs/collab/architecture.md)
- Contact the platform team

---

**Built with:**
- [Yjs](https://github.com/yjs/yjs) - CRDT framework
- [Fastify](https://www.fastify.io/) - Web framework
- [PostgreSQL](https://www.postgresql.org/) - Database
- [React](https://react.dev/) - UI framework
- [TypeScript](https://www.typescriptlang.org/) - Type safety

---

**Status:** Production Ready ✅

Last Updated: 2025-11-22
