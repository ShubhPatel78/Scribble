/**
 * GameEngine: Core State Machine and Rules for Multiplayer Scribble (Skribbl.io)
 *
 * States:
 *  - 'LOBBY': Players are joining, host can start game
 *  - 'CHOOSING_WORD': Active drawer receives 3 words and has 15s to pick
 *  - 'DRAWING': 60s turn. Drawer draws, guessers guess via chat
 *  - 'ROUND_END': 5s reveal of the word and score updates
 *  - 'GAME_OVER': Podium with top 3 players and Play Again option
 */

const { getRandomWords, normalizeWord, isCloseGuess } = require('./words');

const GAME_STATES = {
    LOBBY: 'LOBBY',
    CHOOSING_WORD: 'CHOOSING_WORD',
    DRAWING: 'DRAWING',
    ROUND_END: 'ROUND_END',
    GAME_OVER: 'GAME_OVER'
};

class GameEngine {
    constructor(options = {}) {
        this.totalRounds = Math.max(1, Math.min(10, parseInt(options.totalRounds, 10) || 3));
        this.drawTime = Math.max(15, Math.min(240, parseInt(options.drawTime, 10) || 60)); // seconds
        this.chooseWordTime = options.chooseWordTime || 15; // seconds
        this.roundEndTime = options.roundEndTime || 5; // seconds

        // Game State
        this.state = GAME_STATES.LOBBY;
        this.currentRound = 1;
        this.drawerIndex = -1;
        this.currentDrawerId = null;
        this.currentWord = '';
        this.wordOptions = [];
        this.revealedIndices = new Set();
        this.usedWords = new Set();

        // Players & Scoring: userId -> { id, username, color, score, guessedThisTurn, isHost }
        this.players = new Map();

        // Turn tracking
        this.correctGuessCount = 0;
        this.turnStartTime = 0;
        this.timeLeft = 0;
        this.timerInterval = null;
        this.disconnectTimers = new Map(); // userId -> timer

        // Callbacks to communicate with WebSocket server
        this.onBroadcast = null; // (event, payload, excludeWs) => void
        this.onSend = null;      // (userId, event, payload) => void
        this.onClearCanvas = null; // () => void
    }

    /**
     * Updates game rules (drawTime, totalRounds) if in LOBBY or GAME_OVER state.
     */
    updateSettings(userId, settings = {}) {
        const player = this.players.get(userId);
        if (userId && (!player || !player.isHost)) {
            return { error: 'Only the host can adjust room settings.' };
        }
        if (this.state !== GAME_STATES.LOBBY && this.state !== GAME_STATES.GAME_OVER) {
            return { error: 'Settings can only be changed before the match starts.' };
        }

        if (settings.drawTime !== undefined) {
            const dt = parseInt(settings.drawTime, 10);
            if (!isNaN(dt)) {
                this.drawTime = Math.max(15, Math.min(240, dt));
            }
        }
        if (settings.totalRounds !== undefined) {
            const tr = parseInt(settings.totalRounds, 10);
            if (!isNaN(tr)) {
                this.totalRounds = Math.max(1, Math.min(10, tr));
            }
        }

        this.broadcastGameState();
        this.broadcastChat({
            type: 'system',
            text: `⚙️ Room settings updated: ${this.drawTime}s draw timer, ${this.totalRounds} rounds.`,
            color: '#3B82F6'
        });
        return { success: true, drawTime: this.drawTime, totalRounds: this.totalRounds };
    }

    /**
     * Adds or reconnects a player in the game.
     */
    addPlayer(playerInfo) {
        // Check if player is reconnecting with the same sessionId or id
        const existingPlayer = Array.from(this.players.values()).find(
            p => (playerInfo.sessionId && p.sessionId === playerInfo.sessionId) || p.id === playerInfo.id
        );

        if (existingPlayer) {
            // Cancel any pending disconnect cleanup timer
            if (this.disconnectTimers.has(existingPlayer.id)) {
                clearTimeout(this.disconnectTimers.get(existingPlayer.id));
                this.disconnectTimers.delete(existingPlayer.id);
            }

            // Update ID if reconnected with new socket connection
            if (existingPlayer.id !== playerInfo.id) {
                this.players.delete(existingPlayer.id);
                const wasDrawer = (this.currentDrawerId === existingPlayer.id);
                existingPlayer.id = playerInfo.id;
                this.players.set(existingPlayer.id, existingPlayer);
                if (wasDrawer) {
                    this.currentDrawerId = playerInfo.id;
                }
            }

            existingPlayer.connected = true;
            if (playerInfo.username) existingPlayer.username = playerInfo.username;
            if (playerInfo.sessionId) existingPlayer.sessionId = playerInfo.sessionId;
            if (playerInfo.color) existingPlayer.color = playerInfo.color;

            this.broadcastGameState();
            return existingPlayer;
        }

        const isFirstPlayer = this.players.size === 0;
        const player = {
            id: playerInfo.id,
            sessionId: playerInfo.sessionId || playerInfo.id,
            username: playerInfo.username || 'Anonymous',
            color: playerInfo.color || '#3B82F6',
            score: 0,
            guessedThisTurn: false,
            isHost: isFirstPlayer,
            connected: true
        };
        this.players.set(player.id, player);
        this.broadcastGameState();
        return player;
    }

    /**
     * Handles unexpected socket disconnect with 60-second grace period.
     * Preserves player points and status in case they reconnect.
     */
    handlePlayerDisconnect(userId) {
        const player = this.players.get(userId);
        if (!player) return;

        player.connected = false;
        player.disconnectedAt = Date.now();
        this.broadcastGameState();

        if (this.disconnectTimers.has(userId)) {
            clearTimeout(this.disconnectTimers.get(userId));
        }

        const timer = setTimeout(() => {
            this.disconnectTimers.delete(userId);
            if (this.players.has(userId) && !this.players.get(userId).connected) {
                this.removePlayer(userId);
            }
        }, 60000); // 60s grace period for page refresh / network drop

        if (timer.unref) timer.unref();
        this.disconnectTimers.set(userId, timer);
    }

    /**
     * Handles voluntary exit from room (immediately removes player).
     */
    leavePlayer(userId) {
        if (this.disconnectTimers.has(userId)) {
            clearTimeout(this.disconnectTimers.get(userId));
            this.disconnectTimers.delete(userId);
        }
        return this.removePlayer(userId);
    }

    /**
     * Removes a player permanently. If host leaves, assign to next. If active drawer leaves, skip turn.
     */
    removePlayer(userId) {
        if (this.disconnectTimers.has(userId)) {
            clearTimeout(this.disconnectTimers.get(userId));
            this.disconnectTimers.delete(userId);
        }

        const wasHost = this.players.get(userId)?.isHost;
        const wasDrawer = this.currentDrawerId === userId;
        this.players.delete(userId);

        if (this.players.size === 0) {
            this.resetToLobby();
            return;
        }

        // Reassign host if needed
        if (wasHost && this.players.size > 0) {
            const nextHost = this.players.values().next().value;
            if (nextHost) nextHost.isHost = true;
        }

        // If drawer leaves mid-turn, handle immediately
        if (wasDrawer && (this.state === GAME_STATES.CHOOSING_WORD || this.state === GAME_STATES.DRAWING)) {
            this.broadcastChat({
                type: 'system',
                text: 'The drawer left the game! Moving to next turn...',
                color: '#EF4444'
            });
            this.endTurn('drawer_left');
            return;
        }

        // If not enough players (< 2) during game, return to lobby
        if (this.players.size < 2 && this.state !== GAME_STATES.LOBBY) {
            this.broadcastChat({
                type: 'system',
                text: 'Not enough players to continue. Returning to lobby.',
                color: '#F59E0B'
            });
            this.resetToLobby();
            return;
        }

        this.broadcastGameState();
    }

    /**
     * Starts the game from LOBBY state.
     */
    startGame(userId) {
        const player = this.players.get(userId);
        if (!player || (!player.isHost && this.players.size > 1)) {
            return { error: 'Only the room host can start the game.' };
        }
        if (this.players.size < 1) {
            return { error: 'Need at least 1 player to start a Scribble match.' };
        }

        // Reset scores
        this.players.forEach(p => {
            p.score = 0;
            p.guessedThisTurn = false;
        });

        this.currentRound = 1;
        this.drawerIndex = -1;
        this.usedWords.clear();

        this.startNextTurn();
        return { success: true };
    }

    /**
     * Advances to the next player's turn or next round.
     */
    startNextTurn() {
        this.clearTimer();
        if (this.onClearCanvas) this.onClearCanvas();

        const playerList = Array.from(this.players.values());
        if (playerList.length < 1) {
            this.resetToLobby();
            return;
        }

        this.drawerIndex++;
        if (this.drawerIndex >= playerList.length) {
            // Round finished
            this.currentRound++;
            this.drawerIndex = 0;

            if (this.currentRound > this.totalRounds) {
                this.endGame();
                return;
            }
        }

        const nextDrawer = playerList[this.drawerIndex];
        this.currentDrawerId = nextDrawer.id;
        this.currentWord = '';
        this.revealedIndices.clear();
        this.correctGuessCount = 0;

        // Reset guessed status for all players
        this.players.forEach(p => p.guessedThisTurn = false);

        // State -> CHOOSING_WORD
        this.state = GAME_STATES.CHOOSING_WORD;
        this.wordOptions = getRandomWords(3, this.usedWords);
        this.timeLeft = this.chooseWordTime;

        // Send 3 choices secretly to the drawer
        if (this.onSend) {
            this.onSend(this.currentDrawerId, 'game:word_options', {
                words: this.wordOptions,
                time: this.chooseWordTime
            });
        }

        this.broadcastGameState();
        this.broadcastChat({
            type: 'system',
            text: `Round ${this.currentRound}/${this.totalRounds}: ${nextDrawer.username} is choosing a word...`,
            color: '#3B82F6'
        });

        // 15s Timer for drawer to pick word
        this.timerInterval = setInterval(() => {
            this.timeLeft--;
            this.broadcastTime();

            if (this.timeLeft <= 0) {
                // Auto-pick first word if drawer didn't choose in time
                this.selectWord(this.currentDrawerId, this.wordOptions[0]);
            }
        }, 1000);
        if (this.timerInterval.unref) this.timerInterval.unref();
    }

    /**
     * Active drawer selects one of the 3 word choices.
     */
    selectWord(userId, chosenWord) {
        if (this.state !== GAME_STATES.CHOOSING_WORD || this.currentDrawerId !== userId) {
            return;
        }

        this.clearTimer();
        this.currentWord = chosenWord;
        this.usedWords.add(chosenWord);
        this.state = GAME_STATES.DRAWING;
        this.timeLeft = this.drawTime;
        this.turnStartTime = Date.now();

        // Notify drawer of the chosen word
        if (this.onSend) {
            this.onSend(this.currentDrawerId, 'game:secret_word', {
                word: this.currentWord
            });
        }

        this.broadcastGameState();
        const drawerName = this.players.get(this.currentDrawerId)?.username || 'Drawer';
        this.broadcastChat({
            type: 'system',
            text: `${drawerName} is drawing now! Start guessing!`,
            color: '#10B981'
        });

        // 60s Drawing & Guessing Timer with automatic letter hints
        this.timerInterval = setInterval(() => {
            this.timeLeft--;
            this.broadcastTime();

            // Reveal letter hints at 75% and 40% remaining time
            if (this.timeLeft === Math.round(this.drawTime * 0.75) ||
                this.timeLeft === Math.round(this.drawTime * 0.40)) {
                this.revealRandomLetter();
            }

            if (this.timeLeft <= 0) {
                this.endTurn('time_up');
            }
        }, 1000);
        if (this.timerInterval.unref) this.timerInterval.unref();
    }

    /**
     * Reveals a random unrevealed letter hint in the word clue.
     */
    revealRandomLetter() {
        if (!this.currentWord) return;
        const unrevealed = [];
        for (let i = 0; i < this.currentWord.length; i++) {
            if (this.currentWord[i] !== ' ' && !this.revealedIndices.has(i)) {
                unrevealed.push(i);
            }
        }
        if (unrevealed.length > 1) { // Leave at least 1 hidden letter
            const randomIdx = unrevealed[Math.floor(Math.random() * unrevealed.length)];
            this.revealedIndices.add(randomIdx);
            this.broadcastGameState();
        }
    }

    /**
     * Processes incoming chat message / guess from a player.
     */
    handleChatMessage(userId, text) {
        let player = this.players.get(userId);
        if (!player) {
            player = { id: userId, username: 'Player', color: '#3B82F6', score: 0, guessedThisTurn: false };
        }
        if (!text || !text.trim()) return null;

        const cleanText = text.trim();

        // During DRAWING phase, check for guesses
        if (this.state === GAME_STATES.DRAWING && this.currentWord) {
            const isDrawer = userId === this.currentDrawerId;
            const alreadyGuessed = player.guessedThisTurn;

            // Check exact guess
            if (!isDrawer && !alreadyGuessed) {
                if (normalizeWord(cleanText) === normalizeWord(this.currentWord)) {
                    // Correct Guess!
                    player.guessedThisTurn = true;
                    this.correctGuessCount++;

                    // Calculate speed-based score (100 to 500 pts)
                    const points = Math.max(100, Math.round(500 * (this.timeLeft / this.drawTime)));
                    player.score += points;

                    // Drawer also earns points (up to 300 pts)
                    const totalGuessers = this.players.size - 1;
                    const drawer = this.players.get(this.currentDrawerId);
                    if (drawer && totalGuessers > 0) {
                        drawer.score += Math.round(300 / totalGuessers);
                    }

                    this.broadcastChat({
                        type: 'correct_guess',
                        userId: player.id,
                        username: player.username,
                        points,
                        text: `${player.username} guessed the word! (+${points} pts)`,
                        color: '#10B981'
                    });

                    this.broadcastGameState();

                    // Check if all guessers have guessed the word
                    if (this.correctGuessCount >= totalGuessers) {
                        this.broadcastChat({
                            type: 'system',
                            text: 'Everyone guessed the word!',
                            color: '#10B981'
                        });
                        this.endTurn('all_guessed');
                    }

                    return { isGuess: true, correct: true };
                }

                // Check close guess (Levenshtein distance = 1)
                if (isCloseGuess(cleanText, this.currentWord)) {
                    if (this.onSend) {
                        this.onSend(userId, 'chat:message', {
                            type: 'close_guess',
                            msgType: 'close_guess',
                            text: `"${cleanText}" is very close!`,
                            color: '#F59E0B'
                        });
                    }
                    return { isGuess: true, close: true };
                }
            }

            // If a player who already guessed or drawer talks, hide guess from others
            if (alreadyGuessed || isDrawer) {
                // If they accidentally typed the exact word, block sending it to chat
                if (normalizeWord(cleanText) === normalizeWord(this.currentWord)) {
                    return null;
                }
            }
        }

        // Regular chat message broadcast
        this.broadcastChat({
            type: 'chat',
            userId: player.id,
            username: player.username,
            color: player.color,
            text: cleanText,
            isDrawer: userId === this.currentDrawerId,
            guessed: player.guessedThisTurn
        });

        return { isGuess: false };
    }

    /**
     * Ends the current turn, shows the secret word, and schedules the next turn.
     */
    endTurn(reason = 'time_up') {
        this.clearTimer();
        this.state = GAME_STATES.ROUND_END;
        this.timeLeft = this.roundEndTime;

        this.broadcastGameState();
        this.broadcastChat({
            type: 'system',
            text: `The word was: "${this.currentWord.toUpperCase()}"`,
            color: '#8B5CF6'
        });

        // 5s Round End delay then next turn
        this.timerInterval = setInterval(() => {
            this.timeLeft--;
            this.broadcastTime();

            if (this.timeLeft <= 0) {
                this.startNextTurn();
            }
        }, 1000);
        if (this.timerInterval.unref) this.timerInterval.unref();
    }

    /**
     * Returns players ranked by score descending.
     * @returns {Array<Object>}
     */
    getPodium() {
        return Array.from(this.players.values()).sort((a, b) => (b.score || 0) - (a.score || 0));
    }

    /**
     * Ends match, compiles final podium, and switches to GAME_OVER.
     */
    endGame() {
        this.clearTimer();
        this.state = GAME_STATES.GAME_OVER;

        const rankedPlayers = this.getPodium();

        this.broadcastGameState();
        if (this.onBroadcast) {
            this.onBroadcast('game:over', {
                podium: rankedPlayers
            });
        }
    }

    /**
     * Resets game back to LOBBY state.
     */
    resetToLobby() {
        this.clearTimer();
        this.state = GAME_STATES.LOBBY;
        this.currentRound = 1;
        this.drawerIndex = -1;
        this.currentDrawerId = null;
        this.currentWord = '';
        this.wordOptions = [];
        this.revealedIndices.clear();

        this.players.forEach(p => {
            p.score = 0;
            p.guessedThisTurn = false;
        });

        if (this.onClearCanvas) this.onClearCanvas();
        this.broadcastGameState();
    }

    /**
     * Generates masked word clue string (e.g. `_ _ P _ E`) for guessers.
     */
    getWordClue() {
        if (!this.currentWord) return '';
        if (this.state === GAME_STATES.ROUND_END || this.state === GAME_STATES.GAME_OVER) {
            return this.currentWord;
        }

        return this.currentWord.split('').map((char, idx) => {
            if (char === ' ') return '  ';
            if (this.revealedIndices.has(idx)) return char;
            return '_';
        }).join(' ');
    }

    /**
     * Broadcasts full game state payload to all connected room members.
     */
    broadcastGameState() {
        if (!this.onBroadcast) return;

        const playersList = Array.from(this.players.values()).map(p => ({
            id: p.id,
            username: p.username,
            color: p.color,
            score: p.score,
            isHost: p.isHost,
            isDrawer: p.id === this.currentDrawerId,
            guessed: p.guessedThisTurn,
            connected: p.connected !== false
        }));

        this.onBroadcast('game:state_changed', {
            state: this.state,
            round: this.currentRound,
            totalRounds: this.totalRounds,
            drawTime: this.drawTime,
            drawerId: this.currentDrawerId,
            drawerName: this.players.get(this.currentDrawerId)?.username || '',
            wordClue: this.getWordClue(),
            wordLength: this.currentWord ? this.currentWord.replace(/\s/g, '').length : 0,
            timeLeft: this.timeLeft,
            players: playersList
        });
    }

    broadcastTime() {
        if (this.onBroadcast) {
            this.onBroadcast('game:timer_tick', { timeLeft: this.timeLeft });
        }
    }

    broadcastChat(messagePayload) {
        if (this.onBroadcast) {
            this.onBroadcast('chat:message', {
                ...messagePayload,
                message: messagePayload,
                msgType: messagePayload.type
            });
        }
    }

    clearTimer() {
        if (this.timerInterval) {
            clearInterval(this.timerInterval);
            this.timerInterval = null;
        }
        if (this.disconnectTimers) {
            this.disconnectTimers.forEach(t => clearTimeout(t));
            this.disconnectTimers.clear();
        }
    }
}

module.exports = {
    GameEngine,
    GAME_STATES
};
