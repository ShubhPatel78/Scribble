const DrawingState = require('./drawing-state');

/**
 * RoomManager: Orchestrates multi-tenant isolated collaborative rooms.
 * Manages WebSocket connections, room-scoped state, and presence tracking.
 */
class RoomManager {
    constructor() {
        this.rooms = new Map(); // roomId -> Room object
    }

    /**
     * Gets or creates a room by ID.
     * @param {string} roomId
     * @returns {Object} Room instance
     */
    getOrCreateRoom(roomId) {
        const id = String(roomId || 'default').trim().toLowerCase() || 'default';

        if (!this.rooms.has(id)) {
            this.rooms.set(id, {
                id,
                state: new DrawingState(),
                clients: new Map(), // ws -> { id, username, color, cursor }
                createdAt: Date.now(),
                cleanupTimer: null
            });
        }

        const room = this.rooms.get(id);

        // Cancel scheduled cleanup if client rejoins
        if (room.cleanupTimer) {
            clearTimeout(room.cleanupTimer);
            room.cleanupTimer = null;
        }

        return room;
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
        return room;
    }

    /**
     * Removes a client from a room.
     * If room becomes empty, schedules cleanup after a grace period.
     * @param {string} roomId
     * @param {WebSocket} ws
     * @returns {Object|null} Deleted client metadata
     */
    removeClient(roomId, ws) {
        const room = this.rooms.get(roomId);
        if (!room) return null;

        const clientInfo = room.clients.get(ws);
        room.clients.delete(ws);

        if (room.clients.size === 0) {
            // Schedule room disposal after 5 minutes of inactivity to conserve memory
            room.cleanupTimer = setTimeout(() => {
                if (room.clients.size === 0) {
                    this.rooms.delete(roomId);
                }
            }, 5 * 60 * 1000);
            if (room.cleanupTimer.unref) room.cleanupTimer.unref();
        }

        return clientInfo;
    }

    /**
     * Broadcasts a JSON payload to all connected clients in the room.
     * @param {string} roomId
     * @param {Object} message
     * @param {WebSocket|null} excludeWs
     */
    broadcast(roomId, message, excludeWs = null) {
        const room = this.rooms.get(roomId);
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
        const room = this.rooms.get(roomId);
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

module.exports = RoomManager;
