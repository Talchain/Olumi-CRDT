#!/usr/bin/env tsx
/**
 * End-to-end validation script
 * Tests multi-user collaboration with real WebSocket connections
 */

import * as Y from 'yjs';
import WebSocket from 'ws';
import * as syncProtocol from 'y-protocols/sync';
import * as awarenessProtocol from 'y-protocols/awareness';
import { Awareness } from 'y-protocols/awareness';

const SERVER_URL = process.env.SERVER_URL || 'ws://localhost:3001';
const BOARD_ID = 'e2e-test-board-' + Date.now();
const TEST_TOKEN = process.env.TEST_TOKEN || 'test-token';

interface TestResult {
  name: string;
  passed: boolean;
  duration: number;
  error?: string;
}

const results: TestResult[] = [];

function test(name: string, fn: () => Promise<void>): void {
  (async () => {
    const startTime = Date.now();
    try {
      await fn();
      results.push({
        name,
        passed: true,
        duration: Date.now() - startTime,
      });
      console.log(`✓ ${name} (${Date.now() - startTime}ms)`);
    } catch (error) {
      results.push({
        name,
        passed: false,
        duration: Date.now() - startTime,
        error: error instanceof Error ? error.message : String(error),
      });
      console.error(`✗ ${name} (${Date.now() - startTime}ms)`);
      console.error(`  Error: ${error}`);
    }
  })();
}

class TestClient {
  ws: WebSocket;
  ydoc: Y.Doc;
  awareness: Awareness;
  synced = false;
  messages: any[] = [];

  constructor(clientId: string) {
    this.ydoc = new Y.Doc();
    this.awareness = new Awareness(this.ydoc);

    this.awareness.setLocalState({
      user: {
        id: `user-${clientId}`,
        name: `Test User ${clientId}`,
        email: `user${clientId}@test.com`,
        color: '#' + Math.floor(Math.random() * 16777215).toString(16),
      },
    });

    const wsUrl = `${SERVER_URL}/api/collab/boards/${BOARD_ID}?token=${TEST_TOKEN}`;
    this.ws = new WebSocket(wsUrl);
    this.ws.binaryType = 'arraybuffer';

    this.ws.on('message', (data: Buffer) => {
      const message = new Uint8Array(data);
      this.messages.push(message);

      const messageType = message[0];

      if (messageType === syncProtocol.messageYjsSyncStep1) {
        const response = syncProtocol.encodeSyncStep2(this.ydoc, message);
        this.ws.send(response);
      } else if (messageType === syncProtocol.messageYjsSyncStep2) {
        syncProtocol.readSyncStep2(message, this.ydoc, 'server');
        this.synced = true;
      } else if (messageType === syncProtocol.messageYjsUpdate) {
        syncProtocol.readSyncMessage(message, this.ydoc, 'server');
      } else if (messageType === awarenessProtocol.messageAwareness) {
        awarenessProtocol.applyAwarenessUpdate(this.awareness, message, 'server');
      }
    });

    this.ydoc.on('update', (update: Uint8Array, origin: any) => {
      if (origin !== 'server' && this.ws.readyState === WebSocket.OPEN) {
        const syncMessage = syncProtocol.encodeUpdate(update);
        this.ws.send(syncMessage);
      }
    });
  }

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Connection timeout')), 5000);

      this.ws.on('open', () => {
        clearTimeout(timeout);
        // Send sync step 1
        const stateVector = Y.encodeStateVector(this.ydoc);
        const syncMessage = syncProtocol.encodeSyncStep1(stateVector);
        this.ws.send(syncMessage);
        resolve();
      });

      this.ws.on('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });
  }

  async waitForSync(timeoutMs = 5000): Promise<void> {
    const startTime = Date.now();
    while (!this.synced) {
      if (Date.now() - startTime > timeoutMs) {
        throw new Error('Sync timeout');
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  disconnect(): void {
    this.ws.close();
  }
}

async function runTests() {
  console.log('=== Olumi Collaboration E2E Validation ===\n');
  console.log(`Server: ${SERVER_URL}`);
  console.log(`Board: ${BOARD_ID}\n`);

  // Test 1: Single client connection
  await (async () => {
    const startTime = Date.now();
    try {
      const client = new TestClient('1');
      await client.connect();
      await client.waitForSync();

      // Initialize board
      client.ydoc.transact(() => {
        const boardMap = client.ydoc.getMap('board');
        boardMap.set('id', BOARD_ID);
        boardMap.set('orgId', 'test-org');
        boardMap.set('title', 'E2E Test Board');
      });

      // Wait for server to process
      await new Promise((resolve) => setTimeout(resolve, 500));

      const boardMap = client.ydoc.getMap('board');
      if (boardMap.get('title') !== 'E2E Test Board') {
        throw new Error('Board title not set correctly');
      }

      client.disconnect();

      results.push({
        name: 'Single client connection and board initialization',
        passed: true,
        duration: Date.now() - startTime,
      });
      console.log(`✓ Single client connection and board initialization (${Date.now() - startTime}ms)`);
    } catch (error) {
      results.push({
        name: 'Single client connection and board initialization',
        passed: false,
        duration: Date.now() - startTime,
        error: error instanceof Error ? error.message : String(error),
      });
      console.error(`✗ Single client connection (${Date.now() - startTime}ms)`);
      console.error(`  Error: ${error}`);
    }
  })();

  // Test 2: Two clients simultaneous editing
  await (async () => {
    const startTime = Date.now();
    try {
      const client1 = new TestClient('1');
      const client2 = new TestClient('2');

      await Promise.all([client1.connect(), client2.connect()]);
      await Promise.all([client1.waitForSync(), client2.waitForSync()]);

      // Client 1 adds a goal
      client1.ydoc.transact(() => {
        const boardMap = client1.ydoc.getMap('board');
        const goals = boardMap.get('goals') || new Y.Array();
        boardMap.set('goals', goals);

        const goalMap = new Y.Map();
        goalMap.set('id', 'goal-1');
        goalMap.set('content', 'Goal from Client 1');
        goalMap.set('deleted', false);
        goals.push([goalMap]);
      });

      // Wait for propagation
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Client 2 should see the goal
      const boardMap2 = client2.ydoc.getMap('board');
      const goals2 = boardMap2.get('goals') as Y.Array<Y.Map<any>>;

      if (!goals2 || goals2.length === 0) {
        throw new Error('Client 2 did not receive goal from Client 1');
      }

      const goal = goals2.get(0);
      if (goal.get('content') !== 'Goal from Client 1') {
        throw new Error('Goal content mismatch');
      }

      // Client 2 adds a goal
      client2.ydoc.transact(() => {
        const goalMap = new Y.Map();
        goalMap.set('id', 'goal-2');
        goalMap.set('content', 'Goal from Client 2');
        goalMap.set('deleted', false);
        goals2.push([goalMap]);
      });

      // Wait for propagation
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Both clients should have 2 goals
      const goals1 = client1.ydoc.getMap('board').get('goals') as Y.Array<Y.Map<any>>;

      if (goals1.length !== 2 || goals2.length !== 2) {
        throw new Error(`Goal count mismatch: Client1=${goals1.length}, Client2=${goals2.length}`);
      }

      client1.disconnect();
      client2.disconnect();

      results.push({
        name: 'Two clients simultaneous editing',
        passed: true,
        duration: Date.now() - startTime,
      });
      console.log(`✓ Two clients simultaneous editing (${Date.now() - startTime}ms)`);
    } catch (error) {
      results.push({
        name: 'Two clients simultaneous editing',
        passed: false,
        duration: Date.now() - startTime,
        error: error instanceof Error ? error.message : String(error),
      });
      console.error(`✗ Two clients simultaneous editing (${Date.now() - startTime}ms)`);
      console.error(`  Error: ${error}`);
    }
  })();

  // Test 3: Presence/Awareness
  await (async () => {
    const startTime = Date.now();
    try {
      const client1 = new TestClient('1');
      const client2 = new TestClient('2');

      await Promise.all([client1.connect(), client2.connect()]);
      await Promise.all([client1.waitForSync(), client2.waitForSync()]);

      // Send awareness from client1
      const awarenessUpdate = awarenessProtocol.encodeAwarenessUpdate(client1.awareness, [
        client1.ydoc.clientID,
      ]);
      client1.ws.send(awarenessUpdate);

      // Wait for propagation
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Client 2 should see client 1 in awareness
      const states = client2.awareness.getStates();

      let foundClient1 = false;
      for (const [clientId, state] of states.entries()) {
        if ((state as any).user?.id === 'user-1') {
          foundClient1 = true;
          break;
        }
      }

      if (!foundClient1) {
        throw new Error('Client 2 did not receive awareness from Client 1');
      }

      client1.disconnect();
      client2.disconnect();

      results.push({
        name: 'Presence/Awareness synchronization',
        passed: true,
        duration: Date.now() - startTime,
      });
      console.log(`✓ Presence/Awareness synchronization (${Date.now() - startTime}ms)`);
    } catch (error) {
      results.push({
        name: 'Presence/Awareness synchronization',
        passed: false,
        duration: Date.now() - startTime,
        error: error instanceof Error ? error.message : String(error),
      });
      console.error(`✗ Presence/Awareness synchronization (${Date.now() - startTime}ms)`);
      console.error(`  Error: ${error}`);
    }
  })();

  // Print summary
  console.log('\n=== Test Summary ===\n');

  const passed = results.filter((r) => r.passed).length;
  const total = results.length;
  const passRate = (passed / total) * 100;

  console.log(`Total: ${total}`);
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${total - passed}`);
  console.log(`Pass Rate: ${passRate.toFixed(1)}%`);

  if (passRate < 100) {
    console.log('\n=== Failures ===\n');
    results
      .filter((r) => !r.passed)
      .forEach((r) => {
        console.log(`${r.name}:`);
        console.log(`  ${r.error}`);
      });
  }

  process.exit(passRate === 100 ? 0 : 1);
}

runTests().catch((err) => {
  console.error('Validation failed:', err);
  process.exit(1);
});
