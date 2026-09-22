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
