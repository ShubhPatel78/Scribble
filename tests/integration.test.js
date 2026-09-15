const test = require('node:test');
const assert = require('node:assert/strict');
const WebSocket = require('ws');
const { server, roomManager, heartbeatInterval } = require('../server/server');

test('Integration: Two clients sync strokes and isolate rooms', async (t) => {
    // Start server on random free port
    await new Promise(resolve => server.listen(0, resolve));
    const port = server.address().port;

    const createClient = (roomId, username) => {
        return new Promise((resolve, reject) => {
            const ws = new WebSocket(`ws://localhost:${port}/?room=${roomId}&username=${username}`);
            const messages = [];
            ws.on('message', (data) => messages.push(JSON.parse(data.toString())));
            ws.on('open', () => resolve({ ws, messages }));
            ws.on('error', reject);
        });
    };

    const waitForMessage = (client, predicate, timeoutMs = 4000) => {
        return new Promise((resolve, reject) => {
            const start = Date.now();
            const check = () => {
                const match = client.messages.find(predicate);
                if (match) return resolve(match);
                if (Date.now() - start > timeoutMs) {
                    return reject(new Error(`Timeout waiting for message matching predicate: ${JSON.stringify(client.messages)}`));
                }
                setTimeout(check, 25);
            };
            check();
        });
    };

    t.after(() => {
        clearInterval(heartbeatInterval);
        server.close();
    });

    // 1. Connect Client A & Client B to room "sprint"
    const clientA = await createClient('sprint', 'Alice');
    const clientB = await createClient('sprint', 'Bob');

    // Connect Client C to a different room "design"
    const clientC = await createClient('design', 'Charlie');

    // Wait for init messages
    const aInit = await waitForMessage(clientA, m => m.type === 'init');
    const bInit = await waitForMessage(clientB, m => m.type === 'init');
    const cInit = await waitForMessage(clientC, m => m.type === 'init');

    assert.ok(aInit, 'Client A received init');
    assert.ok(bInit, 'Client B received init');
    assert.ok(cInit, 'Client C received init');

    // 2. Client A commits an operation in "sprint"
    clientA.messages.length = 0;
    clientB.messages.length = 0;
    clientC.messages.length = 0;

    const op = {
        id: 'test-stroke-1',
        type: 'rectangle',
        x0: 10, y0: 10, x1: 100, y1: 100,
        color: '#ff0000',
        width: 3
    };

    clientA.ws.send(JSON.stringify({
        type: 'op:commit',
        operation: op
    }));

    // Client B in room "sprint" must receive op:commit
    const bCommit = await waitForMessage(clientB, m => m.type === 'op:commit');
    assert.ok(bCommit, 'Client B should receive commit');
    assert.equal(bCommit.operation.id, 'test-stroke-1');
    assert.equal(bCommit.operation.type, 'rectangle');

    // Client C in room "design" must NOT receive op:commit
    await new Promise(r => setTimeout(r, 150));
    const cCommit = clientC.messages.find(m => m.type === 'op:commit');
    assert.equal(cCommit, undefined, 'Client C in another room must not receive message');

    // 3. Client A undoes their stroke
    clientA.messages.length = 0;
    clientB.messages.length = 0;

    clientA.ws.send(JSON.stringify({ type: 'op:undo' }));

    const bUndo = await waitForMessage(clientB, m => m.type === 'op:undo');
    assert.ok(bUndo, 'Client B should receive undo');
    assert.equal(bUndo.opId, 'test-stroke-1');

    // Cleanup sockets
    clientA.ws.close();
    clientB.ws.close();
    clientC.ws.close();
});
