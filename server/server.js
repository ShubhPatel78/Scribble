const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const RoomManager = require('./rooms');

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

// Serve static assets from client
app.use(express.static(path.join(__dirname, '../client')));

// Health and metrics endpoint
app.get('/api/health', (req, res) => {
    res.json({
        status: 'ok',
        uptime: process.uptime(),
        timestamp: Date.now(),
        ...roomManager.getStats()
    });
});

// Route /room/:roomId directly to client app
app.get(['/', '/room/:roomId'], (req, res) => {
    res.sendFile(path.join(__dirname, '../client/index.html'));
});

// Ping-pong heartbeat to purge zombie connections
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

wss.on('connection', (ws, req) => {
    ws.isAlive = true;
    ws.on('pong', () => {
        ws.isAlive = true;
    });

    // Parse initial URL query if available
    const parsedUrl = new URL(req.url, 'http://localhost');
    const initialRoomId = (parsedUrl.searchParams.get('room') || 'default').toString().trim().toLowerCase();
    const initialUsername = (parsedUrl.searchParams.get('username') || '').toString().trim();

    const userId = `user_${++globalUserCounter}_${Math.random().toString(36).substring(2, 7)}`;
    const userColor = USER_COLORS[globalUserCounter % USER_COLORS.length];
    let currentRoomId = initialRoomId;
    let username = initialUsername || `Guest ${globalUserCounter}`;

    // Attach client metadata
    const clientInfo = {
        id: userId,
        username,
        color: userColor
    };

    // Join default/specified room
    const room = roomManager.addClient(currentRoomId, ws, clientInfo);

    // Send initial snapshot to joining client
    try {
        ws.send(JSON.stringify({
            type: 'init',
            clientId: userId,
            color: userColor,
            username,
            roomId: currentRoomId,
            snapshot: room.state.getSnapshot(),
            users: roomManager.getUsers(currentRoomId)
        }));
    } catch (err) {
        console.error('[Server] Failed sending init:', err);
    }

    // Broadcast user joined to other clients in the room
    roomManager.broadcast(currentRoomId, {
        type: 'user:joined',
        user: { id: userId, username, color: userColor },
        users: roomManager.getUsers(currentRoomId)
    }, ws);

    ws.on('message', (raw) => {
        try {
            const data = JSON.parse(raw);
            if (!data || !data.type) return;

            const activeRoom = roomManager.getOrCreateRoom(currentRoomId);

            switch (data.type) {
                // Switch / Join new room
                case 'join': {
                    const newRoomId = (data.roomId || 'default').toString().trim().toLowerCase();
                    if (data.username) {
                        username = String(data.username).trim().substring(0, 30);
                        clientInfo.username = username;
                    }

                    if (newRoomId !== currentRoomId) {
                        // Leave old room
                        roomManager.removeClient(currentRoomId, ws);
                        roomManager.broadcast(currentRoomId, {
                            type: 'user:left',
                            userId,
                            users: roomManager.getUsers(currentRoomId)
                        });

                        // Join new room
                        currentRoomId = newRoomId;
                        const newRoom = roomManager.addClient(currentRoomId, ws, clientInfo);

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

                // In-flight live drawing preview (stream of points while pointer is down)
                case 'stroke:live': {
                    roomManager.broadcast(currentRoomId, {
                        type: 'stroke:live',
                        userId,
                        stroke: data.stroke
                    }, ws);
                    break;
                }

                // Final commit of a stroke or shape
                case 'op:commit': {
                    if (!data.operation) break;

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
                    break;
                }

                // Per-user non-destructive undo
                case 'op:undo': {
                    const undoneOp = activeRoom.state.undo(userId);
                    if (undoneOp) {
                        roomManager.broadcast(currentRoomId, {
                            type: 'op:undo',
                            opId: undoneOp.id,
                            userId
                        });
                    }
                    break;
                }

                // Per-user redo
                case 'op:redo': {
                    const redoneOp = activeRoom.state.redo(userId);
                    if (redoneOp) {
                        roomManager.broadcast(currentRoomId, {
                            type: 'op:redo',
                            operation: redoneOp,
                            userId
                        });
                    }
                    break;
                }

                // Clear room canvas
                case 'op:clear': {
                    activeRoom.state.clear();
                    roomManager.broadcast(currentRoomId, {
                        type: 'op:clear',
                        userId
                    });
                    break;
                }

                // Live cursor movement with normalized coordinates
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

                default:
                    console.warn(`[Server] Unhandled message type: ${data.type}`);
            }
        } catch (err) {
            console.error('[Server] Message processing error:', err);
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

