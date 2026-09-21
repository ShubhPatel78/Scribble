const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const { RoomManager, generateRoomCode } = require('./rooms');
const { isSupabaseEnabled } = require('./supabase');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const roomManager = new RoomManager();
let globalUserCounter = 0;

const USER_COLORS = [
    '#EF4444', '#F97316', '#F59E0B', '#10B981',
    '#06B6D4', '#3B82F6', '#6366F1', '#8B5CF6',
    '#EC4899', '#14B8A6'
];

app.use(express.json());
app.use(express.static(path.join(__dirname, '../client')));

// -------------------------------------------------------------
// REST API
// -------------------------------------------------------------

// Health check and metrics
app.get('/api/health', (req, res) => {
    res.json({
        status: 'ok',
        uptime: Math.round(process.uptime()),
        timestamp: Date.now(),
        supabaseConnected: isSupabaseEnabled(),
        ...roomManager.getStats()
    });
});

// Create a new room with a 6-character code
app.post('/api/rooms', async (req, res) => {
    try {
        const roomName = req.body.name || 'Untitled Canvas';
        const newRoom = await roomManager.createNewRoom(roomName);

        const protocol = req.headers['x-forwarded-proto'] || req.protocol;
        const host = req.get('host');
        const shareUrl = `${protocol}://${host}/?room=${newRoom.code}`;

        res.status(201).json({
            success: true,
            code: newRoom.code,
            name: newRoom.name,
            url: shareUrl
        });
    } catch (err) {
        console.error('[API] Error creating room:', err);
        res.status(500).json({ error: 'Failed to create room' });
    }
});

// Check if a room exists by code
app.get('/api/rooms/:code', async (req, res) => {
    try {
        const code = req.params.code.trim().toUpperCase();
        const room = await roomManager.loadRoomWithPersistence(code);

        res.json({
            exists: true,
            code: room.id,
            name: room.name,
            userCount: room.clients.size,
            activeOperations: room.state.getActiveOperations().length
        });
    } catch (err) {
        res.status(404).json({ error: 'Room not found' });
    }
});

// Serve client application for room URLs
app.get(['/', '/room/:code'], (req, res) => {
    res.sendFile(path.join(__dirname, '../client/index.html'));
});

// -------------------------------------------------------------
// WebSocket Real-Time Synchronization
// -------------------------------------------------------------

const heartbeatInterval = setInterval(() => {
    wss.clients.forEach(ws => {
        if (ws.isAlive === false) {
            return ws.terminate();
        }
        ws.isAlive = false;
        ws.ping();
    });
}, 30000);

wss.on('close', () => {
    clearInterval(heartbeatInterval);
});

wss.on('connection', async (ws, req) => {
    ws.isAlive = true;
    ws.on('pong', () => {
        ws.isAlive = true;
    });

    const parsedUrl = new URL(req.url, 'http://localhost');
    const rawRoom = parsedUrl.searchParams.get('room');
    const initialRoomCode = (rawRoom && rawRoom.trim()) ? rawRoom.trim().toUpperCase() : generateRoomCode();
    const initialUsername = (parsedUrl.searchParams.get('username') || '').toString().trim();

    const userId = `user_${++globalUserCounter}_${Math.random().toString(36).substring(2, 7)}`;
    const userColor = USER_COLORS[globalUserCounter % USER_COLORS.length];
    let currentRoomId = initialRoomCode;
    let username = initialUsername || `Guest ${globalUserCounter}`;

    const clientInfo = {
        id: userId,
        username,
        color: userColor
    };

    // Load state (from memory or Supabase) and add client
    const room = await roomManager.loadRoomWithPersistence(currentRoomId);
    roomManager.addClient(currentRoomId, ws, clientInfo);

    try {
        ws.send(JSON.stringify({
            type: 'init',
            clientId: userId,
            color: userColor,
            username,
            roomId: currentRoomId,
            snapshot: room.state.getSnapshot(),
            users: roomManager.getUsers(currentRoomId),
            game: {
                state: room.game.state,
                round: room.game.currentRound,
                totalRounds: room.game.totalRounds,
                drawerId: room.game.currentDrawerId,
                drawerName: room.game.players.get(room.game.currentDrawerId)?.username || '',
                wordClue: room.game.getWordClue(),
                wordLength: room.game.currentWord ? room.game.currentWord.replace(/\s/g, '').length : 0,
                timeLeft: room.game.timeLeft,
                players: Array.from(room.game.players.values())
            }
        }));
    } catch (err) {
        console.error('[Server] Failed sending init:', err);
    }

    roomManager.broadcast(currentRoomId, {
        type: 'user:joined',
        user: { id: userId, username, color: userColor },
        users: roomManager.getUsers(currentRoomId)
    }, ws);

    ws.on('message', async (raw) => {
        try {
            const data = JSON.parse(raw);
            if (!data || !data.type) return;

            const activeRoom = roomManager.getOrCreateRoom(currentRoomId);

            switch (data.type) {
                case 'join': {
                    const rawNewRoom = data.roomId ? String(data.roomId).trim().toUpperCase() : '';
                    const newRoomCode = rawNewRoom || generateRoomCode();
                    if (data.username) {
                        username = String(data.username).trim().substring(0, 30);
                        clientInfo.username = username;
                    }

                    if (newRoomCode !== currentRoomId) {
                        roomManager.removeClient(currentRoomId, ws);
                        roomManager.broadcast(currentRoomId, {
                            type: 'user:left',
                            userId,
                            users: roomManager.getUsers(currentRoomId)
                        });

                        currentRoomId = newRoomCode;
                        const newRoom = await roomManager.loadRoomWithPersistence(currentRoomId);
                        roomManager.addClient(currentRoomId, ws, clientInfo);

                        ws.send(JSON.stringify({
                            type: 'init',
                            clientId: userId,
                            color: userColor,
                            username,
                            roomId: currentRoomId,
                            snapshot: newRoom.state.getSnapshot(),
                            users: roomManager.getUsers(currentRoomId)
                        }));

                        roomManager.broadcast(currentRoomId, {
                            type: 'user:joined',
                            user: { id: userId, username, color: userColor },
                            users: roomManager.getUsers(currentRoomId)
                        }, ws);
                    }
                    break;
                }

                case 'game:start': {
                    const result = activeRoom.game.startGame(userId);
                    if (result && result.error) {
                        ws.send(JSON.stringify({
                            type: 'chat:message',
                            message: {
                                type: 'system',
                                text: `⚠️ ${result.error}`,
                                color: '#EF4444'
                            }
                        }));
                    }
                    break;
                }

                case 'game:choose_word': {
                    if (data.word) {
                        activeRoom.game.selectWord(userId, data.word);
                    }
                    break;
                }

                case 'chat:message': {
                    if (data.text) {
                        activeRoom.game.handleChatMessage(userId, data.text);
                    }
                    break;
                }

                case 'stroke:live': {
                    // During active game, only the drawer can draw
                    if (activeRoom.game.state === 'DRAWING' && activeRoom.game.currentDrawerId !== userId) {
                        break;
                    }
                    if (activeRoom.game.state !== 'LOBBY' && activeRoom.game.state !== 'DRAWING') {
                        break;
                    }

                    roomManager.broadcast(currentRoomId, {
                        type: 'stroke:live',
                        userId,
                        stroke: data.stroke
                    }, ws);
                    break;
                }

                case 'op:commit': {
                    if (!data.operation) break;

                    // During active game, only the drawer can commit strokes
                    if (activeRoom.game.state === 'DRAWING' && activeRoom.game.currentDrawerId !== userId) {
                        break;
                    }
                    if (activeRoom.game.state !== 'LOBBY' && activeRoom.game.state !== 'DRAWING') {
                        break;
                    }

                    const op = {
                        ...data.operation,
                        userId,
                        id: data.operation.id || `${userId}-${Date.now()}`
                    };

                    const committed = activeRoom.state.addOperation(op);
                    roomManager.broadcast(currentRoomId, {
                        type: 'op:commit',
                        operation: committed
                    });

                    // Debounced persistent write to Supabase
                    roomManager.scheduleDBSave(currentRoomId);
                    break;
                }

                case 'op:undo': {
                    if (activeRoom.game.state === 'DRAWING' && activeRoom.game.currentDrawerId !== userId) {
                        break;
                    }
                    const undoneOp = activeRoom.state.undo(userId);
                    if (undoneOp) {
                        roomManager.broadcast(currentRoomId, {
                            type: 'op:undo',
                            opId: undoneOp.id,
                            userId
                        });
                        roomManager.scheduleDBSave(currentRoomId);
                    }
                    break;
                }

                case 'op:redo': {
                    if (activeRoom.game.state === 'DRAWING' && activeRoom.game.currentDrawerId !== userId) {
                        break;
                    }
                    const redoneOp = activeRoom.state.redo(userId);
                    if (redoneOp) {
                        roomManager.broadcast(currentRoomId, {
                            type: 'op:redo',
                            operation: redoneOp,
                            userId
                        });
                        roomManager.scheduleDBSave(currentRoomId);
                    }
                    break;
                }

                case 'op:clear': {
                    if (activeRoom.game.state === 'DRAWING' && activeRoom.game.currentDrawerId !== userId) {
                        break;
                    }
                    activeRoom.state.clear();
                    roomManager.broadcast(currentRoomId, {
                        type: 'op:clear',
                        userId
                    });
                    roomManager.scheduleDBSave(currentRoomId);
                    break;
                }

                case 'cursor': {
                    if (typeof data.x === 'number' && typeof data.y === 'number') {
                        const clientRecord = activeRoom.clients.get(ws);
                        if (clientRecord) {
                            clientRecord.cursor = { x: data.x, y: data.y };
                        }

                        roomManager.broadcast(currentRoomId, {
                            type: 'cursor',
                            userId,
                            username,
                            color: userColor,
                            x: data.x,
                            y: data.y
                        }, ws);
                    }
                    break;
                }
            }
        } catch (err) {
            console.error('[Server] Message handling error:', err);
        }
    });

    ws.on('close', () => {
        roomManager.removeClient(currentRoomId, ws);
        roomManager.broadcast(currentRoomId, {
            type: 'user:left',
            userId,
            users: roomManager.getUsers(currentRoomId)
        });
    });

    ws.on('error', (err) => {
        console.error(`[Server] Socket error for user ${userId}:`, err.message);
        roomManager.removeClient(currentRoomId, ws);
        roomManager.broadcast(currentRoomId, {
            type: 'user:left',
            userId,
            users: roomManager.getUsers(currentRoomId)
        });
    });
});

const PORT = process.env.PORT || 3000;

if (require.main === module) {
    server.listen(PORT, () => {
        console.log(`🚀 Collaborative Canvas server running at http://localhost:${PORT}`);
    });
}

module.exports = { app, server, wss, roomManager, heartbeatInterval };
