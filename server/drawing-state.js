/**
 * DrawingState: Manages event-sourced drawing operations for a canvas room.
 * Supports stroke batching, shape primitives, per-user non-destructive undo/redo,
 * and state snapshotting.
 */

class DrawingState {
    constructor(options = {}) {
        this.maxOperations = options.maxOperations || 5000;
        this.operations = []; // Array of operation objects
        this.undoneOperationsByUser = new Map(); // userId -> Array of operation IDs that were undone
    }

    /**
     * Adds a completed operation (stroke, shape, etc.) to history.
     * @param {Object} op - Operation payload
     * @returns {Object} Added operation
     */
    addOperation(op) {
        if (!op || !op.id) {
            throw new Error('Operation must have a valid id');
        }

        const operation = {
            id: String(op.id),
            userId: String(op.userId || 'anonymous'),
            type: op.type || 'brush', // 'brush' | 'eraser' | 'rectangle' | 'circle' | 'line' | 'fill-bucket'
            color: op.color || '#000000',
            width: typeof op.width === 'number' ? op.width : 3,
            fill: Boolean(op.fill),
            points: Array.isArray(op.points) ? op.points : [],
            x0: op.x0,
            y0: op.y0,
            x1: op.x1,
            y1: op.y1,
            seedX: typeof op.seedX === 'number' ? op.seedX : undefined,
            seedY: typeof op.seedY === 'number' ? op.seedY : undefined,
            timestamp: op.timestamp || Date.now(),
            undone: false
        };

        this.operations.push(operation);

        // When a user draws a new stroke, their redo history is invalidated
        if (this.undoneOperationsByUser.has(operation.userId)) {
            this.undoneOperationsByUser.get(operation.userId).length = 0;
        }

        // Memory budget management: prune oldest when exceeding maxOperations
        if (this.operations.length > this.maxOperations) {
            this.operations.shift();
        }

        return operation;
    }

    /**
     * Undoes the last active operation created by a specific user.
     * Non-destructive: keeps other users' operations intact.
     * @param {string|number} userId
     * @returns {Object|null} The undone operation or null
     */
    undo(userId) {
        const uid = String(userId);

        // Find the last non-undone operation for this user
        for (let i = this.operations.length - 1; i >= 0; i--) {
            const op = this.operations[i];
            if (op.userId === uid && !op.undone) {
                op.undone = true;

                if (!this.undoneOperationsByUser.has(uid)) {
                    this.undoneOperationsByUser.set(uid, []);
                }
                this.undoneOperationsByUser.get(uid).push(op.id);

                return op;
            }
        }
        return null;
    }

    /**
     * Redoes the last undone operation for a specific user.
     * @param {string|number} userId
     * @returns {Object|null} The restored operation or null
     */
    redo(userId) {
        const uid = String(userId);
        const userUndoneStack = this.undoneOperationsByUser.get(uid);

        if (!userUndoneStack || userUndoneStack.length === 0) {
            return null;
        }

        const opId = userUndoneStack.pop();
        const op = this.operations.find(o => o.id === opId);
        if (op) {
            op.undone = false;
            return op;
        }
        return null;
    }

    /**
     * Clears all operations in this drawing state.
     */
    clear() {
        this.operations = [];
        this.undoneOperationsByUser.clear();
    }

    /**
     * Returns all active (non-undone) operations for rendering.
     * @returns {Array<Object>}
     */
    getActiveOperations() {
        return this.operations.filter(op => !op.undone);
    }

    /**
     * Returns full snapshot including state metadata for newly connected clients.
     * @returns {Object}
     */
    getSnapshot() {
        return {
            operations: this.getActiveOperations(),
            totalCount: this.operations.length,
            activeCount: this.operations.filter(op => !op.undone).length,
            timestamp: Date.now()
        };
    }

    /**
     * Restores state from snapshot.
     * @param {Object} snapshot
     */
    restoreFromSnapshot(snapshot) {
        if (snapshot && Array.isArray(snapshot.operations)) {
            this.operations = snapshot.operations.map(op => ({
                ...op,
                undone: false
            }));
            this.undoneOperationsByUser.clear();
        }
    }
}

module.exports = DrawingState;
