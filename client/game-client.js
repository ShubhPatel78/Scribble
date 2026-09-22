/**
 * GameClient: Coordinates Scribble (Skribbl.io) Game UI,
 * Chat & Guessing feeds, Leaderboards, Word Clues, and Drawer Modals.
 */

class GameClient {
    constructor(client, engine) {
        this.client = client;
        this.engine = engine;

        // Current game state cache
        this.gameState = 'LOBBY';
        this.currentRound = 1;
        this.totalRounds = 3;
        this.drawerId = null;
        this.drawerName = '';
        this.wordClue = '';
        this.secretWord = '';
        this.timeLeft = 0;
        this.players = [];
        this.isDrawer = false;
        this.isHost = false;

        // Cache DOM Elements
        this.drawTime = 60;
        this.initDOMElements();
        this.bindEvents();
        this.updateDrawerPermissions();
    }

    initDOMElements() {
        // Top Game Bar
        this.roundDisplay = document.getElementById('game-round-text');
        this.timerBadge = document.getElementById('game-timer-badge');
        this.timerText = document.getElementById('game-timer-text');
        this.wordClueContainer = document.getElementById('game-word-clue');
        this.wordHintText = document.getElementById('game-word-hint');
        this.startGameBtn = document.getElementById('start-game-btn');
        this.roomSettingsBtn = document.getElementById('room-settings-btn');

        // Scoreboard
        this.playersList = document.getElementById('game-players-list');
        this.playerCountBadge = document.getElementById('game-player-count');

        // Live Chat & Guessing
        this.chatMessages = document.getElementById('chat-messages');
        this.chatForm = document.getElementById('chat-form');
        this.chatInput = document.getElementById('chat-input');
        this.chatSendBtn = document.getElementById('chat-send-btn');

        // Modals & Overlays
        this.wordChoiceModal = document.getElementById('word-choice-modal');
        this.wordChoiceTimer = document.getElementById('word-choice-timer');
        this.wordOptionsContainer = document.getElementById('word-options-container');

        this.podiumModal = document.getElementById('podium-modal');
        this.podiumContainer = document.getElementById('podium-container');
        this.playAgainBtn = document.getElementById('play-again-btn');

        // Room Settings Modal (Lobby)
        this.settingsModal = document.getElementById('room-settings-modal');
        this.settingsForm = document.getElementById('room-settings-form');
        this.settingsCancelBtn = document.getElementById('settings-cancel-btn');
        this.settingsTimerSlider = document.getElementById('settings-timer-slider');
        this.settingsTimerDisplay = document.getElementById('settings-timer-display');
        this.settingsRoundsDisplay = document.getElementById('settings-rounds-display');
        this.modalTimerChips = document.querySelectorAll('#modal-timer-chips .timer-chip');
        this.modalRoundsChips = document.querySelectorAll('#modal-rounds-chips .rounds-chip');

        this.floatingToolbar = document.querySelector('.floating-toolbar');
        this.viewport = document.getElementById('viewport');
    }

    bindEvents() {
        // Start Game Button (Host only)
        if (this.startGameBtn) {
            this.startGameBtn.addEventListener('click', () => {
                this.client.startGame();
            });
        }

        // Room Settings Button (Host only)
        if (this.roomSettingsBtn && this.settingsModal) {
            this.roomSettingsBtn.addEventListener('click', () => {
                this.openSettingsModal();
            });
        }

        if (this.settingsCancelBtn && this.settingsModal) {
            this.settingsCancelBtn.addEventListener('click', () => {
                this.settingsModal.classList.add('hidden');
            });
        }

        // Settings Modal Form Controls
        if (this.settingsTimerSlider && this.settingsTimerDisplay) {
            this.settingsTimerSlider.addEventListener('input', (e) => {
                const val = e.target.value;
                this.settingsTimerDisplay.textContent = `${val}s`;
                this.modalTimerChips.forEach(chip => {
                    chip.classList.toggle('active', chip.dataset.time === val);
                });
            });
        }

        this.modalTimerChips.forEach(chip => {
            chip.addEventListener('click', () => {
                const val = chip.dataset.time;
                if (this.settingsTimerSlider) this.settingsTimerSlider.value = val;
                if (this.settingsTimerDisplay) this.settingsTimerDisplay.textContent = `${val}s`;
                this.modalTimerChips.forEach(c => c.classList.remove('active'));
                chip.classList.add('active');
            });
        });

        this.modalRoundsChips.forEach(chip => {
            chip.addEventListener('click', () => {
                const val = chip.dataset.rounds;
                if (this.settingsRoundsDisplay) this.settingsRoundsDisplay.textContent = `${val} Rounds`;
                this.modalRoundsChips.forEach(c => c.classList.remove('active'));
                chip.classList.add('active');
            });
        });

        if (this.settingsForm) {
            this.settingsForm.addEventListener('submit', (e) => {
                e.preventDefault();
                const drawTime = parseInt(this.settingsTimerSlider?.value || 60, 10);
                const activeRoundsChip = document.querySelector('#modal-rounds-chips .rounds-chip.active');
                const totalRounds = parseInt(activeRoundsChip?.dataset?.rounds || 3, 10);

                this.client.updateSettings({ drawTime, totalRounds });
                if (this.settingsModal) this.settingsModal.classList.add('hidden');
            });
        }

        // Chat Form Submission
        if (this.chatForm) {
            this.chatForm.addEventListener('submit', (e) => {
                e.preventDefault();
                const text = this.chatInput.value.trim();
                if (text) {
                    this.client.sendChat(text);
                    this.chatInput.value = '';
                }
            });
        }

        // Play Again Button
        if (this.playAgainBtn) {
            this.playAgainBtn.addEventListener('click', () => {
                this.podiumModal.classList.add('hidden');
                this.client.startGame();
            });
        }

        // Wire WebSocket Client Callbacks
        this.client.onGameStateChanged = (state) => this.handleGameState(state);
        this.client.onWordOptions = (data) => this.showWordChoiceModal(data.words, data.time);
        this.client.onSecretWord = (data) => this.handleSecretWord(data.word);
        this.client.onTimerTick = (data) => this.updateTimer(data.timeLeft);
        this.client.onChatMessage = (msg) => this.appendChatMessage(msg);
        this.client.onGameOver = (data) => this.showPodium(data.podium);
    }

    openSettingsModal() {
        if (!this.settingsModal) return;
        if (this.settingsTimerSlider) this.settingsTimerSlider.value = this.drawTime;
        if (this.settingsTimerDisplay) this.settingsTimerDisplay.textContent = `${this.drawTime}s`;
        this.modalTimerChips.forEach(chip => {
            chip.classList.toggle('active', parseInt(chip.dataset.time, 10) === this.drawTime);
        });

        if (this.settingsRoundsDisplay) this.settingsRoundsDisplay.textContent = `${this.totalRounds} Rounds`;
        this.modalRoundsChips.forEach(chip => {
            chip.classList.toggle('active', parseInt(chip.dataset.rounds, 10) === this.totalRounds);
        });

        this.settingsModal.classList.remove('hidden');
    }

    handleGameState(stateData) {
        this.gameState = stateData.state;
        this.currentRound = stateData.round || 1;
        this.totalRounds = stateData.totalRounds || 3;
        this.drawTime = stateData.drawTime || this.drawTime || 60;
        this.drawerId = stateData.drawerId;
        this.drawerName = stateData.drawerName || '';
        this.wordClue = stateData.wordClue || '';
        this.players = stateData.players || [];
        this.timeLeft = stateData.timeLeft || 0;

        const myId = this.client.clientId;
        this.isDrawer = Boolean(this.drawerId && myId && this.drawerId === myId);
        const myPlayer = this.players.find(p => p.id === myId);
        this.isHost = myPlayer?.isHost || false;

        // 1. Update Top Bar
        if (this.roundDisplay) {
            if (this.gameState === 'LOBBY') {
                this.roundDisplay.textContent = `Lobby (${this.drawTime}s / ${this.totalRounds} Rnds)`;
            } else if (this.gameState === 'GAME_OVER') {
                this.roundDisplay.textContent = 'Game Over';
            } else {
                this.roundDisplay.textContent = `Round ${this.currentRound} of ${this.totalRounds}`;
            }
        }

        this.updateTimer(this.timeLeft);
        this.updateWordClue(stateData.wordLength);

        // 2. Start Game & Settings Button Visibility (Host only during LOBBY or GAME_OVER)
        const isLobbyOrOver = (this.gameState === 'LOBBY' || this.gameState === 'GAME_OVER');
        if (this.startGameBtn) {
            if (this.isHost && isLobbyOrOver) {
                this.startGameBtn.classList.remove('hidden');
                this.startGameBtn.disabled = this.players.length < 1;
                this.startGameBtn.title = 'Start the Scribble match!';
            } else {
                this.startGameBtn.classList.add('hidden');
            }
        }

        if (this.roomSettingsBtn) {
            if (this.isHost && isLobbyOrOver) {
                this.roomSettingsBtn.classList.remove('hidden');
            } else {
                this.roomSettingsBtn.classList.add('hidden');
            }
        }

        // 3. Update Player Scoreboard
        this.renderScoreboard();

        // 4. Update Drawer/Guesser permissions
        this.updateDrawerPermissions();

        // 5. Hide word choice modal if not in CHOOSING_WORD
        if (this.gameState !== 'CHOOSING_WORD' && this.wordChoiceModal) {
            this.wordChoiceModal.classList.add('hidden');
        }
    }

    updateTimer(seconds) {
        this.timeLeft = seconds;
        if (!this.timerText) return;

        this.timerText.textContent = `${seconds}s`;

        if (this.timerBadge) {
            this.timerBadge.classList.remove('urgent', 'warning', 'idle');
            if (seconds <= 10 && seconds > 0) {
                this.timerBadge.classList.add('urgent');
            } else if (seconds <= 25 && seconds > 0) {
                this.timerBadge.classList.add('warning');
            } else if (this.gameState === 'LOBBY') {
                this.timerBadge.classList.add('idle');
                this.timerText.textContent = '∞';
            }
        }
    }

    updateWordClue(wordLength = 0) {
        if (!this.wordHintText) return;

        if (this.gameState === 'LOBBY') {
            this.wordHintText.innerHTML = '<span class="clue-subtle">🎨 Lobby: Practice drawing or click "Start Game" to play!</span>';
            return;
        }

        if (this.gameState === 'CHOOSING_WORD') {
            this.wordHintText.innerHTML = `<span class="clue-subtle">🎨 ${this.drawerName || 'Drawer'} is choosing a word...</span>`;
            return;
        }

        if (this.isDrawer && this.secretWord) {
            this.wordHintText.innerHTML = `<span class="clue-drawer-word">DRAW THIS: <strong>${this.secretWord.toUpperCase()}</strong></span>`;
            return;
        }

        if (this.wordClue) {
            // Render letter blanks as styled span tiles
            const tilesHtml = this.wordClue.split(' ').map(char => {
                if (char === '') return '<span class="clue-spacer"></span>';
                if (char === '_') return '<span class="clue-blank">_</span>';
                return `<span class="clue-letter">${char.toUpperCase()}</span>`;
            }).join('');

            const lenText = wordLength > 0 ? `<span class="clue-count">(${wordLength})</span>` : '';
            this.wordHintText.innerHTML = `${tilesHtml} ${lenText}`;
        }
    }

    handleSecretWord(word) {
        this.secretWord = word;
        this.updateWordClue();
    }

    updateDrawerPermissions() {
        const canDraw = (this.gameState === 'LOBBY' || (this.gameState === 'DRAWING' && this.isDrawer));

        if (this.floatingToolbar) {
            if (canDraw) {
                this.floatingToolbar.classList.remove('hidden', 'disabled');
            } else {
                // During active match rounds, hide toolbar for guessers so canvas is 100% clean
                if (this.gameState === 'DRAWING' || this.gameState === 'CHOOSING_WORD' || this.gameState === 'ROUND_END') {
                    this.floatingToolbar.classList.add('hidden');
                } else {
                    this.floatingToolbar.classList.remove('hidden');
                    this.floatingToolbar.classList.add('disabled');
                }
            }
        }

        if (this.viewport) {
            if (canDraw) {
                this.viewport.style.pointerEvents = 'auto';
            } else {
                this.viewport.style.pointerEvents = 'none';
            }
        }
    }

    renderScoreboard() {
        if (!this.playersList) return;

        const sorted = [...this.players].sort((a, b) => b.score - a.score);
        if (this.playerCountBadge) {
            this.playerCountBadge.textContent = `${sorted.length} players`;
        }

        this.playersList.innerHTML = '';
        sorted.forEach((player, rankIdx) => {
            const isMe = player.id === this.client.clientId;
            const isCurrentDrawer = player.id === this.drawerId && this.gameState === 'DRAWING';
            const hasGuessed = player.guessed && this.gameState === 'DRAWING' && !isCurrentDrawer;

            const card = document.createElement('div');
            card.className = `player-card ${isMe ? 'self' : ''} ${hasGuessed ? 'guessed' : ''} ${isCurrentDrawer ? 'drawing' : ''}`;

            const rankMedal = rankIdx === 0 ? '👑' : `#${rankIdx + 1}`;

            card.innerHTML = `
                <div class="player-rank">${rankMedal}</div>
                <div class="player-avatar" style="background: ${player.color || '#3B82F6'}">
                    ${(player.username || 'P')[0].toUpperCase()}
                </div>
                <div class="player-info">
                    <div class="player-name-row">
                        <span class="player-name">${this.escapeHtml(player.username)} ${isMe ? '<small>(You)</small>' : ''}</span>
                        ${player.isHost ? '<span class="host-pill" title="Room Host">Host</span>' : ''}
                    </div>
                    <div class="player-score">${player.score || 0} pts</div>
                </div>
                <div class="player-status-badge">
                    ${isCurrentDrawer ? '<span class="badge-drawing" title="Drawing">🎨</span>' : ''}
                    ${hasGuessed ? '<span class="badge-guessed" title="Guessed the word!">✅</span>' : ''}
                </div>
            `;
            this.playersList.appendChild(card);
        });
    }

    showWordChoiceModal(words, timeSeconds = 15) {
        if (!this.wordChoiceModal || !this.wordOptionsContainer) return;

        this.wordOptionsContainer.innerHTML = '';
        words.forEach(word => {
            const btn = document.createElement('button');
            btn.className = 'word-choice-btn';
            btn.textContent = word;
            btn.addEventListener('click', () => {
                this.client.chooseWord(word);
                this.wordChoiceModal.classList.add('hidden');
            });
            this.wordOptionsContainer.appendChild(btn);
        });

        if (this.wordChoiceTimer) {
            this.wordChoiceTimer.textContent = `${timeSeconds}s`;
        }

        this.wordChoiceModal.classList.remove('hidden');
    }

    showPodium(rankedPlayers) {
        if (!this.podiumModal || !this.podiumContainer) return;

        this.podiumContainer.innerHTML = '';
        const top3 = (rankedPlayers || []).slice(0, 3);
        const medals = ['🥇', '🥈', '🥉'];
        const heights = ['1st', '2nd', '3rd'];

        top3.forEach((player, idx) => {
            const col = document.createElement('div');
            col.className = `podium-column podium-${heights[idx]}`;
            col.innerHTML = `
                <div class="podium-medal">${medals[idx]}</div>
                <div class="podium-avatar" style="background: ${player.color || '#3B82F6'}">
                    ${(player.username || 'P')[0].toUpperCase()}
                </div>
                <div class="podium-name">${this.escapeHtml(player.username)}</div>
                <div class="podium-score">${player.score || 0} pts</div>
                <div class="podium-stand"></div>
            `;
            this.podiumContainer.appendChild(col);
        });

        if (this.playAgainBtn) {
            this.playAgainBtn.style.display = this.isHost ? 'block' : 'none';
        }

        this.podiumModal.classList.remove('hidden');
    }

    appendChatMessage(msg) {
        if (!this.chatMessages || !msg) return;

        const effectiveType = msg.msgType || msg.type || 'chat';
        const row = document.createElement('div');
        row.className = `chat-msg msg-${effectiveType}`;

        if (effectiveType === 'system') {
            row.innerHTML = `<span class="system-text" style="color: ${msg.color || '#64748B'}">📢 ${this.escapeHtml(msg.text || '')}</span>`;
        } else if (effectiveType === 'correct_guess') {
            const pointsTag = msg.points ? `<span class="points-tag">+${msg.points} pts</span>` : '';
            row.innerHTML = `<span class="correct-guess-text">🎉 <strong>${this.escapeHtml(msg.username || 'Someone')}</strong> guessed the word! ${pointsTag}</span>`;
        } else if (effectiveType === 'close_guess') {
            row.innerHTML = `<span class="close-guess-text">💡 ${this.escapeHtml(msg.text || '')}</span>`;
        } else {
            const nameColor = msg.color || '#3B82F6';
            row.innerHTML = `
                <strong class="msg-author" style="color: ${nameColor}">${this.escapeHtml(msg.username || 'Anonymous')}:</strong>
                <span class="msg-body">${this.escapeHtml(msg.text || '')}</span>
            `;
        }

        this.chatMessages.appendChild(row);
        this.chatMessages.scrollTop = this.chatMessages.scrollHeight;
    }

    escapeHtml(str) {
        if (!str) return '';
        return str.toString()
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }
}

// Export for usage in main.js
window.GameClient = GameClient;
