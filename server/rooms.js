const DrawingState = require('./drawing-state');
const { GameEngine } = require('./game-engine');
const { fetchRoomFromDB, saveRoomToDB, updateRoomSnapshotInDB } = require('./supabase');

/**
 * Generates a clean, human-friendly 6-character room code.
 * Omits ambiguous characters like 0, O, 1, I for readability.
 */
function generateRoomCode() {
    const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
    let code = '';
    for (let i = 0; i < 6; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
}

/**
 * RoomManager: Orchestrates multi-tenant isolated collaborative rooms.
 * Manages WebSocket connections, room-scoped state, Supabase persistence,
 * presence tracking, and Scribble game loops.
 */
class RoomManager {
    constructor() {
        this.rooms = new Map(); // roomId/code -> Room object
    }

    /**
     * Sanitizes and normalizes room identifiers.
     */
    normalizeCode(code) {
        if (!code || !String(code).trim()) return generateRoomCode();
        return String(code).trim().toUpperCase();
    }

    /**
     * Creates a new room with a unique code.
     * @param {string} customName
     * @returns {Promise<Object>} Created room metadata
     */
    async createNewRoom(customName = 'Untitled Scribble') {
        let code = generateRoomCode();
        while (this.rooms.has(code)) {
            code = generateRoomCode();
        }

        const room = this.getOrCreateRoom(code, customName);

        // Persist initial record in Supabase
        await saveRoomToDB(code, customName, room.state.getSnapshot());

        return {
            code: room.id,
            name: room.name,
            createdAt: room.createdAt
        };
    }

    /**
     * Gets or creates a room by ID/code.
     * @param {string} roomId
     * @param {string} name
     * @returns {Object} Room instance
     */
    getOrCreateRoom(roomId, name = null) {
        const id = this.normalizeCode(roomId);

        if (!this.rooms.has(id)) {
            const game = new GameEngine();
            const state = new DrawingState();

            const room = {
                id,
                name: name || `Room ${id}`,
                state,
                game,
                clients: new Map(), // ws -> { id, username, color, cursor }
                createdAt: Date.now(),
                cleanupTimer: null,
                saveDbTimer: null,
                isLoadedFromDb: false
            };

            // Wire up game engine event handlers
            game.onBroadcast = (event, payload, excludeWs) => {
                this.broadcast(id, { type: event, ...payload }, excludeWs);
            };

            game.onSend = (userId, event, payload) => {
                this.sendToUser(id, userId, { type: event, ...payload });
            };

            game.onClearCanvas = () => {
                state.clear();
                this.broadcast(id, { type: 'op:clear', userId: 'system' });
            };

            this.rooms.set(id, room);
        }

        const room = this.rooms.get(id);

        // Cancel scheduled disposal if someone reconnected
        if (room.cleanupTimer) {
            clearTimeout(room.cleanupTimer);
            room.cleanupTimer = null;
        }

        return room;
    }

    /**
     * Loads room from Supabase if not loaded yet.
     * @param {string} roomId
     * @returns {Promise<Object>}
     */
    async loadRoomWithPersistence(roomId) {
        const room = this.getOrCreateRoom(roomId);

        if (!room.isLoadedFromDb) {
            room.isLoadedFromDb = true;
            const dbData = await fetchRoomFromDB(room.id);
            if (dbData && dbData.snapshot) {
                room.state.restoreFromSnapshot(dbData.snapshot);
                if (dbData.name) room.name = dbData.name;
                console.log(`📥 Restored room ${room.id} snapshot from Supabase (${room.state.getActiveOperations().length} active operations).`);
            }
        }

        return room;
    }

    /**
     * Schedules a debounced snapshot write to Supabase (saves every 3s after drawing pauses).
     * @param {string} roomId
     */
    scheduleDBSave(roomId) {
        const room = this.rooms.get(this.normalizeCode(roomId));
        if (!room) return;

        if (room.saveDbTimer) {
            clearTimeout(room.saveDbTimer);
        }

        room.saveDbTimer = setTimeout(async () => {
            room.saveDbTimer = null;
            await updateRoomSnapshotInDB(room.id, room.state.getSnapshot());
        }, 3000);

        if (room.saveDbTimer.unref) room.saveDbTimer.unref();
    }

    /**
     * Adds a WebSocket client to a room.
     * @param {string} roomId
     * @param {WebSocket} ws
     * @param {Object} clientInfo { id, username, color }
     * @returns {Object} room
     */
    addClient(roomId, ws, clientInfo) {
        const room = this.getOrCreateRoom(roomId);
        room.clients.set(ws, {
            id: clientInfo.id,
            username: clientInfo.username,
            color: clientInfo.color,
            cursor: null
        });

        if (room.game) {
            room.game.addPlayer(clientInfo);
        }

        return room;
    }

    /**
     * Removes a client from a room.
     * If room becomes empty, saves snapshot to DB and schedules memory cleanup after 10m.
     * @param {string} roomId
     * @param {WebSocket} ws
     * @returns {Object|null} Deleted client metadata
     */
    removeClient(roomId, ws) {
        const room = this.rooms.get(this.normalizeCode(roomId));
        if (!room) return null;

        const clientInfo = room.clients.get(ws);
        room.clients.delete(ws);

        if (clientInfo && room.game) {
            room.game.removePlayer(clientInfo.id);
        }

        if (room.clients.size === 0) {
            if (room.game) room.game.resetToLobby();

            // Immediately sync snapshot to Supabase before idling
            updateRoomSnapshotInDB(room.id, room.state.getSnapshot());

            // Schedule room disposal from memory after 10 minutes of inactivity
            room.cleanupTimer = setTimeout(() => {
                if (room.clients.size === 0) {
                    this.rooms.delete(room.id);
                    console.log(`🧹 Room ${room.id} disposed from memory cache.`);
                }
            }, 10 * 60 * 1000);
            if (room.cleanupTimer.unref) room.cleanupTimer.unref();
        }

        return clientInfo;
    }

    /**
     * Sends a message directly to a specific user by userId in a room.
     */
    sendToUser(roomId, userId, message) {
        const room = this.rooms.get(this.normalizeCode(roomId));
        if (!room) return;

        const payload = JSON.stringify(message);
        room.clients.forEach((info, ws) => {
            if (info.id === userId && ws.readyState === 1 /* OPEN */) {
                try {
                    ws.send(payload);
                } catch (err) {
                    console.error(`[RoomManager] Error sending direct message to ${userId}:`, err);
                }
            }
        });
    }

    /**
     * Broadcasts a JSON payload to all connected clients in the room.
     * @param {string} roomId
     * @param {Object} message
     * @param {WebSocket|null} excludeWs
     */
    broadcast(roomId, message, excludeWs = null) {
        const room = this.rooms.get(this.normalizeCode(roomId));
        if (!room) return;

        const payload = JSON.stringify(message);
        room.clients.forEach((_, ws) => {
            if (ws !== excludeWs && ws.readyState === 1 /* OPEN */) {
                try {
                    ws.send(payload);
                } catch (err) {
                    console.error(`[RoomManager] Error broadcasting to client in room ${roomId}:`, err);
                }
            }
        });
    }

    /**
     * Retrieves sanitized presence list of connected users in a room.
     * @param {string} roomId
     * @returns {Array<Object>}
     */
    getUsers(roomId) {
        const room = this.rooms.get(this.normalizeCode(roomId));
        if (!room) return [];

        return Array.from(room.clients.values()).map(c => ({
            id: c.id,
            username: c.username,
            color: c.color,
            cursor: c.cursor
        }));
    }

    /**
     * Returns operational stats for healthcheck and monitoring.
     */
    getStats() {
        let totalUsers = 0;
        let totalOperations = 0;
        this.rooms.forEach(room => {
            totalUsers += room.clients.size;
            totalOperations += room.state.operations.length;
        });

        return {
            totalRooms: this.rooms.size,
            totalUsers,
            totalOperations
        };
    }
}

module.exports = {
    RoomManager,
    generateRoomCode
};
