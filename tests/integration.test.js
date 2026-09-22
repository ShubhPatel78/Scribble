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

    const waitForMessage = (client, predicate, timeoutMs = 2000) => {
        return new Promise((resolve, reject) => {
            const start = Date.now();
            const check = () => {
                const match = client.messages.find(predicate);
                if (match) return resolve(match);
                if (Date.now() - start > timeoutMs) {
                    console.error('All client messages on timeout:', JSON.stringify(client.messages, null, 2));
                    return reject(new Error(`Timeout waiting for message matching predicate. Received: ${JSON.stringify(client.messages)}`));
                }
                setTimeout(check, 25);
            };
            check();
        });
    };

    t.after(() => {
        clearInterval(heartbeatInterval);
        roomManager.rooms.forEach(room => {
            if (room.game) room.game.clearTimer();
        });
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

    // 4. Test Game Turn Access: Start game in "sprint"
    clientA.messages.length = 0;
    clientB.messages.length = 0;

    // Host (Client A) starts game
    clientA.ws.send(JSON.stringify({ type: 'game:start' }));

    const aWordOptions = await waitForMessage(clientA, m => m.type === 'game:word_options');
    assert.ok(aWordOptions, 'Drawer receives word options');

    // Drawer chooses word
    clientA.ws.send(JSON.stringify({
        type: 'game:choose_word',
        word: aWordOptions.words[0]
    }));

    await waitForMessage(clientB, m => m.type === 'game:state_changed' && m.state === 'DRAWING');

    // Drawer (Client A) draws stroke
    clientA.messages.length = 0;
    clientB.messages.length = 0;

    clientA.ws.send(JSON.stringify({
        type: 'op:commit',
        operation: { id: 'drawer-stroke', type: 'brush', points: [{x: 5, y: 5}, {x: 10, y: 10}], color: '#333', width: 4 }
    }));

    const bReceivedDrawerStroke = await waitForMessage(clientB, m => m.type === 'op:commit' && m.operation.id === 'drawer-stroke');
    assert.ok(bReceivedDrawerStroke, 'Guesser received stroke from active drawer');

    // Non-drawer (Client B / Guesser) tries to draw -> MUST BE BLOCKED BY SERVER
    clientA.messages.length = 0;
    clientB.messages.length = 0;

    clientB.ws.send(JSON.stringify({
        type: 'op:commit',
        operation: { id: 'guesser-illegal-stroke', type: 'brush', points: [{x: 0, y: 0}], color: '#f00', width: 2 }
    }));

    await new Promise(r => setTimeout(r, 200));
    const aReceivedGuesserStroke = clientA.messages.find(m => m.type === 'op:commit' && m.operation.id === 'guesser-illegal-stroke');
    assert.equal(aReceivedGuesserStroke, undefined, 'Server must block non-drawer from committing strokes');

    // Cleanup sockets
    clientA.ws.close();
    clientB.ws.close();
    clientC.ws.close();
});

test('Integration: Session reconnection restores player score and voluntary exit cleans up', async (t) => {
    await new Promise(resolve => server.listen(0, resolve));
    const port = server.address().port;

    const createClient = (roomId, username, sessionId) => {
        return new Promise((resolve, reject) => {
            const sessParam = sessionId ? `&sessionId=${sessionId}` : '';
            const ws = new WebSocket(`ws://localhost:${port}/?room=${roomId}&username=${username}${sessParam}`);
            const messages = [];
            ws.on('message', (data) => messages.push(JSON.parse(data.toString())));
            ws.on('open', () => resolve({ ws, messages }));
            ws.on('error', reject);
        });
    };

    const waitForMessage = (client, predicate, timeoutMs = 2000) => {
        return new Promise((resolve, reject) => {
            const start = Date.now();
            const check = () => {
                const match = client.messages.find(predicate);
                if (match) return resolve(match);
                if (Date.now() - start > timeoutMs) {
                    return reject(new Error(`Timeout waiting for message. Received: ${JSON.stringify(client.messages)}`));
                }
                setTimeout(check, 25);
            };
            check();
        });
    };

    t.after(() => {
        clearInterval(heartbeatInterval);
        roomManager.rooms.forEach(room => {
            if (room.game) room.game.clearTimer();
        });
        server.close();
    });

    const sessionIdA = 'sess_player_alice_123';
    const clientA = await createClient('match1', 'Alice', sessionIdA);
    const clientB = await createClient('match1', 'Bob', 'sess_player_bob_456');

    await waitForMessage(clientA, m => m.type === 'init');
    await waitForMessage(clientB, m => m.type === 'init');

    // Host starts game
    clientA.ws.send(JSON.stringify({ type: 'game:start' }));
    const aWordOptions = await waitForMessage(clientA, m => m.type === 'game:word_options');
    clientA.ws.send(JSON.stringify({ type: 'game:choose_word', word: aWordOptions.words[0] }));

    await waitForMessage(clientB, m => m.type === 'game:state_changed' && m.state === 'DRAWING');

    // Bob guesses the word correctly and scores points
    clientB.ws.send(JSON.stringify({ type: 'chat:message', text: aWordOptions.words[0] }));
    const correctMsg = await waitForMessage(clientB, m => m.type === 'correct_guess');
    assert.ok(correctMsg, 'Bob should get correct guess notification');

    // Get room game instance and verify Bob has score > 0
    const room = roomManager.rooms.get('MATCH1');
    const bobPlayer = Array.from(room.game.players.values()).find(p => p.username === 'Bob');
    assert.ok(bobPlayer && bobPlayer.score > 0, 'Bob has accumulated score');
    const bobScoreBeforeDisconnect = bobPlayer.score;

    // Simulate accidental socket close on Bob's side
    clientB.ws.close();
    await new Promise(r => setTimeout(r, 100));

    // Bob reconnects with same sessionId
    const clientB_reconnect = await createClient('match1', 'Bob', 'sess_player_bob_456');
    const initB = await waitForMessage(clientB_reconnect, m => m.type === 'init');
    assert.ok(initB, 'Bob reconnected and received init');

    // Check game state on reconnect
    assert.ok(initB.game, 'Init payload includes game state');
    const restoredBob = initB.game.players.find(p => p.sessionId === 'sess_player_bob_456');
    assert.ok(restoredBob, 'Bob was found in game player records');
    assert.equal(restoredBob.score, bobScoreBeforeDisconnect, 'Bob preserved his exact score upon reconnection');

    // Test Voluntary Exit: Alice sends game:leave
    clientA.ws.send(JSON.stringify({ type: 'game:leave' }));
    await new Promise(r => setTimeout(r, 100));

    // Assert Alice is removed and Bob is promoted to host
    const aliceInRoom = Array.from(room.game.players.values()).find(p => p.sessionId === sessionIdA);
    assert.equal(aliceInRoom, undefined, 'Alice should be immediately removed after voluntary exit');
    const bInRoom = Array.from(room.game.players.values()).find(p => p.sessionId === 'sess_player_bob_456');
    assert.ok(bInRoom.isHost, 'Bob should be promoted to host after Alice left');

    clientA.ws.close();
    clientB_reconnect.ws.close();
});

