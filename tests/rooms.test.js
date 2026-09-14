const test = require('node:test');
const assert = require('node:assert/strict');
const { RoomManager, generateRoomCode } = require('../server/rooms');

test('generateRoomCode - produces 6-character uppercase codes', () => {
    const code = generateRoomCode();
    assert.equal(typeof code, 'string');
    assert.equal(code.length, 6);
    assert.match(code, /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$/);
});

test('RoomManager - manages multiple isolated rooms', () => {
    const rm = new RoomManager();

    const roomA = rm.getOrCreateRoom('room-a');
    const roomB = rm.getOrCreateRoom('room-b');

    assert.notEqual(roomA, roomB);
    assert.equal(rm.rooms.size, 2);

    roomA.state.addOperation({ id: 'op-a', userId: 'u1', type: 'stroke' });
    assert.equal(roomA.state.getActiveOperations().length, 1);
    assert.equal(roomB.state.getActiveOperations().length, 0); // Room B remains clean
});

test('RoomManager - add and remove clients', () => {
    const rm = new RoomManager();
    const mockWs1 = { readyState: 1, send: () => {} };
    const mockWs2 = { readyState: 1, send: () => {} };

    rm.addClient('alpha', mockWs1, { id: 'user_1', username: 'Alice', color: '#ff0000' });
    rm.addClient('alpha', mockWs2, { id: 'user_2', username: 'Bob', color: '#00ff00' });

    const users = rm.getUsers('alpha');
    assert.equal(users.length, 2);
    assert.equal(users[0].username, 'Alice');
    assert.equal(users[1].username, 'Bob');

    rm.removeClient('alpha', mockWs1);
    assert.equal(rm.getUsers('alpha').length, 1);
});

test('RoomManager - broadcasts scoped only to room members', () => {
    const rm = new RoomManager();
    const messagesA = [];
    const messagesB = [];

    const mockWsA = {
        readyState: 1,
        send: (msg) => messagesA.push(JSON.parse(msg))
    };
    const mockWsB = {
        readyState: 1,
        send: (msg) => messagesB.push(JSON.parse(msg))
    };

    rm.addClient('room-a', mockWsA, { id: 'user_a', username: 'Alice', color: '#ff0000' });
    rm.addClient('room-b', mockWsB, { id: 'user_b', username: 'Bob', color: '#00ff00' });

    rm.broadcast('room-a', { type: 'test:ping', value: 42 });

    assert.equal(messagesA.length, 1);
    assert.equal(messagesA[0].type, 'test:ping');
    assert.equal(messagesB.length, 0); // Room B received nothing
});
