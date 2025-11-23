/**
 * Integration tests for multi-client collaboration
 */

import * as Y from 'yjs';
import WebSocket from 'ws';
import * as syncProtocol from 'y-protocols/sync';

describe('Multi-client Collaboration', () => {
  const SERVER_URL = 'ws://localhost:3001';

  // Skip these tests in CI or if server is not running
  const describeIfServerRunning = process.env.CI ? describe.skip : describe;

  describeIfServerRunning('Two clients editing same board', () => {
    let client1: WebSocket;
    let client2: WebSocket;
    let ydoc1: Y.Doc;
    let ydoc2: Y.Doc;

    beforeEach((done) => {
      ydoc1 = new Y.Doc();
      ydoc2 = new Y.Doc();

      // Mock token for testing
      const token = 'test-jwt-token';
      const boardId = 'test-board-' + Date.now();

      client1 = new WebSocket(`${SERVER_URL}/api/collab/boards/${boardId}?token=${token}`);
      client2 = new WebSocket(`${SERVER_URL}/api/collab/boards/${boardId}?token=${token}`);

      let client1Ready = false;
      let client2Ready = false;

      const checkReady = () => {
        if (client1Ready && client2Ready) {
          done();
        }
      };

      client1.on('open', () => {
        client1Ready = true;
        checkReady();
      });

      client2.on('open', () => {
        client2Ready = true;
        checkReady();
      });

      client1.on('message', (data: Buffer) => {
        const message = new Uint8Array(data);
        syncProtocol.readSyncMessage(message, ydoc1, null);
      });

      client2.on('message', (data: Buffer) => {
        const message = new Uint8Array(data);
        syncProtocol.readSyncMessage(message, ydoc2, null);
      });
    });

    afterEach(() => {
      client1.close();
      client2.close();
    });

    it('should sync changes between clients', (done) => {
      // Client 1 makes a change
      ydoc1.transact(() => {
        const map = ydoc1.getMap('board');
        map.set('title', 'Updated by Client 1');
      });

      ydoc1.on('update', (update: Uint8Array) => {
        const syncMessage = syncProtocol.encodeUpdate(update);
        client1.send(syncMessage);
      });

      // Client 2 should receive the change
      ydoc2.on('update', () => {
        const map = ydoc2.getMap('board');
        if (map.get('title') === 'Updated by Client 1') {
          done();
        }
      });
    }, 10000);

    it('should handle concurrent edits without conflicts', (done) => {
      let updatesReceived = 0;

      // Both clients make changes simultaneously
      ydoc1.transact(() => {
        const map = ydoc1.getMap('board');
        map.set('field1', 'Client 1');
      });

      ydoc2.transact(() => {
        const map = ydoc2.getMap('board');
        map.set('field2', 'Client 2');
      });

      const checkConvergence = () => {
        updatesReceived++;

        if (updatesReceived >= 2) {
          // Both documents should have both fields
          const map1 = ydoc1.getMap('board');
          const map2 = ydoc2.getMap('board');

          if (
            map1.get('field1') === 'Client 1' &&
            map1.get('field2') === 'Client 2' &&
            map2.get('field1') === 'Client 1' &&
            map2.get('field2') === 'Client 2'
          ) {
            done();
          }
        }
      };

      ydoc1.on('update', checkConvergence);
      ydoc2.on('update', checkConvergence);
    }, 10000);
  });
});
