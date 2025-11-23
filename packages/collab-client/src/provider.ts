/**
 * WebSocket provider for Yjs collaboration
 */

import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import * as awarenessProtocol from 'y-protocols/awareness';
import { Awareness } from 'y-protocols/awareness';
import { CollaborationConfig, ConnectionStatus, PresenceState } from './types';

export class CollaborationProvider {
  private ws: WebSocket | null = null;
  private ydoc: Y.Doc;
  private awareness: Awareness;
  private config: CollaborationConfig;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private reconnectTimeout: NodeJS.Timeout | null = null;
  private pingInterval: NodeJS.Timeout | null = null;
  private status: ConnectionStatus = ConnectionStatus.DISCONNECTED;
  private statusListeners: Set<(status: ConnectionStatus) => void> = new Set();
  private awarenessListeners: Set<(states: Map<number, PresenceState>) => void> = new Set();

  constructor(config: CollaborationConfig, ydoc: Y.Doc) {
    this.config = config;
    this.ydoc = ydoc;
    this.awareness = new Awareness(ydoc);

    // Set local awareness state
    this.awareness.setLocalStateField('user', config.currentUser);

    // Listen for local updates to send to server
    this.ydoc.on('update', this.handleLocalUpdate);

    // Listen for awareness changes
    this.awareness.on('change', this.handleAwarenessChange);
  }

  /**
   * Connect to collaboration server
   */
  connect(): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      return; // Already connected
    }

    this.setStatus(ConnectionStatus.CONNECTING);

    const wsUrl = `${this.config.serverUrl}/api/collab/boards/${this.config.boardId}?token=${this.config.authToken}`;

    try {
      this.ws = new WebSocket(wsUrl);

      this.ws.binaryType = 'arraybuffer';

      this.ws.onopen = this.handleOpen;
      this.ws.onmessage = this.handleMessage;
      this.ws.onerror = this.handleError;
      this.ws.onclose = this.handleClose;
    } catch (err) {
      this.handleConnectionError(err as Error);
    }
  }

  /**
   * Disconnect from server
   */
  disconnect(): void {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }

    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    this.setStatus(ConnectionStatus.DISCONNECTED);
  }

  /**
   * Destroy provider
   */
  destroy(): void {
    this.disconnect();
    this.ydoc.off('update', this.handleLocalUpdate);
    this.awareness.off('change', this.handleAwarenessChange);
    this.statusListeners.clear();
    this.awarenessListeners.clear();
  }

  /**
   * Get current connection status
   */
  getStatus(): ConnectionStatus {
    return this.status;
  }

  /**
   * Get awareness states
   */
  getAwarenessStates(): Map<number, PresenceState> {
    return this.awareness.getStates() as Map<number, PresenceState>;
  }

  /**
   * Update local awareness (cursor, selection, etc.)
   */
  updateAwareness(fields: Partial<PresenceState>): void {
    this.awareness.setLocalState({
      ...this.awareness.getLocalState(),
      ...fields,
      lastSeen: Date.now(),
    });
  }

  /**
   * Listen for status changes
   */
  onStatusChange(listener: (status: ConnectionStatus) => void): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  /**
   * Listen for awareness changes
   */
  onAwarenessChange(listener: (states: Map<number, PresenceState>) => void): () => void {
    this.awarenessListeners.add(listener);
    return () => this.awarenessListeners.delete(listener);
  }

  /**
   * Handle WebSocket open
   */
  private handleOpen = (): void => {
    this.reconnectAttempts = 0;
    this.setStatus(ConnectionStatus.CONNECTED);

    // Send sync step 1
    const stateVector = Y.encodeStateVector(this.ydoc);
    const syncMessage = syncProtocol.encodeSyncStep1(stateVector);
    this.send(syncMessage);

    // Send awareness
    const awarenessUpdate = awarenessProtocol.encodeAwarenessUpdate(this.awareness, [
      this.ydoc.clientID,
    ]);
    this.send(awarenessUpdate);

    // Start ping interval
    this.startPingInterval();

    if (this.config.onConnectionChange) {
      this.config.onConnectionChange(true);
    }
  };

  /**
   * Handle incoming message
   */
  private handleMessage = (event: MessageEvent): void => {
    const message = new Uint8Array(event.data);
    const messageType = message[0];

    if (messageType === syncProtocol.messageYjsSyncStep1) {
      // Server sends sync step 1, respond with step 2
      const syncMessage = syncProtocol.encodeSyncStep2(this.ydoc, message);
      this.send(syncMessage);
    } else if (messageType === syncProtocol.messageYjsSyncStep2) {
      // Apply server state
      syncProtocol.readSyncStep2(message, this.ydoc, 'server');
    } else if (messageType === syncProtocol.messageYjsUpdate) {
      // Apply update
      syncProtocol.readSyncMessage(message, this.ydoc, 'server');
    } else if (messageType === awarenessProtocol.messageAwareness) {
      // Apply awareness update
      awarenessProtocol.applyAwarenessUpdate(this.awareness, message, 'server');
    } else if (message[0] === 0x03) {
      // Ping - respond with pong
      const pong = new Uint8Array([0x04, ...message.slice(1)]);
      this.send(pong);
    } else if (message[0] === 0x02) {
      // Control message (JSON)
      try {
        const text = new TextDecoder().decode(message.slice(1));
        const control = JSON.parse(text);
        this.handleControlMessage(control);
      } catch (err) {
        console.error('Failed to parse control message:', err);
      }
    }
  };

  /**
   * Handle control messages
   */
  private handleControlMessage(message: any): void {
    if (message.type === 'error') {
      console.error('Server error:', message.code, message.message);
      if (this.config.onError) {
        this.config.onError(new Error(`${message.code}: ${message.message}`));
      }
    } else if (message.type === 'control') {
      // Handle user joined/left, etc.
      console.log('Control message:', message.action, message.data);
    }
  }

  /**
   * Handle WebSocket error
   */
  private handleError = (event: Event): void => {
    console.error('WebSocket error:', event);
    this.setStatus(ConnectionStatus.ERROR);
  };

  /**
   * Handle WebSocket close
   */
  private handleClose = (event: CloseEvent): void => {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }

    if (this.config.onConnectionChange) {
      this.config.onConnectionChange(false);
    }

    // Check if we should reconnect
    if (event.code >= 4000 && event.code < 5000) {
      // Client error, don't reconnect
      this.setStatus(ConnectionStatus.ERROR);
      if (this.config.onError) {
        this.config.onError(new Error(`Connection closed: ${event.reason}`));
      }
    } else {
      // Network error or server error, try reconnecting
      this.scheduleReconnect();
    }
  };

  /**
   * Handle connection error
   */
  private handleConnectionError(error: Error): void {
    console.error('Connection error:', error);
    this.setStatus(ConnectionStatus.ERROR);

    if (this.config.onError) {
      this.config.onError(error);
    }

    this.scheduleReconnect();
  }

  /**
   * Schedule reconnection
   */
  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.setStatus(ConnectionStatus.ERROR);
      if (this.config.onError) {
        this.config.onError(new Error('Max reconnection attempts reached'));
      }
      return;
    }

    this.setStatus(ConnectionStatus.RECONNECTING);

    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
    this.reconnectAttempts++;

    this.reconnectTimeout = setTimeout(() => {
      console.log(`Reconnect attempt ${this.reconnectAttempts}...`);
      this.connect();
    }, delay);
  }

  /**
   * Handle local document updates
   */
  private handleLocalUpdate = (update: Uint8Array, origin: any): void => {
    if (origin !== 'server' && this.ws && this.ws.readyState === WebSocket.OPEN) {
      const syncMessage = syncProtocol.encodeUpdate(update);
      this.send(syncMessage);
    }
  };

  /**
   * Handle awareness changes
   */
  private handleAwarenessChange = ({ added, updated, removed }: any): void => {
    const changedClients = added.concat(updated).concat(removed);

    if (changedClients.length > 0) {
      // Broadcast to server
      if (changedClients.includes(this.ydoc.clientID)) {
        const awarenessUpdate = awarenessProtocol.encodeAwarenessUpdate(this.awareness, [
          this.ydoc.clientID,
        ]);
        this.send(awarenessUpdate);
      }

      // Notify listeners
      const states = this.awareness.getStates() as Map<number, PresenceState>;
      this.awarenessListeners.forEach((listener) => listener(states));
    }
  };

  /**
   * Send message to server
   */
  private send(message: Uint8Array): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(message);
    }
  }

  /**
   * Start ping interval
   */
  private startPingInterval(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
    }

    this.pingInterval = setInterval(() => {
      const ping = new Uint8Array(9);
      ping[0] = 0x03; // Ping message type
      const now = Date.now();
      new DataView(ping.buffer).setBigUint64(1, BigInt(now));
      this.send(ping);
    }, 15000); // Ping every 15 seconds
  }

  /**
   * Set connection status
   */
  private setStatus(status: ConnectionStatus): void {
    if (this.status !== status) {
      this.status = status;
      this.statusListeners.forEach((listener) => listener(status));
    }
  }
}
