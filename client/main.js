/**
 * App Controller: Coordinates CanvasEngine, WebSocketClient, and the interactive UI.
 */

document.addEventListener('DOMContentLoaded', () => {
    // 1. Extract Room ID & Username from URL
    const urlParams = new URLSearchParams(window.location.search);
    const hash = window.location.hash ? window.location.hash.substring(1) : null;
    let initialRoom = urlParams.get('room') || hash || 'default';
    let initialUsername = urlParams.get('username') || localStorage.getItem('canvas_username') || '';

    // Elements
    const viewport = document.getElementById('viewport');
    const drawingCanvas = document.getElementById('drawing-canvas');
    const overlayCanvas = document.getElementById('overlay-canvas');

    const roomBadge = document.getElementById('current-room-badge');
    const copyRoomBtn = document.getElementById('copy-room-btn');
    const switchRoomBtn = document.getElementById('switch-room-btn');
    const connectionBadge = document.getElementById('connection-badge');
    const connectionText = document.getElementById('connection-text');
    const avatarStack = document.getElementById('users-avatar-stack');
    const usersCountBadge = document.getElementById('users-count-badge');
    const selfAvatar = document.getElementById('self-avatar');
    const selfName = document.getElementById('self-name');

    const toolBtns = document.querySelectorAll('.tool-btn');
    const primaryColorPicker = document.getElementById('primary-color-picker');
    const colorDots = document.querySelectorAll('.color-dot');
    const sizeBtns = document.querySelectorAll('.size-btn');
    const toggleFillBtn = document.getElementById('toggle-fill-btn');
    const fillStatusText = document.getElementById('fill-status');

    const undoBtn = document.getElementById('undo-btn');
    const redoBtn = document.getElementById('redo-btn');
    const zoomInBtn = document.getElementById('zoom-in-btn');
    const zoomOutBtn = document.getElementById('zoom-out-btn');
    const zoomLevelText = document.getElementById('zoom-level-text');
    const resetViewBtn = document.getElementById('reset-view-btn');
    const exportPngBtn = document.getElementById('export-png-btn');
    const exportJsonBtn = document.getElementById('export-json-btn');
    const clearBoardBtn = document.getElementById('clear-board-btn');

    const roomModal = document.getElementById('room-modal');
    const roomForm = document.getElementById('room-form');
    const roomInput = document.getElementById('room-input');
    const usernameInput = document.getElementById('username-input');
    const modalCancelBtn = document.getElementById('modal-cancel-btn');

    // 2. Initialize Engine & Network Client
    const engine = new CanvasEngine(viewport, drawingCanvas, overlayCanvas);
    const client = new WebSocketClient({
        roomId: initialRoom,
        username: initialUsername
    });

    // In-memory operation history for current room
    let operations = [];
    let currentUserId = null;
    let myUndoneCount = 0;

    roomBadge.textContent = initialRoom;

    // Helper: update undo/redo buttons
    function updateUndoRedoState() {
        const hasMyActiveOps = operations.some(op => op.userId === currentUserId && !op.undone);
        undoBtn.disabled = !hasMyActiveOps;
        redoBtn.disabled = myUndoneCount === 0;
    }

    // Helper: refresh canvas
    function refreshCanvas() {
        engine.redraw(operations);
        updateUndoRedoState();
    }

    engine.onNeedsRedraw = () => {
        engine.redraw(operations);
    };

    // 3. Setup WebSocket Callbacks
    client.onConnectionChange = (connected) => {
        if (connected) {
            connectionBadge.className = 'connection-badge connected';
            connectionText.textContent = 'Connected';
        } else {
            connectionBadge.className = 'connection-badge disconnected';
            connectionText.textContent = 'Reconnecting...';
        }
    };

    client.onInit = (data) => {
        currentUserId = data.clientId;
        client.color = data.color;
        engine.currentColor = data.color;
        primaryColorPicker.value = data.color;

        selfAvatar.style.backgroundColor = data.color;
        selfAvatar.textContent = (data.username || 'U')[0].toUpperCase();
        selfName.textContent = `${data.username} (You)`;
        roomBadge.textContent = data.roomId;

        // Restore snapshot
        operations = (data.snapshot && data.snapshot.operations) ? [...data.snapshot.operations] : [];
        myUndoneCount = 0;
        refreshCanvas();
        updateUserPresence(data.users);
    };

    client.onUserJoined = (user, users) => {
        updateUserPresence(users);
    };

    client.onUserLeft = (userId, users) => {
        engine.remoteCursors.delete(userId);
        engine.remoteLiveStrokes.delete(userId);
        engine.renderOverlay();
        updateUserPresence(users);
    };

    client.onOpCommit = (op) => {
        operations.push(op);
        // Clear remote live stroke for this user
        if (op.userId) {
            engine.remoteLiveStrokes.delete(op.userId);
            engine.renderOverlay();
        }
        refreshCanvas();
    };

    client.onOpUndo = (opId, userId) => {
        const op = operations.find(o => o.id === opId);
        if (op) {
            op.undone = true;
        }
        if (userId === currentUserId) {
            myUndoneCount++;
        }
        refreshCanvas();
    };

    client.onOpRedo = (redoneOp, userId) => {
        const op = operations.find(o => o.id === redoneOp.id);
        if (op) {
            op.undone = false;
        } else {
            operations.push(redoneOp);
        }
        if (userId === currentUserId && myUndoneCount > 0) {
            myUndoneCount--;
        }
        refreshCanvas();
    };

    client.onOpClear = () => {
        operations = [];
        myUndoneCount = 0;
        refreshCanvas();
    };

    client.onLiveStroke = (userId, stroke) => {
        engine.remoteLiveStrokes.set(userId, stroke);
        engine.renderOverlay();
    };

    client.onRemoteCursor = (data) => {
        engine.remoteCursors.set(data.userId, {
            x: data.x,
            y: data.y,
            username: data.username,
            color: data.color
        });
        engine.renderOverlay();
    };

    // User presence renderer
    function updateUserPresence(users = []) {
        avatarStack.innerHTML = '';
        usersCountBadge.textContent = `${users.length} online`;

        users.slice(0, 5).forEach(u => {
            const circle = document.createElement('span');
            circle.className = 'user-circle';
            circle.style.backgroundColor = u.color || '#3B82F6';
            circle.title = u.username || 'User';
            circle.textContent = (u.username || 'U')[0].toUpperCase();
            avatarStack.appendChild(circle);
        });

        if (users.length > 5) {
            const more = document.createElement('span');
            more.className = 'user-circle';
            more.style.backgroundColor = '#64748B';
            more.textContent = `+${users.length - 5}`;
            avatarStack.appendChild(more);
        }
    }

    // 4. Setup Engine Interaction Callbacks
    engine.onCommitOperation = (op) => {
        client.commitOperation(op);
        myUndoneCount = 0; // drawing clears redo
    };

    engine.onLiveStroke = (strokeData) => {
        client.sendLiveStroke(strokeData);
    };

    engine.onCursorMove = (worldX, worldY) => {
        client.sendCursor(worldX, worldY);
    };

    engine.onZoomChange = (zoom) => {
        zoomLevelText.textContent = `${Math.round(zoom * 100)}%`;
    };

    // 5. Tool Selection Handlers
    toolBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            toolBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            const tool = btn.dataset.tool;
            engine.currentTool = tool;

            if (tool === 'pan') {
                viewport.classList.add('panning');
            } else {
                viewport.classList.remove('panning');
            }
        });
    });

    // Color Pickers
    primaryColorPicker.addEventListener('input', (e) => {
        engine.currentColor = e.target.value;
        colorDots.forEach(d => d.classList.remove('active'));
    });

    colorDots.forEach(dot => {
        dot.addEventListener('click', () => {
            colorDots.forEach(d => d.classList.remove('active'));
            dot.classList.add('active');
            const color = dot.dataset.color;
            engine.currentColor = color;
            primaryColorPicker.value = color;
        });
    });

    // Stroke Size Buttons
    sizeBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            sizeBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            engine.currentWidth = parseInt(btn.dataset.size, 10);
        });
    });

    // Shape Fill Toggle
    toggleFillBtn.addEventListener('click', () => {
        engine.isFillEnabled = !engine.isFillEnabled;
        toggleFillBtn.classList.toggle('active', engine.isFillEnabled);
        fillStatusText.textContent = engine.isFillEnabled ? 'On' : 'Off';
    });

    // Bottom Left Controls: Undo, Redo, Zoom
    undoBtn.addEventListener('click', () => client.sendUndo());
    redoBtn.addEventListener('click', () => client.sendRedo());

    zoomInBtn.addEventListener('click', () => engine.setZoom(engine.zoom * 1.2));
    zoomOutBtn.addEventListener('click', () => engine.setZoom(engine.zoom * 0.8));
    resetViewBtn.addEventListener('click', () => engine.resetView());

    // Export & Clear
    exportPngBtn.addEventListener('click', () => {
        const dataUrl = engine.exportPNG();
        const a = document.createElement('a');
        a.href = dataUrl;
        a.download = `canvascollab-${client.roomId}-${Date.now()}.png`;
        a.click();
    });

    exportJsonBtn.addEventListener('click', () => {
        const json = JSON.stringify({
            roomId: client.roomId,
            timestamp: Date.now(),
            operations: operations.filter(o => !o.undone)
        }, null, 2);

        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `canvascollab-${client.roomId}.json`;
        a.click();
        URL.revokeObjectURL(url);
    });

    clearBoardBtn.addEventListener('click', () => {
        if (confirm('Are you sure you want to clear the canvas for all users in this room?')) {
            client.sendClear();
        }
    });

    // Room Sharing & Switching
    copyRoomBtn.addEventListener('click', () => {
        const roomUrl = `${window.location.origin}/?room=${encodeURIComponent(client.roomId)}`;
        navigator.clipboard.writeText(roomUrl).then(() => {
            const originalText = copyRoomBtn.innerHTML;
            copyRoomBtn.innerHTML = '✅ <span class="btn-text">Copied!</span>';
            setTimeout(() => {
                copyRoomBtn.innerHTML = originalText;
            }, 2000);
        }).catch(() => {
            prompt('Copy link to room:', roomUrl);
        });
    });

    switchRoomBtn.addEventListener('click', () => {
        roomInput.value = client.roomId;
        usernameInput.value = client.username;
        roomModal.classList.remove('hidden');
    });

    modalCancelBtn.addEventListener('click', () => {
        roomModal.classList.add('hidden');
    });

    roomForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const targetRoom = roomInput.value.trim().toLowerCase();
        const targetUser = usernameInput.value.trim();

        if (targetRoom) {
            localStorage.setItem('canvas_username', targetUser);
            client.joinRoom(targetRoom, targetUser);
            roomBadge.textContent = targetRoom;

            // Update browser URL query parameter cleanly without reloading
            const newUrl = `${window.location.pathname}?room=${encodeURIComponent(targetRoom)}`;
            window.history.pushState({ room: targetRoom }, '', newUrl);

            roomModal.classList.add('hidden');
        }
    });

    // 6. Global Keyboard Shortcuts
    window.addEventListener('keydown', (e) => {
        if (e.target.tagName === 'INPUT') return;

        // Undo (Ctrl+Z or Cmd+Z)
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) {
            e.preventDefault();
            client.sendUndo();
            return;
        }

        // Redo (Ctrl+Y or Cmd+Shift+Z)
        if (((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') ||
            ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'z')) {
            e.preventDefault();
            client.sendRedo();
            return;
        }

        // Tools
        switch (e.key.toLowerCase()) {
            case 'p':
            case 'b':
                document.querySelector('.tool-btn[data-tool="brush"]')?.click();
                break;
            case 'e':
                document.querySelector('.tool-btn[data-tool="eraser"]')?.click();
                break;
            case 'r':
                document.querySelector('.tool-btn[data-tool="rectangle"]')?.click();
                break;
            case 'o':
            case 'c':
                document.querySelector('.tool-btn[data-tool="circle"]')?.click();
                break;
            case 'l':
                document.querySelector('.tool-btn[data-tool="line"]')?.click();
                break;
            case 'h':
                document.querySelector('.tool-btn[data-tool="pan"]')?.click();
                break;
            case '+':
            case '=':
                engine.setZoom(engine.zoom * 1.2);
                break;
            case '-':
                engine.setZoom(engine.zoom * 0.8);
                break;
            case '0':
                engine.resetView();
                break;
        }
    });

    // Connect WebSocket
    client.connect();
});
