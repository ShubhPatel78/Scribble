/**
 * WebSocketClient: Manages resilient two-way socket communication,
 * room subscriptions, exponential backoff reconnection, and event dispatching.
 */

class WebSocketClient {
    constructor(options = {}) {
        this.roomId = options.roomId || 'default';
        this.username = options.username || '';
        this.ws = null;
        this.clientId = null;
        this.color = '#3B82F6';
        this.isConnected = false;

        // Reconnection configuration
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 10;
        this.reconnectBaseDelay = 1000;
        this.reconnectTimer = null;

        // Outgoing cursor throttling
        this.lastCursorSent = 0;
        this.cursorThrottleMs = 33; // ~30 fps cursor broadcast

        // Event callbacks
        this.onConnectionChange = null; // (connected: boolean) => void
        this.onInit = null; // (data) => void
        this.onUserJoined = null; // (user, users) => void
        this.onUserLeft = null; // (userId, users) => void
        this.onOpCommit = null; // (operation) => void
        this.onOpUndo = null; // (opId, userId) => void
        this.onOpRedo = null; // (operation, userId) => void
        this.onOpClear = null; // (userId) => void
        this.onLiveStroke = null; // (userId, stroke) => void
        this.onRemoteCursor = null; // (cursorData) => void

        // Scribble Game Callbacks
        this.onGameStateChanged = null; // (gameState) => void
        this.onWordOptions = null;      // (data) => void
        this.onSecretWord = null;       // (data) => void
        this.onTimerTick = null;        // (data) => void
        this.onChatMessage = null;      // (message) => void
        this.onGameOver = null;         // (data) => void
    }

    connect() {
        if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
            return;
        }

        // Retrieve or generate persistent session ID for reconnection recovery
        let sessionId = localStorage.getItem('canvas_session_id');
        if (!sessionId) {
            sessionId = 'sess_' + Math.random().toString(36).substring(2, 11) + Date.now().toString(36);
            localStorage.setItem('canvas_session_id', sessionId);
        }
        this.sessionId = sessionId;

        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const params = new URLSearchParams({
            room: this.roomId,
            username: this.username,
            sessionId: this.sessionId
        });
        const wsUrl = `${protocol}//${window.location.host}/?${params.toString()}`;

        try {
            this.ws = new WebSocket(wsUrl);
            this.setupEventHandlers();
        } catch (err) {
            console.error('[WebSocket] Connection initialization failed:', err);
            this.scheduleReconnect();
        }
    }

    setupEventHandlers() {
        this.ws.onopen = () => {
            console.log(`[WebSocket] Connected to room: ${this.roomId}`);
            this.isConnected = true;
            this.reconnectAttempts = 0;
            if (this.onConnectionChange) this.onConnectionChange(true);
        };

        this.ws.onmessage = (event) => {
            try {
                const message = JSON.parse(event.data);
                this.handleMessage(message);
            } catch (err) {
                console.error('[WebSocket] Failed to parse message:', err);
            }
        };

        this.ws.onclose = () => {
            console.log('[WebSocket] Connection closed');
            this.isConnected = false;
            if (this.onConnectionChange) this.onConnectionChange(false);
            this.scheduleReconnect();
        };

        this.ws.onerror = (err) => {
            console.error('[WebSocket] Socket error:', err);
            this.ws.close();
        };
    }

    scheduleReconnect() {
        if (this.reconnectTimer) return;
        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            console.warn('[WebSocket] Reached maximum reconnection attempts.');
            return;
        }

        const delay = Math.min(this.reconnectBaseDelay * Math.pow(1.5, this.reconnectAttempts), 10000);
        this.reconnectAttempts++;
        console.log(`[WebSocket] Reconnecting in ${Math.round(delay)}ms (attempt ${this.reconnectAttempts})...`);

        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            this.connect();
        }, delay);
    }

    handleMessage(data) {
        switch (data.type) {
            case 'init':
                this.clientId = data.clientId;
                this.color = data.color;
                this.username = data.username;
                this.roomId = data.roomId;
                if (this.onInit) this.onInit(data);
                break;

            case 'user:joined':
                if (this.onUserJoined) this.onUserJoined(data.user, data.users);
                break;

            case 'user:left':
                if (this.onUserLeft) this.onUserLeft(data.userId, data.users);
                break;

            case 'op:commit':
                if (this.onOpCommit) this.onOpCommit(data.operation);
                break;

            case 'op:undo':
                if (this.onOpUndo) this.onOpUndo(data.opId, data.userId);
                break;

            case 'op:redo':
                if (this.onOpRedo) this.onOpRedo(data.operation, data.userId);
                break;

            case 'op:clear':
                if (this.onOpClear) this.onOpClear(data.userId);
                break;

            case 'stroke:live':
                if (this.onLiveStroke) this.onLiveStroke(data.userId, data.stroke);
                break;

            case 'cursor':
                if (this.onRemoteCursor) this.onRemoteCursor(data);
                break;

            case 'game:state_changed':
                if (this.onGameStateChanged) this.onGameStateChanged(data);
                break;

            case 'game:word_options':
                if (this.onWordOptions) this.onWordOptions(data);
                break;

            case 'game:secret_word':
                if (this.onSecretWord) this.onSecretWord(data);
                break;

            case 'game:timer_tick':
                if (this.onTimerTick) this.onTimerTick(data);
                break;

            case 'game:over':
                if (this.onGameOver) this.onGameOver(data);
                break;

            case 'chat:message':
            case 'chat':
            case 'system':
            case 'correct_guess':
            case 'close_guess':
                if (this.onChatMessage) {
                    const msg = data.message || data;
                    this.onChatMessage(msg);
                }
                break;

            default:
                console.warn('[WebSocket] Unrecognized payload type:', data.type);
        }
    }

    send(data) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(data));
        }
    }

    sendLeaveGame() {
        this.send({ type: 'game:leave' });
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
        if (this.ws) {
            try {
                this.ws.close();
            } catch (_) {}
        }
    }

    startGame() {
        this.send({ type: 'game:start' });
    }

    updateSettings(settings) {
        this.send({ type: 'game:settings', settings });
    }

    chooseWord(word) {
        this.send({ type: 'game:choose_word', word });
    }

    sendChat(text) {
        if (!text || !text.trim()) return;
        this.send({
            type: 'chat:message',
            text: text.trim()
        });
    }

    joinRoom(newRoomId, newUsername) {
        this.roomId = newRoomId;
        if (newUsername) this.username = newUsername;
        this.send({
            type: 'join',
            roomId: newRoomId,
            username: newUsername
        });
    }

    commitOperation(operation) {
        this.send({
            type: 'op:commit',
            operation
        });
    }

    sendLiveStroke(stroke) {
        this.send({
            type: 'stroke:live',
            stroke
        });
    }

    sendUndo() {
        this.send({ type: 'op:undo' });
    }

    sendRedo() {
        this.send({ type: 'op:redo' });
    }

    sendClear() {
        this.send({ type: 'op:clear' });
    }

    sendCursor(x, y) {
        const now = Date.now();
        if (now - this.lastCursorSent < this.cursorThrottleMs) return;
        this.lastCursorSent = now;

        this.send({
            type: 'cursor',
            x: Math.round(x * 10) / 10,
            y: Math.round(y * 10) / 10
        });
    }
}
