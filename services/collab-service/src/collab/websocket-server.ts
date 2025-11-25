/**
 * WebSocket server for real-time collaboration
 */

import { Server as WebSocketServer, WebSocket } from 'ws';
import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import * as awarenessProtocol from 'y-protocols/awareness';
import { Awareness } from 'y-protocols/awareness';
import { pino } from 'pino';
import { IncomingMessage } from 'http';
import * as jwt from 'jsonwebtoken';
import { DocumentManager } from './document-manager';
import { DatabaseClient } from '../database/client';
import {
  JWTPayload,
  UserContext,
  EnhancedUserContext,
  createEnhancedUserContext,
  UserRole,
} from '../types/auth';
import { ErrorCode, ControlAction } from '../types/messages';
import { config } from '../config';
import {
  checkBoardAccess,
  checkEditAccess,
  isEditOperation,
  AuthorizationErrors,
} from '../auth/authorization';
import { throttle, TokenBucket } from '../utils/throttle';
import { getMetrics, MetricsTimer } from '../metrics/collector';
import { metricsCollector } from '../facilitation';
import { trackUpdateAsEdit } from '../facilitation/yjs-edit-extractor';

const logger = pino({ level: config.logging.level });
const metrics = getMetrics();

interface ConnectionInfo {
  ws: WebSocket;
  boardId: string;
  userId: string;
  orgId: string;
  teamId: string;
  teamRole: UserRole;
  userName: string;
  userEmail: string;
  userContext: EnhancedUserContext;
  ydoc: Y.Doc;
  awareness: Awareness;
  connectedAt: Date;
  lastPingTime: number;
  updateCount: number;
  rateLimiter: TokenBucket; // Per-connection rate limiting
}

interface BoardConnections {
  connections: Map<WebSocket, ConnectionInfo>;
  awareness: Awareness;
  throttledAwarenessBroadcast: (message: Uint8Array, sender: WebSocket | null) => void;
}

export class CollaborationWebSocketServer {
  private wss: WebSocketServer;
  private documentManager: DocumentManager;
  private db: DatabaseClient;
  private boardConnections: Map<string, BoardConnections> = new Map();
  private connectionsByOrg: Map<string, number> = new Map();
  private connectionsByUser: Map<string, number> = new Map();

  constructor(documentManager: DocumentManager, db: DatabaseClient) {
    this.documentManager = documentManager;
    this.db = db;

    this.wss = new WebSocketServer({ noServer: true });

    this.wss.on('connection', this.handleConnection.bind(this));

    // Start ping interval
    this.startPingInterval();

    logger.info('WebSocket server initialized');
  }

  /**
   * Handle HTTP upgrade to WebSocket
   */
  async handleUpgrade(
    request: IncomingMessage,
    socket: any,
    head: Buffer
  ): Promise<void> {
    try {
      // Extract board ID from URL
      const url = new URL(request.url!, `http://${request.headers.host}`);
      const pathParts = url.pathname.split('/');
      const boardId = pathParts[pathParts.length - 1];

      if (!boardId || boardId.length === 0) {
        socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
        socket.destroy();
        return;
      }

      // Extract and verify token
      const token = url.searchParams.get('token');

      if (!token) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }

      const userContext = await this.verifyToken(token);

      if (!userContext) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }

      // Check feature flag
      if (config.features.realtimeCollab === 'off') {
        socket.write('HTTP/1.1 503 Service Unavailable\r\n\r\n');
        socket.destroy();
        return;
      }

      // Check board access
      const hasAccess = await this.checkBoardAccess(boardId, userContext);

      if (!hasAccess) {
        socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
        socket.destroy();
        return;
      }

      // Check rate limits
      if (!this.checkRateLimits(userContext)) {
        socket.write('HTTP/1.1 429 Too Many Requests\r\n\r\n');
        socket.destroy();
        return;
      }

      // Store context for handleConnection
      (request as any).boardId = boardId;
      (request as any).userContext = userContext;

      // Upgrade connection
      this.wss.handleUpgrade(request, socket, head, (ws) => {
        this.wss.emit('connection', ws, request);
      });
    } catch (err) {
      logger.error({ err }, 'Upgrade failed');
      socket.write('HTTP/1.1 500 Internal Server Error\r\n\r\n');
      socket.destroy();
    }
  }

  /**
   * Handle new WebSocket connection
   */
  private async handleConnection(ws: WebSocket, request: IncomingMessage): Promise<void> {
    const boardId = (request as any).boardId;
    const userContext: UserContext = (request as any).userContext;

    try {
      logger.info(
        { boardId, userId: userContext.userId, orgId: userContext.orgId },
        'Client connecting'
      );

      // Load board to get team context
      const board = await this.db.getBoard(boardId);
      if (!board) {
        this.sendError(ws, ErrorCode.NOT_FOUND, 'Board not found');
        ws.close();
        return;
      }

      // Create enhanced user context
      const enhancedContext = createEnhancedUserContext(userContext);

      // Get user's role for this board's team
      const teamRole = enhancedContext.getTeamRole(board.teamId);
      if (!teamRole) {
        this.sendError(ws, ErrorCode.FORBIDDEN, 'Not a member of this team');
        ws.close();
        return;
      }

      // Load Yjs document
      const ydoc = await this.documentManager.getDocument(boardId, userContext.orgId);

      // Get or create board connections
      let boardConns = this.boardConnections.get(boardId);

      if (!boardConns) {
        const awareness = new Awareness(ydoc);

        // Create throttled awareness broadcast function (50ms throttle)
        const throttledBroadcast = throttle(
          (message: Uint8Array, sender: WebSocket | null) => {
            this.broadcastAwareness(boardId, message, sender);
          },
          50 // 50ms throttle - max 20 updates/second
        );

        boardConns = {
          connections: new Map(),
          awareness,
          throttledAwarenessBroadcast: throttledBroadcast,
        };
        this.boardConnections.set(boardId, boardConns);

        // Set up awareness broadcasting with throttling
        awareness.on('update', ({ added, updated, removed }: any) => {
          const changedClients = added.concat(updated).concat(removed);
          const awarenessUpdate = awarenessProtocol.encodeAwarenessUpdate(
            awareness,
            changedClients
          );
          throttledBroadcast(awarenessUpdate, null);

          // Track awareness updates
          metrics.incrementCounter('collab.awareness.updates', {
            boardId,
            orgId,
          });
        });
      }

      // Create connection info
      const connInfo: ConnectionInfo = {
        ws,
        boardId,
        userId: userContext.userId,
        orgId: userContext.orgId,
        teamId: board.teamId,
        teamRole,
        userName: userContext.email.split('@')[0], // Simple name from email
        userEmail: userContext.email,
        userContext: enhancedContext,
        ydoc,
        awareness: boardConns.awareness,
        connectedAt: new Date(),
        lastPingTime: Date.now(),
        updateCount: 0,
        rateLimiter: new TokenBucket(
          300, // capacity: 300 tokens
          5,   // refill rate: 5 tokens per second
          1000 // refill interval: 1000ms
        ), // Allows bursts up to 300 messages, sustained rate of 300/min
      };

      boardConns.connections.set(ws, connInfo);

      // Update connection counts
      this.connectionsByOrg.set(
        userContext.orgId,
        (this.connectionsByOrg.get(userContext.orgId) || 0) + 1
      );
      this.connectionsByUser.set(
        userContext.userId,
        (this.connectionsByUser.get(userContext.userId) || 0) + 1
      );

      // Track connection metrics
      metrics.incrementCounter('collab.connections.total', {
        boardId,
        orgId: userContext.orgId,
      });
      metrics.setGauge('collab.connections.active', boardConns.connections.size, {
        boardId,
        orgId: userContext.orgId,
      });
      metrics.setGauge('collab.connections.by_org', this.connectionsByOrg.get(userContext.orgId) || 0, {
        orgId: userContext.orgId,
      });

      // Set up message handler
      ws.on('message', (data: Buffer) => this.handleMessage(ws, connInfo, data));

      // Set up close handler
      ws.on('close', () => this.handleClose(ws, connInfo));

      // Set up error handler
      ws.on('error', (err) => {
        logger.error({ err, boardId, userId: userContext.userId }, 'WebSocket error');
      });

      // Send initial sync
      const syncMessage = syncProtocol.encodeSyncStep1(ydoc);
      ws.send(syncMessage);

      // Send awareness state
      const awarenessStates = awarenessProtocol.encodeAwarenessUpdate(
        boardConns.awareness,
        Array.from(boardConns.awareness.getStates().keys())
      );
      ws.send(awarenessStates);

      // Broadcast user joined
      this.broadcastControl(boardId, ControlAction.USER_JOINED, {
        userId: userContext.userId,
        userName: connInfo.userName,
        timestamp: new Date().toISOString(),
      });

      logger.info(
        { boardId, userId: userContext.userId, connections: boardConns.connections.size },
        'Client connected'
      );
    } catch (err) {
      logger.error({ err, boardId }, 'Connection handling failed');
      this.sendError(ws, ErrorCode.SERVER_ERROR, 'Connection failed');
      ws.close();
    }
  }

  /**
   * Handle incoming message
   */
  private handleMessage(ws: WebSocket, connInfo: ConnectionInfo, data: Buffer): void {
    const timer = new MetricsTimer('collab.message.processing', {
      boardId: connInfo.boardId,
      orgId: connInfo.orgId,
    });

    try {
      const message = new Uint8Array(data);
      const messageType = message[0];

      // Rate limiting
      if (!connInfo.rateLimiter.tryConsume(1)) {
        this.sendError(
          ws,
          ErrorCode.RATE_LIMIT_EXCEEDED,
          'Rate limit exceeded. Please slow down.',
          { tokensRemaining: connInfo.rateLimiter.getTokenCount() }
        );
        metrics.incrementCounter('collab.rate_limit.exceeded', {
          boardId: connInfo.boardId,
          userId: connInfo.userId,
        });
        logger.warn(
          { userId: connInfo.userId, boardId: connInfo.boardId },
          'Rate limit exceeded'
        );
        timer.stop();
        return;
      }

      // Track message received
      metrics.incrementCounter('collab.messages.received', {
        boardId: connInfo.boardId,
        orgId: connInfo.orgId,
      });

      // Check if this is an edit operation and user has permission
      if (isEditOperation(messageType)) {
        if (connInfo.teamRole === UserRole.VIEWER) {
          this.sendError(
            ws,
            ErrorCode.FORBIDDEN,
            AuthorizationErrors.VIEWER_CANNOT_EDIT,
            { role: connInfo.teamRole }
          );
          logger.warn(
            { userId: connInfo.userId, boardId: connInfo.boardId, role: connInfo.teamRole },
            'Viewer attempted edit operation'
          );
          metrics.incrementCounter('collab.authorization.denied', {
            boardId: connInfo.boardId,
            userId: connInfo.userId,
          });
          timer.stop();
          return;
        }
      }

      if (messageType === syncProtocol.messageYjsSyncStep1) {
        // Sync step 1: client sends state vector
        const syncMessage = syncProtocol.encodeSyncStep2(connInfo.ydoc, message);
        ws.send(syncMessage);
      } else if (messageType === syncProtocol.messageYjsSyncStep2) {
        // Sync step 2: apply server state
        syncProtocol.readSyncStep2(message, connInfo.ydoc, null);
      } else if (messageType === syncProtocol.messageYjsUpdate) {
        // Update: apply and broadcast
        connInfo.updateCount++;
        syncProtocol.readSyncMessage(message, connInfo.ydoc, null);

        // Track edit for session health (K.1)
        try {
          const edit = trackUpdateAsEdit(
            connInfo.boardId,
            connInfo.userId,
            message.length
          );
          metricsCollector.recordEdit(edit);
        } catch (err) {
          // Non-critical - don't fail the update
          logger.debug({ err }, 'Failed to track edit for health metrics');
        }

        // Broadcast to other clients
        this.broadcastUpdate(connInfo.boardId, message, ws);
      } else if (messageType === awarenessProtocol.messageAwareness) {
        // Awareness update (allowed for all roles)
        awarenessProtocol.applyAwarenessUpdate(
          connInfo.awareness,
          message,
          connInfo
        );
      } else if (message[0] === 0x03) {
        // Ping
        connInfo.lastPingTime = Date.now();
        const pong = new Uint8Array([0x04, ...message.slice(1)]);
        ws.send(pong);
      } else {
        logger.warn({ messageType, boardId: connInfo.boardId }, 'Unknown message type');
      }

      // Stop timer on successful processing
      timer.stop();
    } catch (err) {
      timer.stop();
      logger.error({ err, boardId: connInfo.boardId }, 'Message handling failed');
      this.sendError(ws, ErrorCode.INVALID_MESSAGE, 'Invalid message format');
      metrics.incrementCounter('collab.messages.errors', {
        boardId: connInfo.boardId,
        orgId: connInfo.orgId,
      });
    }
  }

  /**
   * Handle connection close
   */
  private handleClose(ws: WebSocket, connInfo: ConnectionInfo): void {
    logger.info(
      { boardId: connInfo.boardId, userId: connInfo.userId, updateCount: connInfo.updateCount },
      'Client disconnected'
    );

    const boardConns = this.boardConnections.get(connInfo.boardId);

    if (boardConns) {
      boardConns.connections.delete(ws);

      // Remove from awareness
      const awarenessUpdate = awarenessProtocol.encodeAwarenessUpdate(
        connInfo.awareness,
        [connInfo.ydoc.clientID],
        new Map()
      );
      this.broadcastAwareness(connInfo.boardId, awarenessUpdate, null);

      // Broadcast user left
      this.broadcastControl(connInfo.boardId, ControlAction.USER_LEFT, {
        userId: connInfo.userId,
        userName: connInfo.userName,
        timestamp: new Date().toISOString(),
      });

      // Clean up if no more connections
      if (boardConns.connections.size === 0) {
        this.boardConnections.delete(connInfo.boardId);
        this.documentManager.releaseDocument(connInfo.boardId);
      }
    }

    // Update connection counts
    const orgCount = this.connectionsByOrg.get(connInfo.orgId) || 0;
    if (orgCount <= 1) {
      this.connectionsByOrg.delete(connInfo.orgId);
    } else {
      this.connectionsByOrg.set(connInfo.orgId, orgCount - 1);
    }

    const userCount = this.connectionsByUser.get(connInfo.userId) || 0;
    if (userCount <= 1) {
      this.connectionsByUser.delete(connInfo.userId);
    } else {
      this.connectionsByUser.set(connInfo.userId, userCount - 1);
    }
  }

  /**
   * Broadcast update to all clients except sender
   */
  private broadcastUpdate(boardId: string, message: Uint8Array, sender: WebSocket | null): void {
    const boardConns = this.boardConnections.get(boardId);
    if (!boardConns) return;

    for (const [ws, connInfo] of boardConns.connections.entries()) {
      if (ws !== sender && ws.readyState === WebSocket.OPEN) {
        ws.send(message);
      }
    }
  }

  /**
   * Broadcast awareness update
   */
  private broadcastAwareness(
    boardId: string,
    message: Uint8Array,
    sender: WebSocket | null
  ): void {
    const boardConns = this.boardConnections.get(boardId);
    if (!boardConns) return;

    for (const [ws] of boardConns.connections.entries()) {
      if (ws !== sender && ws.readyState === WebSocket.OPEN) {
        ws.send(message);
      }
    }
  }

  /**
   * Broadcast control message
   */
  private broadcastControl(boardId: string, action: ControlAction, data: any): void {
    const boardConns = this.boardConnections.get(boardId);
    if (!boardConns) return;

    const message = JSON.stringify({
      type: 'control',
      action,
      data,
    });

    for (const [ws] of boardConns.connections.entries()) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(message);
      }
    }
  }

  /**
   * Broadcast comment event to all connected clients
   * TODO: Add permission filtering based on entity visibility
   */
  public broadcastCommentEvent(
    boardId: string,
    event: import('../types/comments').CommentEvent
  ): void {
    const boardConns = this.boardConnections.get(boardId);
    if (!boardConns) return;

    const message = JSON.stringify({
      type: 'comment_event',
      event,
    });

    // SECURITY TODO: Filter by element visibility permissions
    // For now, broadcast to all connections (comments follow board access)
    for (const [ws] of boardConns.connections.entries()) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(message);
      }
    }
  }

  /**
   * SECURITY FIX: Broadcast message to board with visibility filtering
   * Only sends messages to connections that have permission to view the element
   *
   * @param boardId - The board ID
   * @param data - Data to broadcast (should include elementId if element-specific)
   */
  public async broadcastToBoard(boardId: string, data: any): Promise<void> {
    const boardConns = this.boardConnections.get(boardId);
    if (!boardConns) return;

    const message = JSON.stringify(data);

    // If data contains elementId, filter by visibility permissions
    if (data.elementId) {
      const visibilityManager = this.documentManager.visibilityManager;

      for (const [ws, connInfo] of boardConns.connections.entries()) {
        if (ws.readyState !== WebSocket.OPEN) continue;

        try {
          // Check if this connection's user can view the element
          const canView = await visibilityManager.canViewElement(
            boardId,
            data.elementId,
            connInfo.userId,
            connInfo.teamRole
          );

          if (canView.can_view) {
            ws.send(message);
          } else {
            logger.debug(
              {
                boardId,
                elementId: data.elementId,
                userId: connInfo.userId,
                reason: 'No permission to view element',
              },
              'Filtered broadcast for connection without permission'
            );
          }
        } catch (err) {
          logger.error(
            { err, boardId, elementId: data.elementId, userId: connInfo.userId },
            'Error checking visibility for broadcast'
          );
          // On error, don't send (fail closed)
        }
      }
    } else {
      // No elementId, broadcast to all connections (board-level event)
      for (const [ws] of boardConns.connections.entries()) {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(message);
        }
      }
    }
  }

  /**
   * Send error to client
   */
  private sendError(ws: WebSocket, code: ErrorCode, message: string, details?: any): void {
    const errorMessage = JSON.stringify({
      type: 'error',
      code,
      message,
      details,
    });

    if (ws.readyState === WebSocket.OPEN) {
      ws.send(errorMessage);
    }
  }

  /**
   * Verify JWT token
   */
  private async verifyToken(token: string): Promise<UserContext | null> {
    try {
      const payload = jwt.verify(token, config.jwt.secret) as JWTPayload;

      // TODO: Extract team memberships from JWT payload
      // For now, fetch from database or use mock data
      // In production, JWT should include: { teamMemberships: [{ teamId, role }] }
      const teamMemberships = await this.getUserTeamMemberships(payload.userId, payload.orgId);

      return {
        userId: payload.userId,
        orgId: payload.orgId,
        email: payload.email,
        roles: payload.roles,
        teamMemberships,
      };
    } catch (err) {
      logger.warn({ err }, 'Token verification failed');
      return null;
    }
  }

  /**
   * Get user's team memberships
   * TODO: Replace with actual team membership service call or JWT extraction
   */
  private async getUserTeamMemberships(
    userId: string,
    orgId: string
  ): Promise<Array<{ teamId: string; role: UserRole }>> {
    try {
      // TODO: Call team membership service or extract from JWT
      // For now, return default membership (all teams in org with EDITOR role)
      // This is a temporary implementation until team service is integrated

      const memberships = await this.db.getUserTeamMemberships(userId, orgId);
      return memberships;
    } catch (err) {
      logger.warn({ err, userId, orgId }, 'Failed to get team memberships, using defaults');
      // Fallback: assume user has access to all teams in their org as EDITOR
      return [];
    }
  }

  /**
   * Check board access with enhanced team-based authorization
   */
  private async checkBoardAccess(boardId: string, userContext: UserContext): Promise<boolean> {
    try {
      const board = await this.db.getBoard(boardId);

      if (!board) {
        // Board doesn't exist yet - allow creation if user has team membership
        // TODO: Validate teamId from creation request
        return userContext.teamMemberships.length > 0;
      }

      // Create enhanced user context for authorization
      const enhancedContext = createEnhancedUserContext(userContext);

      // Check authorization (requires at least VIEWER role)
      const authResult = checkBoardAccess(board, enhancedContext, UserRole.VIEWER);

      if (!authResult.authorized) {
        logger.warn(
          { boardId, userId: userContext.userId, reason: authResult.reason },
          'Board access denied'
        );
      }

      return authResult.authorized;
    } catch (err) {
      logger.error({ err, boardId }, 'Access check failed');
      return false;
    }
  }

  /**
   * Check rate limits
   */
  private checkRateLimits(userContext: UserContext): boolean {
    const userConnections = this.connectionsByUser.get(userContext.userId) || 0;
    if (userConnections >= config.limits.maxConnectionsPerUser) {
      logger.warn(
        { userId: userContext.userId, connections: userConnections },
        'User connection limit exceeded'
      );
      return false;
    }

    const orgConnections = this.connectionsByOrg.get(userContext.orgId) || 0;
    if (orgConnections >= config.limits.maxConnectionsPerOrg) {
      logger.warn(
        { orgId: userContext.orgId, connections: orgConnections },
        'Organization connection limit exceeded'
      );
      return false;
    }

    return true;
  }

  /**
   * Start ping interval to keep connections alive
   */
  private startPingInterval(): void {
    setInterval(() => {
      const now = Date.now();
      const timeout = 30000; // 30 seconds

      for (const boardConns of this.boardConnections.values()) {
        for (const [ws, connInfo] of boardConns.connections.entries()) {
          if (now - connInfo.lastPingTime > timeout) {
            // Connection timed out
            logger.warn(
              { boardId: connInfo.boardId, userId: connInfo.userId },
              'Connection timeout'
            );
            ws.close();
          } else if (ws.readyState === WebSocket.OPEN) {
            // Send ping
            const ping = new Uint8Array([0x03, ...new Uint8Array(8)]);
            new DataView(ping.buffer).setBigUint64(1, BigInt(now));
            ws.send(ping);
          }
        }
      }
    }, 15000); // Ping every 15 seconds
  }

  /**
   * Get server metrics
   */
  getMetrics() {
    let totalConnections = 0;
    let totalBoards = this.boardConnections.size;

    for (const boardConns of this.boardConnections.values()) {
      totalConnections += boardConns.connections.size;
    }

    return {
      totalConnections,
      totalBoards,
      connectionsByOrg: Object.fromEntries(this.connectionsByOrg),
      connectionsByUser: Object.fromEntries(this.connectionsByUser),
    };
  }

  /**
   * Get board status
   */
  getBoardStatus(boardId: string) {
    const boardConns = this.boardConnections.get(boardId);

    if (!boardConns) {
      return {
        isActive: false,
        connectedUsers: [],
      };
    }

    const connectedUsers = Array.from(boardConns.connections.values()).map((conn) => ({
      userId: conn.userId,
      userName: conn.userName,
      connectedAt: conn.connectedAt.toISOString(),
    }));

    return {
      isActive: true,
      connectedUsers,
    };
  }

  /**
   * Shutdown server
   */
  async shutdown(): Promise<void> {
    logger.info('Shutting down WebSocket server');

    // Close all connections
    for (const boardConns of this.boardConnections.values()) {
      for (const [ws] of boardConns.connections.entries()) {
        ws.close(1001, 'Server shutting down');
      }
    }

    this.wss.close();

    logger.info('WebSocket server shutdown complete');
  }
}
