# Olumi Collaboration Service

Real-time collaboration service for Olumi decision boards using CRDTs (Yjs).

## Features

- **Real-time collaboration**: Multiple users can edit the same board simultaneously
- **Conflict-free**: CRDT-based automatic conflict resolution
- **Presence awareness**: See who else is editing the board
- **Persistent**: Automatic snapshots and update logging
- **Secure**: Multi-tenant with JWT authentication
- **Scalable**: Handles 10-20 concurrent editors per board

## Getting Started

### Prerequisites

- Node.js >= 18
- PostgreSQL >= 14

### Installation

```bash
npm install
```

### Configuration

Copy `.env.example` to `.env` and configure:

```bash
cp .env.example .env
```

Edit `.env` with your settings.

### Database Setup

The service will automatically create the required tables on first run. Ensure PostgreSQL is running and the `DATABASE_URL` is correct.

### Running

**Development**:
```bash
npm run dev
```

**Production**:
```bash
npm run build
npm start
```

### Testing

```bash
npm test
```

## API Endpoints

### WebSocket

```
ws(s)://[host]/api/collab/boards/:boardId?token={jwt}
```

### REST

- `GET /health` - Health check
- `GET /api/collab/boards/:boardId/snapshot` - Get latest snapshot
- `POST /api/collab/boards/:boardId/snapshot` - Create snapshot
- `GET /api/collab/boards/:boardId/status` - Get collaboration status
- `GET /api/collab/boards/:boardId/run-input` - Get board for engine run

See [API Contracts](../../docs/collab/api-contracts.md) for full documentation.

## Architecture

See [Architecture Documentation](../../docs/collab/architecture.md).

## License

Proprietary - Olumi
