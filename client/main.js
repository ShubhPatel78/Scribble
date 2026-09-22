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
    const leaveRoomBtn = document.getElementById('leave-room-btn');

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

    // Theme Switcher Elements
    const themeBtn = document.getElementById('theme-btn');
    const themeMenu = document.getElementById('theme-menu');
    const themeOptions = document.querySelectorAll('.theme-option');
    const themeIcon = document.getElementById('theme-icon');
    const themeName = document.getElementById('theme-name');

    const undoBtn = document.getElementById('undo-btn');
    const redoBtn = document.getElementById('redo-btn');
    const zoomInBtn = document.getElementById('zoom-in-btn');
    const zoomOutBtn = document.getElementById('zoom-out-btn');
    const zoomLevelBtn = document.getElementById('zoom-level-btn');
    const zoomLevelText = document.getElementById('zoom-level-text');
    const resetViewBtn = document.getElementById('reset-view-btn');
    const exportPngBtn = document.getElementById('export-png-btn');
    const exportJsonBtn = document.getElementById('export-json-btn');
    const clearBoardBtn = document.getElementById('clear-board-btn');

    // Login Screen Portal Elements
    const loginScreen = document.getElementById('login-screen');
    const loginUsernameInput = document.getElementById('login-username-input');
    const loginAvatarPreview = document.getElementById('login-avatar-preview');
    const loginAvatarEmoji = document.getElementById('login-avatar-emoji');
    const loginRandomizeAvatarBtn = document.getElementById('login-randomize-avatar-btn');
    const avatarChips = document.querySelectorAll('#avatar-emoji-picker .avatar-chip');

    const tabCreateRoom = document.getElementById('tab-create-room');
    const tabJoinRoom = document.getElementById('tab-join-room');
    const panelCreateRoom = document.getElementById('panel-create-room');
    const panelJoinRoom = document.getElementById('panel-join-room');

    const loginCreateForm = document.getElementById('login-create-form');
    const createRoomNameInput = document.getElementById('create-room-name-input');
    const createTimerSlider = document.getElementById('create-timer-slider');
    const createTimerDisplay = document.getElementById('create-timer-display');
    const createRoundsDisplay = document.getElementById('create-rounds-display');
    const createTimerChips = document.querySelectorAll('#create-timer-chips .timer-chip');
    const createRoundsChips = document.querySelectorAll('#create-rounds-chips .rounds-chip');

    const loginJoinForm = document.getElementById('login-join-form');
    const loginJoinCodeInput = document.getElementById('login-join-code-input');
    const loginInviteBanner = document.getElementById('login-invite-banner');
    const loginInviteCodeDisplay = document.getElementById('login-invite-code-display');

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

    const leaveRoomModal = document.getElementById('leave-room-modal');
    const leaveCancelBtn = document.getElementById('leave-cancel-btn');
    const leaveConfirmBtn = document.getElementById('leave-confirm-btn');

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

    // -------------------------------------------------------------
    // Avatar & Identity Setup
    // -------------------------------------------------------------
    const AVATAR_COLORS = [
        '#EF4444', '#F97316', '#F59E0B', '#10B981',
        '#06B6D4', '#3B82F6', '#6366F1', '#8B5CF6',
        '#EC4899', '#14B8A6'
    ];
    const AVATAR_EMOJIS = ['🎨', '🐱', '🐶', '🦊', '🐼', '🦁', '🦄', '🤖', '👻', '🚀', '👑', '🍕', '🎮', '⚡'];

    let selectedEmoji = localStorage.getItem('canvas_avatar') || '🎨';
    let selectedColor = localStorage.getItem('canvas_avatar_color') || AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)];

    function updateAvatarUI() {
        if (loginAvatarPreview) loginAvatarPreview.style.backgroundColor = selectedColor;
        if (loginAvatarEmoji) loginAvatarEmoji.textContent = selectedEmoji;
        avatarChips.forEach(chip => {
            chip.classList.toggle('active', chip.dataset.emoji === selectedEmoji);
        });
    }

    if (loginRandomizeAvatarBtn) {
        loginRandomizeAvatarBtn.addEventListener('click', () => {
            selectedEmoji = AVATAR_EMOJIS[Math.floor(Math.random() * AVATAR_EMOJIS.length)];
            selectedColor = AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)];
            localStorage.setItem('canvas_avatar', selectedEmoji);
            localStorage.setItem('canvas_avatar_color', selectedColor);
            updateAvatarUI();
        });
    }

    avatarChips.forEach(chip => {
        chip.addEventListener('click', () => {
            selectedEmoji = chip.dataset.emoji;
            localStorage.setItem('canvas_avatar', selectedEmoji);
            updateAvatarUI();
        });
    });

    updateAvatarUI();

    // Portal Tabs
    if (tabCreateRoom && tabJoinRoom) {
        tabCreateRoom.addEventListener('click', () => {
            tabCreateRoom.classList.add('active');
            tabJoinRoom.classList.remove('active');
            if (panelCreateRoom) panelCreateRoom.classList.add('active');
            if (panelJoinRoom) panelJoinRoom.classList.remove('active');
        });

        tabJoinRoom.addEventListener('click', () => {
            tabJoinRoom.classList.add('active');
            tabCreateRoom.classList.remove('active');
            if (panelJoinRoom) panelJoinRoom.classList.add('active');
            if (panelCreateRoom) panelCreateRoom.classList.remove('active');
        });
    }

    // Portal Custom Timer Slider & Chips
    if (createTimerSlider && createTimerDisplay) {
        createTimerSlider.addEventListener('input', (e) => {
            const val = e.target.value;
            createTimerDisplay.textContent = `${val}s`;
            createTimerChips.forEach(chip => {
                chip.classList.toggle('active', chip.dataset.time === val);
            });
        });
    }

    createTimerChips.forEach(chip => {
        chip.addEventListener('click', () => {
            const val = chip.dataset.time;
            if (createTimerSlider) createTimerSlider.value = val;
            if (createTimerDisplay) createTimerDisplay.textContent = `${val}s`;
            createTimerChips.forEach(c => c.classList.remove('active'));
            chip.classList.add('active');
        });
    });

    createRoundsChips.forEach(chip => {
        chip.addEventListener('click', () => {
            const val = chip.dataset.rounds;
            if (createRoundsDisplay) createRoundsDisplay.textContent = `${val} Rounds`;
            createRoundsChips.forEach(c => c.classList.remove('active'));
            chip.classList.add('active');
        });
    });

    // Populate Portal Defaults
    const isExplicitPlay = urlParams.get('play') === '1';
    const hasRoomParam = Boolean(urlParams.get('room') || pathRoom || hash);

    if (loginUsernameInput) {
        loginUsernameInput.value = initialUsername || `Artist ${Math.floor(Math.random() * 900) + 100}`;
    }

    if (hasRoomParam && !isExplicitPlay) {
        // Direct link invite -> switch to Join tab
        if (tabJoinRoom) tabJoinRoom.click();
        if (loginJoinCodeInput) loginJoinCodeInput.value = initialRoom;
        if (loginInviteBanner && loginInviteCodeDisplay) {
            loginInviteCodeDisplay.textContent = initialRoom;
            loginInviteBanner.classList.remove('hidden');
        }
    }

    // Handle Portal Create Room
    if (loginCreateForm) {
        loginCreateForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const nickname = (loginUsernameInput?.value || '').trim() || 'Artist';
            const roomName = (createRoomNameInput?.value || '').trim() || 'Scribble Room';
            const drawTime = parseInt(createTimerSlider?.value || 60, 10);
            const activeRounds = document.querySelector('#create-rounds-chips .rounds-chip.active');
            const totalRounds = parseInt(activeRounds?.dataset?.rounds || 3, 10);

            localStorage.setItem('canvas_username', nickname);
            localStorage.setItem('canvas_avatar', selectedEmoji);
            localStorage.setItem('canvas_avatar_color', selectedColor);

            try {
                const res = await fetch('/api/rooms', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name: roomName, drawTime, totalRounds })
                });
                const data = await res.json();
                if (data.success && data.code) {
                    window.location.href = `/?room=${encodeURIComponent(data.code)}&username=${encodeURIComponent(nickname)}&play=1`;
                }
            } catch (err) {
                console.error('Failed creating room via API:', err);
                const fallbackCode = generateRoomCode(6);
                window.location.href = `/?room=${encodeURIComponent(fallbackCode)}&username=${encodeURIComponent(nickname)}&play=1`;
            }
        });
    }

    // Handle Portal Join Room
    if (loginJoinForm) {
        loginJoinForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const nickname = (loginUsernameInput?.value || '').trim() || 'Artist';
            let rawInput = (loginJoinCodeInput?.value || '').trim();
            if (!rawInput) return;

            let targetCode = rawInput;
            try {
                if (rawInput.includes('://') || rawInput.includes('?room=') || rawInput.includes('/room/')) {
                    const parsed = new URL(rawInput, window.location.origin);
                    targetCode = parsed.searchParams.get('room') || parsed.pathname.replace('/room/', '') || rawInput;
                }
            } catch (_) {}

            targetCode = targetCode.replace(/[^a-zA-Z0-9_-]/g, '').toUpperCase();
            localStorage.setItem('canvas_username', nickname);
            localStorage.setItem('canvas_avatar', selectedEmoji);
            localStorage.setItem('canvas_avatar_color', selectedColor);

            window.location.href = `/?room=${encodeURIComponent(targetCode)}&username=${encodeURIComponent(nickname)}&play=1`;
        });
    }

    // 2. Initialize Engine & Network Client
    const engine = new CanvasEngine(viewport, drawingCanvas, overlayCanvas);
    const client = new WebSocketClient({
        roomId: initialRoom,
        username: initialUsername
    });
    const gameClient = new GameClient(client, engine);

    let operations = [];
    let currentUserId = null;
    let myUndoneCount = 0;

    roomBadge.textContent = initialRoom;

    function updateUndoRedoState() {
        const hasMyActiveOps = operations.some(op => op.userId === currentUserId && !op.undone);
        if (undoBtn) undoBtn.disabled = !hasMyActiveOps;
        if (redoBtn) redoBtn.disabled = myUndoneCount === 0;
    }

    function refreshCanvas() {
        engine.redraw(operations);
        updateUndoRedoState();
    }

    engine.onNeedsRedraw = () => {
        engine.redraw(operations);
    };

    engine.onZoomChange = (zoom) => {
        if (zoomLevelText) {
            zoomLevelText.textContent = `${Math.round(zoom * 100)}%`;
        }
    };

    // 3. Setup WebSocket Callbacks
    client.onConnectionChange = (connected) => {
        if (connectionBadge) {
            connectionBadge.className = connected ? 'connection-badge connected' : 'connection-badge disconnected';
        }
        if (connectionText) {
            connectionText.textContent = connected ? 'Connected' : 'Reconnecting...';
        }
    };

    client.onInit = (data) => {
        currentUserId = data.clientId;
        client.color = data.color;
        engine.currentColor = data.color;
        if (primaryColorPicker) primaryColorPicker.value = data.color;

        if (selfAvatar) {
            selfAvatar.style.backgroundColor = data.color;
            const savedAvatar = localStorage.getItem('canvas_avatar');
            selfAvatar.textContent = savedAvatar || (data.username || 'U')[0].toUpperCase();
        }
        if (selfName) selfName.textContent = `${data.username} (You)`;
        if (roomBadge) roomBadge.textContent = data.roomId;

        // Restore snapshot
        operations = (data.snapshot && data.snapshot.operations) ? [...data.snapshot.operations] : [];
        myUndoneCount = 0;
        refreshCanvas();
        updateUserPresence(data.users);

        if (data.game) {
            gameClient.handleGameState(data.game);
        }
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
        const existingIdx = operations.findIndex(o => o.id === op.id);
        if (existingIdx >= 0) {
            operations[existingIdx] = op;
        } else {
            operations.push(op);
        }
        if (op.userId) {
            engine.remoteLiveStrokes.delete(op.userId);
        }
        engine.renderOverlay();
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
        if (avatarStack) {
            avatarStack.innerHTML = '';
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
        if (usersCountBadge) {
            usersCountBadge.textContent = `${users.length} online`;
        }
    }

    // 4. Engine Interaction Callbacks
    engine.onCommitOperation = (op) => {
        if (!engine.canDraw) return; // Disallow non-drawers from committing operations

        const opWithUser = {
            ...op,
            userId: currentUserId || client.clientId
        };
        const existingIdx = operations.findIndex(o => o.id === opWithUser.id);
        if (existingIdx >= 0) {
            operations[existingIdx] = opWithUser;
        } else {
            operations.push(opWithUser);
        }
        refreshCanvas();

        client.commitOperation(opWithUser);
        myUndoneCount = 0;
    };

    engine.onLiveStroke = (strokeData) => {
        if (!engine.canDraw) return;
        client.sendLiveStroke(strokeData);
    };

    engine.onCursorMove = (worldX, worldY) => {
        if (!engine.canDraw) return;
        client.sendCursor(worldX, worldY);
    };

    function updateEraserCursorSize() {
        if (!eraserCursor) return;
        const screenDiameter = Math.max(6, (engine.currentWidth * 2) * engine.zoom);
        eraserCursor.style.width = `${screenDiameter}px`;
        eraserCursor.style.height = `${screenDiameter}px`;
    }

    engine.onZoomChange = (zoom) => {
        if (zoomLevelText) zoomLevelText.textContent = `${Math.round(zoom * 100)}%`;
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
                if (eraserCursor) eraserCursor.classList.remove('hidden');
            } else {
                viewport.classList.remove('eraser-active');
                if (eraserCursor) eraserCursor.classList.add('hidden');
            }
        });
    });

    viewport.addEventListener('pointermove', (e) => {
        if (engine.currentTool === 'eraser' && eraserCursor) {
            eraserCursor.style.left = `${e.clientX}px`;
            eraserCursor.style.top = `${e.clientY}px`;
            eraserCursor.classList.remove('hidden');
        }
    });

    viewport.addEventListener('pointerleave', () => {
        if (engine.currentTool === 'eraser' && eraserCursor) {
            eraserCursor.classList.add('hidden');
        }
    });

    const activeColorPreview = document.getElementById('active-color-preview');
    const sizeDotBtns = document.querySelectorAll('.size-dot-btn');

    function updateActiveColor(color) {
        engine.currentColor = color;
        if (activeColorPreview) {
            activeColorPreview.style.backgroundColor = color;
        }
        if (primaryColorPicker) {
            primaryColorPicker.value = color;
        }
    }

    if (primaryColorPicker) {
        primaryColorPicker.addEventListener('input', (e) => {
            const color = e.target.value;
            updateActiveColor(color);
            colorDots.forEach(d => d.classList.toggle('active', d.dataset.color?.toLowerCase() === color.toLowerCase()));
        });
    }

    colorDots.forEach(dot => {
        dot.addEventListener('click', () => {
            colorDots.forEach(d => d.classList.remove('active'));
            dot.classList.add('active');
            const color = dot.dataset.color;
            updateActiveColor(color);
        });
    });

    function updateSizeUI(val) {
        engine.currentWidth = val;
        if (sizeLabel) sizeLabel.textContent = `${val}px`;
        if (strokeSizeSlider) strokeSizeSlider.value = val;
        if (sizePreviewDot) {
            const dotSize = Math.min(4 + val * 0.5, 36);
            sizePreviewDot.style.width = `${dotSize}px`;
            sizePreviewDot.style.height = `${dotSize}px`;
        }
        sizeDotBtns.forEach(btn => {
            btn.classList.toggle('active', parseInt(btn.dataset.size, 10) === val);
        });
        updateEraserCursorSize();
    }

    sizeDotBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const size = parseInt(btn.dataset.size, 10);
            updateSizeUI(size);
        });
    });

    if (strokeSizeSlider) {
        strokeSizeSlider.addEventListener('input', () => {
            updateSizeUI(parseInt(strokeSizeSlider.value, 10));
        });
        updateSizeUI(parseInt(strokeSizeSlider.value, 10));
    }

    // Set initial active color to black
    updateActiveColor('#000000');

    if (toggleFillBtn) {
        toggleFillBtn.addEventListener('click', () => {
            engine.isFillEnabled = !engine.isFillEnabled;
            toggleFillBtn.classList.toggle('active', engine.isFillEnabled);
            if (fillStatusText) fillStatusText.textContent = engine.isFillEnabled ? 'On' : 'Off';
        });
    }

    // Theme Switcher Management
    const THEME_DATA = {
        light: { name: 'Light', icon: '☀️' },
        dark: { name: 'Dark Slate', icon: '🌙' },
        blueprint: { name: 'Blueprint', icon: '📐' },
        sepia: { name: 'Vintage Sepia', icon: '📜' }
    };

    function applyTheme(themeNameKey, notify = false) {
        const theme = THEME_DATA[themeNameKey] ? themeNameKey : 'light';
        document.documentElement.setAttribute('data-theme', theme);
        localStorage.setItem('canvas_theme', theme);

        if (themeIcon) themeIcon.textContent = THEME_DATA[theme].icon;
        if (themeName) themeName.textContent = THEME_DATA[theme].name;

        themeOptions.forEach(opt => {
            opt.classList.toggle('active', opt.dataset.theme === theme);
        });

        if (notify) {
            showToast(`🎨 Theme: ${THEME_DATA[theme].icon} ${THEME_DATA[theme].name}`);
        }
    }

    // Initialize saved theme
    const savedTheme = localStorage.getItem('canvas_theme') || 'light';
    applyTheme(savedTheme, false);

    if (themeBtn && themeMenu) {
        themeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            themeMenu.classList.toggle('hidden');
        });

        themeOptions.forEach(opt => {
            opt.addEventListener('click', () => {
                const chosenTheme = opt.dataset.theme;
                applyTheme(chosenTheme, true);
                themeMenu.classList.add('hidden');
            });
        });

        document.addEventListener('click', (e) => {
            if (!themeBtn.contains(e.target) && !themeMenu.contains(e.target)) {
                themeMenu.classList.add('hidden');
            }
        });
    }

    if (undoBtn) undoBtn.addEventListener('click', () => {
        if (engine.canDraw) client.sendUndo();
    });
    if (redoBtn) redoBtn.addEventListener('click', () => {
        if (engine.canDraw) client.sendRedo();
    });

    if (zoomInBtn) zoomInBtn.addEventListener('click', () => engine.setZoom(engine.zoom * 1.2));
    if (zoomOutBtn) zoomOutBtn.addEventListener('click', () => engine.setZoom(engine.zoom * 0.8));
    if (zoomLevelBtn) zoomLevelBtn.addEventListener('click', () => engine.setZoom(1.0));
    if (resetViewBtn) resetViewBtn.addEventListener('click', () => engine.resetView());

    if (exportPngBtn) {
        exportPngBtn.addEventListener('click', () => {
            const dataUrl = engine.exportPNG();
            const a = document.createElement('a');
            a.href = dataUrl;
            a.download = `scribble-${client.roomId}-${Date.now()}.png`;
            a.click();
            showToast('📸 Canvas exported as PNG');
        });
    }

    if (exportJsonBtn) {
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
            a.download = `scribble-${client.roomId}.json`;
            a.click();
            URL.revokeObjectURL(url);
            showToast('💾 State exported as JSON');
        });
    }

    if (clearBoardBtn) {
        clearBoardBtn.addEventListener('click', () => {
            if (!engine.canDraw) return;
            if (confirm('Are you sure you want to clear the canvas for all users in this room?')) {
                client.sendClear();
            }
        });
    }

    // 6. Room Sharing: Code & Link
    if (copyCodeBtn) {
        copyCodeBtn.addEventListener('click', () => {
            navigator.clipboard.writeText(client.roomId).then(() => {
                showToast(`📋 Room code "${client.roomId}" copied!`);
            }).catch(() => {
                prompt('Copy Room Code:', client.roomId);
            });
        });
    }

    if (copyRoomBtn) {
        copyRoomBtn.addEventListener('click', () => {
            const roomUrl = `${window.location.origin}/?room=${encodeURIComponent(client.roomId)}`;
            navigator.clipboard.writeText(roomUrl).then(() => {
                showToast('🔗 Invite link copied to clipboard!');
            }).catch(() => {
                prompt('Copy link to room:', roomUrl);
            });
        });
    }

    // 7. Modals: Create New Room & Join Room
    if (newRoomBtn) {
        newRoomBtn.addEventListener('click', () => {
            if (newRoomUserInput) newRoomUserInput.value = client.username || localStorage.getItem('canvas_username') || '';
            if (newRoomModal) newRoomModal.classList.remove('hidden');
        });
    }

    if (newRoomCancelBtn) {
        newRoomCancelBtn.addEventListener('click', () => {
            if (newRoomModal) newRoomModal.classList.add('hidden');
        });
    }

    if (newRoomForm) {
        newRoomForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const customName = (newRoomNameInput?.value || '').trim() || 'Untitled Canvas';
            const chosenUser = (newRoomUserInput?.value || '').trim();

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
                    if (newRoomModal) newRoomModal.classList.add('hidden');
                    window.location.href = `/?room=${encodeURIComponent(data.code)}${chosenUser ? `&username=${encodeURIComponent(chosenUser)}` : ''}`;
                }
            } catch (err) {
                console.error('Failed creating room via API:', err);
                const fallbackCode = Math.random().toString(36).substring(2, 8).toUpperCase();
                window.location.href = `/?room=${encodeURIComponent(fallbackCode)}${chosenUser ? `&username=${encodeURIComponent(chosenUser)}` : ''}`;
            }
        });
    }

    if (joinRoomBtn) {
        joinRoomBtn.addEventListener('click', () => {
            if (joinCodeInput) joinCodeInput.value = '';
            if (joinUsernameInput) joinUsernameInput.value = client.username || localStorage.getItem('canvas_username') || '';
            if (joinRoomModal) joinRoomModal.classList.remove('hidden');
        });
    }

    if (joinCancelBtn) {
        joinCancelBtn.addEventListener('click', () => {
            if (joinRoomModal) joinRoomModal.classList.add('hidden');
        });
    }

    if (joinRoomForm) {
        joinRoomForm.addEventListener('submit', (e) => {
            e.preventDefault();
            let rawInput = (joinCodeInput?.value || '').trim();
            const chosenUser = (joinUsernameInput?.value || '').trim();

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

            if (joinRoomModal) joinRoomModal.classList.add('hidden');
            window.location.href = `/?room=${encodeURIComponent(targetCode)}${chosenUser ? `&username=${encodeURIComponent(chosenUser)}` : ''}`;
        });
    }

    if (leaveRoomBtn) {
        leaveRoomBtn.addEventListener('click', () => {
            if (leaveRoomModal) leaveRoomModal.classList.remove('hidden');
        });
    }

    if (leaveCancelBtn) {
        leaveCancelBtn.addEventListener('click', () => {
            if (leaveRoomModal) leaveRoomModal.classList.add('hidden');
        });
    }

    if (leaveConfirmBtn) {
        leaveConfirmBtn.addEventListener('click', () => {
            client.sendLeaveGame();
            window.location.href = '/';
        });
    }

    // 8. Keyboard Shortcuts
    window.addEventListener('keydown', (e) => {
        if (e.target.tagName === 'INPUT') return;

        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) {
            e.preventDefault();
            if (engine.canDraw) client.sendUndo();
            return;
        }

        if (((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') ||
            ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'z')) {
            e.preventDefault();
            if (engine.canDraw) client.sendRedo();
            return;
        }

        if (e.key === 'Enter' || e.key === '/') {
            e.preventDefault();
            gameClient.openChatDrawer();
            return;
        }

        if (e.key === 'Escape') {
            gameClient.closeChatDrawer();
            return;
        }

        if (['p', 'b', 'e', 'f', 'g', 'r', 'o', 'c', 'l'].includes(e.key.toLowerCase()) && !engine.canDraw) {
            return; // Ignore drawing tool shortcuts when user is not the active drawer
        }

        switch (e.key.toLowerCase()) {
            case 'p':
            case 'b':
                document.querySelector('.tool-btn[data-tool="brush"]')?.click();
                break;
            case 'e':
                document.querySelector('.tool-btn[data-tool="eraser"]')?.click();
                break;
            case 'f':
            case 'g':
                document.querySelector('.tool-btn[data-tool="fill-bucket"]')?.click();
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

    // Connect WebSocket if playing
    if (isExplicitPlay) {
        if (loginScreen) loginScreen.classList.add('hidden');
        client.connect();
    } else {
        if (loginScreen) loginScreen.classList.remove('hidden');
    }
});
