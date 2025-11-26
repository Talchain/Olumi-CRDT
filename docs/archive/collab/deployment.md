# Production Deployment Guide

This guide covers deploying the Olumi collaboration service to production.

## Architecture Overview

```
                    ┌──────────────────┐
                    │   Load Balancer  │
                    │  (Sticky Session)│
                    └────────┬─────────┘
                             │
         ┌───────────────────┼───────────────────┐
         │                   │                   │
    ┌────▼────┐         ┌────▼────┐        ┌────▼────┐
    │ Collab  │         │ Collab  │        │ Collab  │
    │Service 1│         │Service 2│        │Service 3│
    └────┬────┘         └────┬────┘        └────┬────┘
         │                   │                   │
         └───────────────────┼───────────────────┘
                             │
                    ┌────────▼─────────┐
                    │   PostgreSQL     │
                    │   (Primary +     │
                    │    Replica)      │
                    └──────────────────┘
```

## Prerequisites

- Docker and Docker Compose (optional but recommended)
- PostgreSQL 14+ (managed service recommended)
- Node.js 18+ (for non-Docker deployments)
- SSL certificate for HTTPS/WSS
- Load balancer (nginx, AWS ALB, etc.)

## Environment Configuration

### Production Environment Variables

```env
NODE_ENV=production
PORT=3001
HOST=0.0.0.0

# Database - Use connection pooling
DATABASE_URL=postgresql://user:pass@db-host:5432/olumi_collab?sslmode=require&pool_size=20

# Strong JWT secret - generate with: openssl rand -base64 64
JWT_SECRET=<strong-random-secret>
JWT_EXPIRY=1h

# Feature flags
REALTIME_COLLAB=on

# Logging
LOG_LEVEL=info

# Production limits
MAX_CONNECTIONS_PER_USER=10
MAX_CONNECTIONS_PER_ORG=500
MAX_BOARDS_PER_ORG=100
UPDATE_RATE_LIMIT=50
SNAPSHOT_INTERVAL_MS=300000
DOCUMENT_EVICTION_MS=600000

# CORS - Set to your frontend domains
ALLOWED_ORIGINS=https://app.olumi.ai,https://www.olumi.ai

# Metrics
METRICS_ENABLED=true
```

## Docker Deployment

### 1. Build Docker Image

Create `Dockerfile` in `packages/collab-service`:

```dockerfile
FROM node:18-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY tsconfig.json ./

# Install dependencies
RUN npm ci --only=production

# Copy source
COPY src ./src

# Build
RUN npm run build

# Expose port
EXPOSE 3001

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s \
  CMD node -e "require('http').get('http://localhost:3001/health', (r) => r.statusCode === 200 ? process.exit(0) : process.exit(1))"

# Start service
CMD ["npm", "start"]
```

### 2. Build and Push

```bash
cd packages/collab-service
docker build -t olumi-collab-service:latest .
docker tag olumi-collab-service:latest registry.olumi.ai/collab-service:latest
docker push registry.olumi.ai/collab-service:latest
```

### 3. Docker Compose (for testing)

`docker-compose.yml`:

```yaml
version: '3.8'

services:
  postgres:
    image: postgres:14-alpine
    environment:
      POSTGRES_DB: olumi_collab
      POSTGRES_USER: olumi
      POSTGRES_PASSWORD: ${DB_PASSWORD}
    volumes:
      - postgres_data:/var/lib/postgresql/data
    ports:
      - "5432:5432"

  collab-service:
    image: olumi-collab-service:latest
    environment:
      NODE_ENV: production
      PORT: 3001
      DATABASE_URL: postgresql://olumi:${DB_PASSWORD}@postgres:5432/olumi_collab
      JWT_SECRET: ${JWT_SECRET}
      ALLOWED_ORIGINS: ${ALLOWED_ORIGINS}
    ports:
      - "3001:3001"
    depends_on:
      - postgres
    restart: unless-stopped

volumes:
  postgres_data:
```

Run:

```bash
docker-compose up -d
```

## Kubernetes Deployment

### 1. Deployment Manifest

`k8s/deployment.yaml`:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: collab-service
  labels:
    app: collab-service
spec:
  replicas: 3
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 1
      maxUnavailable: 0
  selector:
    matchLabels:
      app: collab-service
  template:
    metadata:
      labels:
        app: collab-service
    spec:
      containers:
      - name: collab-service
        image: registry.olumi.ai/collab-service:latest
        ports:
        - containerPort: 3001
        env:
        - name: NODE_ENV
          value: "production"
        - name: PORT
          value: "3001"
        - name: DATABASE_URL
          valueFrom:
            secretKeyRef:
              name: collab-secrets
              key: database-url
        - name: JWT_SECRET
          valueFrom:
            secretKeyRef:
              name: collab-secrets
              key: jwt-secret
        - name: ALLOWED_ORIGINS
          valueFrom:
            configMapKeyRef:
              name: collab-config
              key: allowed-origins
        livenessProbe:
          httpGet:
            path: /health
            port: 3001
          initialDelaySeconds: 10
          periodSeconds: 30
        readinessProbe:
          httpGet:
            path: /health
            port: 3001
          initialDelaySeconds: 5
          periodSeconds: 10
        resources:
          requests:
            memory: "256Mi"
            cpu: "250m"
          limits:
            memory: "512Mi"
            cpu: "500m"
```

### 2. Service Manifest

`k8s/service.yaml`:

```yaml
apiVersion: v1
kind: Service
metadata:
  name: collab-service
spec:
  type: ClusterIP
  selector:
    app: collab-service
  ports:
  - port: 3001
    targetPort: 3001
    protocol: TCP
  sessionAffinity: ClientIP  # Sticky sessions for WebSocket
```

### 3. Ingress (for WebSocket)

`k8s/ingress.yaml`:

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: collab-ingress
  annotations:
    nginx.ingress.kubernetes.io/websocket-services: collab-service
    nginx.ingress.kubernetes.io/proxy-read-timeout: "3600"
    nginx.ingress.kubernetes.io/proxy-send-timeout: "3600"
    cert-manager.io/cluster-issuer: letsencrypt-prod
spec:
  tls:
  - hosts:
    - collab.olumi.ai
    secretName: collab-tls
  rules:
  - host: collab.olumi.ai
    http:
      paths:
      - path: /
        pathType: Prefix
        backend:
          service:
            name: collab-service
            port:
              number: 3001
```

Deploy:

```bash
kubectl apply -f k8s/
```

## Load Balancer Configuration

### Nginx

```nginx
upstream collab_backend {
    ip_hash;  # Sticky sessions
    server 10.0.1.10:3001;
    server 10.0.1.11:3001;
    server 10.0.1.12:3001;
}

server {
    listen 443 ssl http2;
    server_name collab.olumi.ai;

    ssl_certificate /etc/ssl/certs/olumi.crt;
    ssl_certificate_key /etc/ssl/private/olumi.key;

    # WebSocket configuration
    location / {
        proxy_pass http://collab_backend;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # WebSocket timeout
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
    }
}
```

### AWS Application Load Balancer

1. Enable sticky sessions:
   - Duration: 3600 seconds
   - Type: Application-based cookie

2. Health check:
   - Path: `/health`
   - Interval: 30 seconds
   - Timeout: 5 seconds
   - Healthy threshold: 2
   - Unhealthy threshold: 3

3. Target group attributes:
   - Deregistration delay: 30 seconds
   - Stickiness: Enabled

## Database Configuration

### Connection Pooling

```sql
-- Recommended PostgreSQL settings
ALTER SYSTEM SET max_connections = 100;
ALTER SYSTEM SET shared_buffers = '256MB';
ALTER SYSTEM SET effective_cache_size = '1GB';
ALTER SYSTEM SET work_mem = '16MB';
```

### Replication

Set up read replicas for snapshot queries:

```typescript
// In database/client.ts
const readPool = new Pool({
  connectionString: process.env.READ_REPLICA_URL,
  max: 10,
});

// Use read pool for snapshot queries
async getLatestSnapshot(boardId: string) {
  return readPool.query(/* ... */);
}
```

### Backup

Set up automated backups:

```bash
# Daily backup
0 2 * * * pg_dump -h localhost -U olumi olumi_collab | gzip > /backups/olumi_collab_$(date +\%Y\%m\%d).sql.gz

# Retention (keep 30 days)
find /backups -name "olumi_collab_*.sql.gz" -mtime +30 -delete
```

## Monitoring

### Metrics

Export metrics to Prometheus:

```typescript
// In src/metrics.ts
import { Counter, Gauge, Histogram } from 'prom-client';

export const activeConnections = new Gauge({
  name: 'collab_active_connections',
  help: 'Number of active WebSocket connections',
  labelNames: ['orgId'],
});

export const updateLatency = new Histogram({
  name: 'collab_update_latency_ms',
  help: 'Update propagation latency',
  buckets: [10, 50, 100, 200, 500, 1000],
});

// Expose metrics endpoint
app.get('/metrics', async (req, res) => {
  res.set('Content-Type', register.contentType);
  res.end(await register.metrics());
});
```

### Logging

Use structured logging with correlation IDs:

```typescript
logger.info({
  correlationId: req.id,
  userId: user.id,
  orgId: user.orgId,
  boardId,
  action: 'board_loaded',
  duration: Date.now() - startTime,
});
```

Ship logs to centralized logging (ELK, CloudWatch, etc.).

### Alerting

Set up alerts for:

- High error rate (>5% 5xx errors)
- High latency (p99 > 500ms)
- High connection count (>80% capacity)
- Database connection pool exhaustion
- Memory usage >80%
- Disk usage >80%

## Security

### SSL/TLS

Always use WSS (WebSocket Secure) in production:

```typescript
if (process.env.NODE_ENV === 'production' && !config.serverUrl.startsWith('wss://')) {
  throw new Error('Production requires WSS');
}
```

### Rate Limiting

Implement rate limiting at load balancer and application level:

```nginx
# Nginx rate limiting
limit_req_zone $binary_remote_addr zone=collab:10m rate=10r/s;

location / {
    limit_req zone=collab burst=20 nodelay;
    # ...
}
```

### Secrets Management

Use a secrets manager (AWS Secrets Manager, HashiCorp Vault, etc.):

```typescript
// Load secrets at runtime
const secret = await secretsManager.getSecret('olumi/collab/jwt');
config.jwt.secret = secret;
```

## Scaling

### Horizontal Scaling

The service is stateless (Yjs docs in memory are ephemeral):
- Scale to 3-10 instances
- Use sticky sessions at load balancer
- Each instance can handle ~100-200 active boards

### Vertical Scaling

Resource recommendations per instance:
- CPU: 2-4 cores
- RAM: 2-4 GB
- Disk: 20 GB

### Auto-scaling

Kubernetes HPA example:

```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: collab-service-hpa
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: collab-service
  minReplicas: 3
  maxReplicas: 10
  metrics:
  - type: Resource
    resource:
      name: cpu
      target:
        type: Utilization
        averageUtilization: 70
  - type: Resource
    resource:
      name: memory
      target:
        type: Utilization
        averageUtilization: 80
```

## Disaster Recovery

### Backup Strategy

1. Database: Daily full backup + continuous WAL archiving
2. Yjs updates: Included in database backup
3. Snapshots: Replicated to S3/object storage

### Recovery

To recover from failure:

```bash
# 1. Restore database
psql olumi_collab < backup.sql

# 2. Deploy service
kubectl rollout restart deployment/collab-service

# 3. Verify health
curl https://collab.olumi.ai/health
```

### High Availability

- Deploy across multiple availability zones
- Use managed PostgreSQL with automatic failover
- Set up read replicas for redundancy
- Monitor and alert on service health

## Cost Optimization

1. **Evict inactive documents**: Tune `DOCUMENT_EVICTION_MS`
2. **Prune old updates**: Run cleanup job weekly
3. **Compress snapshots**: Enable PostgreSQL compression
4. **Right-size instances**: Start small, scale as needed
5. **Use spot instances**: For non-critical dev/staging

## Checklist

Before going to production:

- [ ] SSL/TLS configured and tested
- [ ] Strong JWT secret set
- [ ] Database backups automated
- [ ] Monitoring and alerting set up
- [ ] Load balancer configured with sticky sessions
- [ ] Rate limiting enabled
- [ ] CORS properly configured
- [ ] Health checks passing
- [ ] Secrets in secrets manager (not env files)
- [ ] Log aggregation configured
- [ ] Disaster recovery plan documented
- [ ] Performance tested under load
- [ ] Security audit completed
- [ ] Documentation updated

---

For questions or issues, contact the platform team.
