/**
 * App Controller: Coordinates CanvasEngine, WebSocketClient, and the interactive UI.
 */

document.addEventListener('DOMContentLoaded', () => {
    // Helper to generate 6-character room code (avoiding ambiguous chars)
    function generateRoomCode(len = 6) {
        const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
        let code = '';
        for (let i = 0; i < len; i++) {
            code += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return code;
    }

    // 1. Extract Room Code & Username from URL
    const urlParams = new URLSearchParams(window.location.search);
    const hash = window.location.hash ? window.location.hash.substring(1) : null;
    let pathRoom = null;
    if (window.location.pathname.startsWith('/room/')) {
        pathRoom = window.location.pathname.replace('/room/', '').trim();
    }

    let initialRoom = (urlParams.get('room') || pathRoom || hash || '').trim().toUpperCase();

    // If no room is specified in URL, generate a fresh unique 6-character room code
    if (!initialRoom) {
        initialRoom = generateRoomCode(6);
        const newUrl = `${window.location.pathname}?room=${encodeURIComponent(initialRoom)}`;
        window.history.replaceState({ room: initialRoom }, '', newUrl);
    } else if (!urlParams.get('room')) {
        // Normalize URL to ?room=CODE
        const newUrl = `/?room=${encodeURIComponent(initialRoom)}`;
        window.history.replaceState({ room: initialRoom }, '', newUrl);
    }

    let initialUsername = urlParams.get('username') || localStorage.getItem('canvas_username') || '';

    // DOM Elements
    const viewport = document.getElementById('viewport');
    const drawingCanvas = document.getElementById('drawing-canvas');
    const overlayCanvas = document.getElementById('overlay-canvas');

    const roomBadge = document.getElementById('current-room-badge');
    const copyCodeBtn = document.getElementById('copy-code-btn');
    const copyRoomBtn = document.getElementById('copy-room-btn');
    const newRoomBtn = document.getElementById('new-room-btn');
    const joinRoomBtn = document.getElementById('join-room-btn');

    const connectionBadge = document.getElementById('connection-badge');
    const connectionText = document.getElementById('connection-text');
    const avatarStack = document.getElementById('users-avatar-stack');
    const usersCountBadge = document.getElementById('users-count-badge');
    const selfAvatar = document.getElementById('self-avatar');
    const selfName = document.getElementById('self-name');

    const toolBtns = document.querySelectorAll('.tool-btn');
    const primaryColorPicker = document.getElementById('primary-color-picker');
    const colorDots = document.querySelectorAll('.color-dot');
    const strokeSizeSlider = document.getElementById('stroke-size-slider');
    const sizeLabel = document.getElementById('size-label');
    const sizePreviewDot = document.getElementById('size-preview-dot');
    const eraserCursor = document.getElementById('eraser-cursor');
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

    // Modals & Toast
    const newRoomModal = document.getElementById('new-room-modal');
    const newRoomForm = document.getElementById('new-room-form');
    const newRoomNameInput = document.getElementById('new-room-name-input');
    const newRoomUserInput = document.getElementById('new-room-user-input');
    const newRoomCancelBtn = document.getElementById('new-room-cancel-btn');

    const joinRoomModal = document.getElementById('join-room-modal');
    const joinRoomForm = document.getElementById('join-room-form');
    const joinCodeInput = document.getElementById('join-code-input');
    const joinUsernameInput = document.getElementById('join-username-input');
    const joinCancelBtn = document.getElementById('join-cancel-btn');

    const toast = document.getElementById('toast');
    const toastMessage = document.getElementById('toast-message');
    let toastTimer = null;

    function showToast(msg) {
        toastMessage.textContent = msg;
        toast.classList.remove('hidden');
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => {
            toast.classList.add('hidden');
        }, 2400);
    }

    // 2. Initialize Engine & Network Client
    const engine = new CanvasEngine(viewport, drawingCanvas, overlayCanvas);
    const client = new WebSocketClient({
        roomId: initialRoom,
        username: initialUsername
    });

    let operations = [];
    let currentUserId = null;
    let myUndoneCount = 0;

    roomBadge.textContent = initialRoom;

    function updateUndoRedoState() {
        const hasMyActiveOps = operations.some(op => op.userId === currentUserId && !op.undone);
        undoBtn.disabled = !hasMyActiveOps;
        redoBtn.disabled = myUndoneCount === 0;
    }

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
        showToast(`${user.username || 'A collaborator'} joined`);
    };

    client.onUserLeft = (userId, users) => {
        engine.remoteCursors.delete(userId);
        engine.remoteLiveStrokes.delete(userId);
        engine.renderOverlay();
        updateUserPresence(users);
    };

    client.onOpCommit = (op) => {
        operations.push(op);
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
        showToast('Canvas cleared for all users');
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

    // 4. Engine Interaction Callbacks
    engine.onCommitOperation = (op) => {
        client.commitOperation(op);
        myUndoneCount = 0;
    };

    engine.onLiveStroke = (strokeData) => {
        client.sendLiveStroke(strokeData);
    };

    engine.onCursorMove = (worldX, worldY) => {
        client.sendCursor(worldX, worldY);
    };

    function updateEraserCursorSize() {
        if (!eraserCursor) return;
        const screenDiameter = Math.max(6, (engine.currentWidth * 2) * engine.zoom);
        eraserCursor.style.width = `${screenDiameter}px`;
        eraserCursor.style.height = `${screenDiameter}px`;
    }

    engine.onZoomChange = (zoom) => {
        zoomLevelText.textContent = `${Math.round(zoom * 100)}%`;
        updateEraserCursorSize();
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

            // Show custom eraser ring cursor; hide system cursor
            if (tool === 'eraser') {
                viewport.classList.add('eraser-active');
                updateEraserCursorSize();
                eraserCursor.classList.remove('hidden');
            } else {
                viewport.classList.remove('eraser-active');
                eraserCursor.classList.add('hidden');
            }
        });
    });

    viewport.addEventListener('pointermove', (e) => {
        if (engine.currentTool === 'eraser') {
            eraserCursor.style.left = `${e.clientX}px`;
            eraserCursor.style.top = `${e.clientY}px`;
            eraserCursor.classList.remove('hidden');
        }
    });

    viewport.addEventListener('pointerleave', () => {
        if (engine.currentTool === 'eraser') {
            eraserCursor.classList.add('hidden');
        }
    });

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

    function updateSizeUI(val) {
        engine.currentWidth = val;
        sizeLabel.textContent = `${val}px`;
        // Scale preview dot: clamp between 4px and 36px visually
        const dotSize = Math.min(4 + val * 0.5, 36);
        sizePreviewDot.style.width = `${dotSize}px`;
        sizePreviewDot.style.height = `${dotSize}px`;
        updateEraserCursorSize();
    }

    strokeSizeSlider.addEventListener('input', () => {
        updateSizeUI(parseInt(strokeSizeSlider.value, 10));
    });

    // Init dot on load
    updateSizeUI(parseInt(strokeSizeSlider.value, 10));

    toggleFillBtn.addEventListener('click', () => {
        engine.isFillEnabled = !engine.isFillEnabled;
        toggleFillBtn.classList.toggle('active', engine.isFillEnabled);
        fillStatusText.textContent = engine.isFillEnabled ? 'On' : 'Off';
    });

    undoBtn.addEventListener('click', () => client.sendUndo());
    redoBtn.addEventListener('click', () => client.sendRedo());

    zoomInBtn.addEventListener('click', () => engine.setZoom(engine.zoom * 1.2));
    zoomOutBtn.addEventListener('click', () => engine.setZoom(engine.zoom * 0.8));
    resetViewBtn.addEventListener('click', () => engine.resetView());

    exportPngBtn.addEventListener('click', () => {
        const dataUrl = engine.exportPNG();
        const a = document.createElement('a');
        a.href = dataUrl;
        a.download = `canvascollab-${client.roomId}-${Date.now()}.png`;
        a.click();
        showToast('📸 Canvas exported as PNG');
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
        showToast('💾 State exported as JSON');
    });

    clearBoardBtn.addEventListener('click', () => {
        if (confirm('Are you sure you want to clear the canvas for all users in this room?')) {
            client.sendClear();
        }
    });

    // 6. Room Sharing: Code & Link
    copyCodeBtn.addEventListener('click', () => {
        navigator.clipboard.writeText(client.roomId).then(() => {
            showToast(`📋 Room code "${client.roomId}" copied!`);
        }).catch(() => {
            prompt('Copy Room Code:', client.roomId);
        });
    });

    copyRoomBtn.addEventListener('click', () => {
        const roomUrl = `${window.location.origin}/?room=${encodeURIComponent(client.roomId)}`;
        navigator.clipboard.writeText(roomUrl).then(() => {
            showToast('🔗 Invite link copied to clipboard!');
        }).catch(() => {
            prompt('Copy link to room:', roomUrl);
        });
    });

    // 7. Modals: Create New Room & Join Room
    newRoomBtn.addEventListener('click', () => {
        newRoomUserInput.value = client.username || localStorage.getItem('canvas_username') || '';
        newRoomModal.classList.remove('hidden');
    });

    newRoomCancelBtn.addEventListener('click', () => {
        newRoomModal.classList.add('hidden');
    });

    newRoomForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const customName = newRoomNameInput.value.trim() || 'Untitled Canvas';
        const chosenUser = newRoomUserInput.value.trim();

        if (chosenUser) {
            localStorage.setItem('canvas_username', chosenUser);
        }

        try {
            const res = await fetch('/api/rooms', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: customName })
            });
            const data = await res.json();

            if (data.success && data.code) {
                newRoomModal.classList.add('hidden');
                client.joinRoom(data.code, chosenUser);
                roomBadge.textContent = data.code;

                const newUrl = `${window.location.pathname}?room=${encodeURIComponent(data.code)}`;
                window.history.pushState({ room: data.code }, '', newUrl);

                showToast(`🎉 Room created! Code: ${data.code}`);
            }
        } catch (err) {
            console.error('Failed creating room via API:', err);
            // Fallback in case of offline
            const fallbackCode = Math.random().toString(36).substring(2, 8).toUpperCase();
            client.joinRoom(fallbackCode, chosenUser);
            roomBadge.textContent = fallbackCode;
            newRoomModal.classList.add('hidden');
            showToast(`Room created: ${fallbackCode}`);
        }
    });

    joinRoomBtn.addEventListener('click', () => {
        joinCodeInput.value = '';
        joinUsernameInput.value = client.username || localStorage.getItem('canvas_username') || '';
        joinRoomModal.classList.remove('hidden');
    });

    joinCancelBtn.addEventListener('click', () => {
        joinRoomModal.classList.add('hidden');
    });

    joinRoomForm.addEventListener('submit', (e) => {
        e.preventDefault();
        let rawInput = joinCodeInput.value.trim();
        const chosenUser = joinUsernameInput.value.trim();

        if (!rawInput) return;

        // If user pasted a full URL, extract ?room= or /room/
        let targetCode = rawInput;
        try {
            if (rawInput.includes('://') || rawInput.includes('?room=') || rawInput.includes('/room/')) {
                const parsed = new URL(rawInput, window.location.origin);
                targetCode = parsed.searchParams.get('room') || parsed.pathname.replace('/room/', '') || rawInput;
            }
        } catch (_) {}

        targetCode = targetCode.replace(/[^a-zA-Z0-9_-]/g, '').toUpperCase();

        if (chosenUser) {
            localStorage.setItem('canvas_username', chosenUser);
        }

        client.joinRoom(targetCode, chosenUser);
        roomBadge.textContent = targetCode;

        const newUrl = `${window.location.pathname}?room=${encodeURIComponent(targetCode)}`;
        window.history.pushState({ room: targetCode }, '', newUrl);

        joinRoomModal.classList.add('hidden');
        showToast(`🚪 Switched to room ${targetCode}`);
    });

    // 8. Keyboard Shortcuts
    window.addEventListener('keydown', (e) => {
        if (e.target.tagName === 'INPUT') return;

        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) {
            e.preventDefault();
            client.sendUndo();
            return;
        }

        if (((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') ||
            ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'z')) {
            e.preventDefault();
            client.sendRedo();
            return;
        }

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
