const test = require('node:test');
const assert = require('node:assert/strict');
const { GameEngine, GAME_STATES } = require('../server/game-engine');
const { isCloseGuess, normalizeWord } = require('../server/words');

test('words utility - normalization and close guess detection', () => {
    assert.equal(normalizeWord('  Apple!  '), 'apple');
    assert.equal(normalizeWord('Ice-Cream'), 'ice cream');
    assert.equal(isCloseGuess('aple', 'apple'), true);
    assert.equal(isCloseGuess('apples', 'apple'), true);
    assert.equal(isCloseGuess('banana', 'apple'), false);
});

test('GameEngine - player management & host assignment', () => {
    const broadcasts = [];
    const userMessages = [];

    const game = new GameEngine();
    game.onBroadcast = (event, payload) => broadcasts.push({ event, payload });
    game.onSend = (userId, event, payload) => userMessages.push({ userId, event, payload });
    game.onClearCanvas = () => {};

    // Add first player -> should be host
    game.addPlayer({ id: 'u1', username: 'Alice', color: '#ff0000' });
    assert.equal(game.players.size, 1);
    const p1 = game.players.get('u1');
    assert.equal(p1.isHost, true);
    assert.equal(p1.score, 0);

    // Add second player -> not host
    game.addPlayer({ id: 'u2', username: 'Bob', color: '#00ff00' });
    assert.equal(game.players.size, 2);
    const p2 = game.players.get('u2');
    assert.equal(p2.isHost, false);

    // Remove first player -> second player promoted to host
    game.removePlayer('u1');
    assert.equal(game.players.size, 1);
    assert.equal(game.players.get('u2').isHost, true);

    game.clearTimer();
});

test('GameEngine - start game and word choice', () => {
    const broadcasts = [];
    const userMessages = [];

    const game = new GameEngine();
    game.onBroadcast = (event, payload) => broadcasts.push({ event, payload });
    game.onSend = (userId, event, payload) => userMessages.push({ userId, event, payload });
    game.onClearCanvas = () => {};

    game.addPlayer({ id: 'u1', username: 'Alice', color: '#ff0000' });
    game.addPlayer({ id: 'u2', username: 'Bob', color: '#00ff00' });

    // Start game
    const result = game.startGame('u1');
    assert.equal(result.success, true);
    assert.equal(game.state, GAME_STATES.CHOOSING_WORD);
    assert.equal(game.currentDrawerId, 'u1');

    // Drawer should have received word options
    const drawerWordMsg = userMessages.find(m => m.userId === 'u1' && m.event === 'game:word_options');
    assert.ok(drawerWordMsg);
    assert.equal(drawerWordMsg.payload.words.length, 3);

    // Drawer selects a word
    const chosenWord = drawerWordMsg.payload.words[0];
    game.selectWord('u1', chosenWord);

    assert.equal(game.state, GAME_STATES.DRAWING);
    assert.equal(game.currentWord, chosenWord);
    assert.ok(game.getWordClue().length > 0);

    game.clearTimer();
});

test('GameEngine - guessing, speed scoring, and close guess hints', () => {
    const broadcasts = [];
    const userMessages = [];

    const game = new GameEngine();
    game.onBroadcast = (event, payload) => broadcasts.push({ event, payload });
    game.onSend = (userId, event, payload) => userMessages.push({ userId, event, payload });
    game.onClearCanvas = () => {};

    game.addPlayer({ id: 'u1', username: 'Alice', color: '#ff0000' });
    game.addPlayer({ id: 'u2', username: 'Bob', color: '#00ff00' });
    game.addPlayer({ id: 'u3', username: 'Charlie', color: '#0000ff' });

    game.startGame('u1');
    game.selectWord('u1', 'guitar');

    // Guesser sends close guess
    userMessages.length = 0;
    const chatClose = game.handleChatMessage('u2', 'gitar');
    assert.equal(chatClose.close, true);
    const closeNote = userMessages.find(m => m.userId === 'u2' && m.event === 'chat:message');
    assert.ok(closeNote);
    assert.equal(closeNote.payload.type, 'close_guess');

    // Guesser sends correct guess
    const chatCorrect = game.handleChatMessage('u2', 'guitar');
    assert.equal(chatCorrect.correct, true);

    const p2 = game.players.get('u2');
    const p1 = game.players.get('u1');
    assert.equal(p2.guessedThisTurn, true);
    assert.ok(p2.score > 0, 'Guesser should have received score');
    // Guesser attempts chatting after guessing -> is regular chat
    const afterGuessChat = game.handleChatMessage('u2', 'nice drawing!');
    assert.equal(afterGuessChat.isGuess, false);

    // If guesser accidentally types secret word again -> returns null to prevent chat spoiler
    const spoilChat = game.handleChatMessage('u2', 'guitar');
    assert.equal(spoilChat, null);

    game.clearTimer();
});

test('GameEngine - winner podium ranking', () => {
    const game = new GameEngine();

    game.addPlayer({ id: 'u1', username: 'Alice', color: '#ff0000' });
    game.addPlayer({ id: 'u2', username: 'Bob', color: '#00ff00' });
    game.addPlayer({ id: 'u3', username: 'Charlie', color: '#0000ff' });

    game.players.get('u1').score = 250;
    game.players.get('u2').score = 500;
    game.players.get('u3').score = 100;

    const podium = game.getPodium();
    assert.equal(podium.length, 3);
    assert.equal(podium[0].username, 'Bob');
    assert.equal(podium[1].username, 'Alice');
    assert.equal(podium[2].username, 'Charlie');

    game.clearTimer();
});

test('GameEngine - custom timer and room settings', () => {
    const game = new GameEngine({ drawTime: 45, totalRounds: 5 });
    assert.equal(game.drawTime, 45);
    assert.equal(game.totalRounds, 5);

    game.addPlayer({ id: 'u1', username: 'Alice', color: '#ff0000' });
    game.addPlayer({ id: 'u2', username: 'Bob', color: '#00ff00' });

    // Host updates settings
    const updateRes = game.updateSettings('u1', { drawTime: 90, totalRounds: 2 });
    assert.equal(updateRes.success, true);
    assert.equal(game.drawTime, 90);
    assert.equal(game.totalRounds, 2);

    // Non-host cannot update settings
    const nonHostRes = game.updateSettings('u2', { drawTime: 30 });
    assert.ok(nonHostRes.error);

    game.clearTimer();
});

test('GameEngine - session reconnection retains score, host, and player state', () => {
    const game = new GameEngine();
    game.onBroadcast = () => {};
    game.onSend = () => {};
    game.onClearCanvas = () => {};

    // Initial player joins with sessionId
    game.addPlayer({ id: 'u1', sessionId: 'sess_123', username: 'Alice', color: '#ff0000' });
    const p1 = game.players.get('u1');
    p1.score = 350;
    assert.equal(p1.isHost, true);

    // Player disconnects temporarily
    game.handlePlayerDisconnect('u1');
    assert.equal(p1.connected, false);
    assert.ok(game.disconnectTimers.has('u1'), 'Grace period timer should be active');

    // Player reconnects on a new socket connection (id: 'u1_new') with same sessionId
    game.addPlayer({ id: 'u1_new', sessionId: 'sess_123', username: 'Alice' });

    assert.equal(game.players.size, 1);
    const restoredP1 = game.players.get('u1_new');
    assert.ok(restoredP1, 'Player should be indexed under new socket ID');
    assert.equal(restoredP1.score, 350, 'Score must be retained');
    assert.equal(restoredP1.isHost, true, 'Host status must be retained');
    assert.equal(restoredP1.connected, true, 'Connected flag set to true');
    assert.equal(game.disconnectTimers.has('u1'), false, 'Disconnect timer must be cancelled');

    game.clearTimer();
});

test('GameEngine - voluntary exit immediately removes player and advances turn/host', () => {
    const broadcasts = [];
    const game = new GameEngine();
    game.onBroadcast = (event, payload) => broadcasts.push({ event, payload });
    game.onSend = () => {};
    game.onClearCanvas = () => {};

    game.addPlayer({ id: 'u1', username: 'Alice', color: '#ff0000' });
    game.addPlayer({ id: 'u2', username: 'Bob', color: '#00ff00' });

    game.startGame('u1');
    game.selectWord('u1', 'banana');
    assert.equal(game.state, GAME_STATES.DRAWING);
    assert.equal(game.currentDrawerId, 'u1');

    // Alice (drawer & host) leaves voluntarily mid-game
    game.leavePlayer('u1');

    assert.equal(game.players.size, 1);
    assert.equal(game.players.has('u1'), false);
    assert.equal(game.players.get('u2').isHost, true, 'Bob is promoted to host');
    // Drawer left -> turn ends
    assert.equal(game.state, GAME_STATES.ROUND_END);

    game.clearTimer();
});

test('GameEngine - normal in-game chatting for drawer and guessers with spoiler prevention', () => {
    const broadcasts = [];
    const userMessages = [];
    const game = new GameEngine();
    game.onBroadcast = (event, payload) => broadcasts.push({ event, payload });
    game.onSend = (userId, event, payload) => userMessages.push({ userId, event, payload });
    game.onClearCanvas = () => {};

    game.addPlayer({ id: 'u1', username: 'Alice', color: '#ff0000' });
    game.addPlayer({ id: 'u2', username: 'Bob', color: '#00ff00' });

    // 1. Normal chat in LOBBY
    broadcasts.length = 0;
    const lobbyChat = game.handleChatMessage('u2', 'Hello everyone! Ready to play?');
    assert.equal(lobbyChat.isGuess, false);
    assert.equal(broadcasts.length, 1);
    assert.equal(broadcasts[0].event, 'chat:message');
    assert.equal(broadcasts[0].payload.text, 'Hello everyone! Ready to play?');

    // 2. Start Game
    game.startGame('u1');
    game.selectWord('u1', 'elephant');

    // 3. Normal chat from Drawer during drawing phase
    broadcasts.length = 0;
    const drawerChat = game.handleChatMessage('u1', 'Check out my masterpiece!');
    assert.equal(drawerChat.isGuess, false);
    assert.equal(broadcasts.length, 1);
    assert.equal(broadcasts[0].payload.text, 'Check out my masterpiece!');
    assert.equal(broadcasts[0].payload.isDrawer, true);

    // 4. Drawer attempts to spoil the secret word in chat -> blocked with private warning
    broadcasts.length = 0;
    userMessages.length = 0;
    const drawerSpoil = game.handleChatMessage('u1', 'I am drawing an elephant');
    assert.equal(drawerSpoil, null, 'Spoiler must be blocked');
    assert.equal(broadcasts.length, 0, 'No broadcast to other players');
    const warningMsg = userMessages.find(m => m.userId === 'u1');
    assert.ok(warningMsg, 'Drawer receives private spoiler warning');
    assert.ok(warningMsg.payload.text.includes('cannot reveal'));

    // 5. Guesser chats normally without guessing
    broadcasts.length = 0;
    const guesserNormalChat = game.handleChatMessage('u2', 'Is it an animal?');
    assert.equal(guesserNormalChat.isGuess, false);
    assert.equal(broadcasts.length, 1);
    assert.equal(broadcasts[0].payload.text, 'Is it an animal?');

    game.clearTimer();
});

test('GameEngine - 10s round leaderboard shows word reveal, fastest guesser, and standings', () => {
    const broadcasts = [];
    const game = new GameEngine();
    game.onBroadcast = (event, payload) => broadcasts.push({ event, payload });
    game.onSend = () => {};
    game.onClearCanvas = () => {};

    assert.equal(game.roundEndTime, 10, 'Default round end time should be 10 seconds');

    game.addPlayer({ id: 'u1', username: 'Alice', color: '#ff0000' });
    game.addPlayer({ id: 'u2', username: 'Bob', color: '#00ff00' });
    game.addPlayer({ id: 'u3', username: 'Charlie', color: '#0000ff' });

    game.startGame('u1');
    game.selectWord('u1', 'pyramid');

    // Bob guesses first (fastest)
    game.timeLeft = 55; // 55s left -> high speed score
    game.handleChatMessage('u2', 'pyramid');

    // Charlie guesses later
    game.timeLeft = 20; // 20s left -> lower speed score
    game.handleChatMessage('u3', 'pyramid');

    // Round ends (all guessed)
    assert.equal(game.state, GAME_STATES.ROUND_END);
    assert.equal(game.timeLeft, 10, 'Time left should be 10 seconds');

    const roundEndEvent = broadcasts.find(b => b.event === 'game:round_end');
    assert.ok(roundEndEvent, 'game:round_end event should be broadcast');
    const summary = roundEndEvent.payload;

    assert.equal(summary.word, 'pyramid', 'Word must be revealed');
    assert.equal(summary.timeLeft, 10);
    assert.equal(summary.drawer.username, 'Alice');
    assert.ok(summary.drawer.points > 0, 'Drawer earned points for successful guesses');

    // Bob should be the fastest guesser with higher points
    assert.equal(summary.turnScores[0].userId, 'u2');
    assert.equal(summary.turnScores[0].isFastest, true);
    assert.ok(summary.turnScores[0].points > summary.turnScores[1].points);

    // Leaderboard has all 3 players
    assert.equal(summary.leaderboard.length, 3);

    game.clearTimer();
});

