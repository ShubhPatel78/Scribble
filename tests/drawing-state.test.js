const test = require('node:test');
const assert = require('node:assert/strict');
const DrawingState = require('../server/drawing-state');

test('DrawingState - adds and retrieves operations', () => {
    const state = new DrawingState();
    const op = {
        id: 'op-1',
        userId: 'user_1',
        type: 'stroke',
        points: [{ x: 10, y: 10 }, { x: 20, y: 20 }],
        color: '#ff0000',
        width: 4
    };

    state.addOperation(op);
    assert.equal(state.operations.length, 1);
    assert.equal(state.getActiveOperations().length, 1);
    assert.equal(state.getActiveOperations()[0].id, 'op-1');
});

test('DrawingState - per-user non-destructive undo', () => {
    const state = new DrawingState();

    // User 1 draws stroke 1
    state.addOperation({ id: 'u1-op1', userId: 'user_1', type: 'stroke' });
    // User 2 draws stroke 2
    state.addOperation({ id: 'u2-op1', userId: 'user_2', type: 'stroke' });
    // User 1 draws stroke 3
    state.addOperation({ id: 'u1-op2', userId: 'user_1', type: 'stroke' });

    assert.equal(state.getActiveOperations().length, 3);

    // User 1 executes undo -> should undo u1-op2, leaving u2-op1 and u1-op1 active
    const undone = state.undo('user_1');
    assert.equal(undone.id, 'u1-op2');
    assert.equal(undone.undone, true);

    const activeOps = state.getActiveOperations();
    assert.equal(activeOps.length, 2);
    assert.equal(activeOps[0].id, 'u1-op1');
    assert.equal(activeOps[1].id, 'u2-op1'); // User 2 stroke was NOT erased!

    // User 2 executes undo -> should undo u2-op1
    const undone2 = state.undo('user_2');
    assert.equal(undone2.id, 'u2-op1');

    const activeOps2 = state.getActiveOperations();
    assert.equal(activeOps2.length, 1);
    assert.equal(activeOps2[0].id, 'u1-op1');
});

test('DrawingState - per-user redo restores the correct operation', () => {
    const state = new DrawingState();

    state.addOperation({ id: 'op-1', userId: 'user_1', type: 'stroke' });
    state.undo('user_1');
    assert.equal(state.getActiveOperations().length, 0);

    const redone = state.redo('user_1');
    assert.equal(redone.id, 'op-1');
    assert.equal(redone.undone, false);
    assert.equal(state.getActiveOperations().length, 1);
});

test('DrawingState - new stroke clears redo history for that user', () => {
    const state = new DrawingState();

    state.addOperation({ id: 'op-1', userId: 'user_1', type: 'stroke' });
    state.undo('user_1');

    // User draws something new
    state.addOperation({ id: 'op-2', userId: 'user_1', type: 'stroke' });

    // Redo should now be null
    const redone = state.redo('user_1');
    assert.equal(redone, null);
    assert.equal(state.getActiveOperations().length, 1);
    assert.equal(state.getActiveOperations()[0].id, 'op-2');
});

test('DrawingState - snapshot and restore', () => {
    const state = new DrawingState();
    state.addOperation({ id: 'op-1', userId: 'user_1', type: 'rectangle', x0: 0, y0: 0, x1: 50, y1: 50 });
    state.addOperation({ id: 'op-2', userId: 'user_2', type: 'circle', x0: 10, y0: 10, x1: 60, y1: 60 });

    const snapshot = state.getSnapshot();
    assert.equal(snapshot.activeCount, 2);

    const newState = new DrawingState();
    newState.restoreFromSnapshot(snapshot);
    assert.equal(newState.getActiveOperations().length, 2);
    assert.equal(newState.getActiveOperations()[0].type, 'rectangle');
    assert.equal(newState.getActiveOperations()[1].type, 'circle');
});

test('DrawingState - enforces maxOperations budget', () => {
    const state = new DrawingState({ maxOperations: 3 });
    state.addOperation({ id: 'op-1', userId: 'u1' });
    state.addOperation({ id: 'op-2', userId: 'u1' });
    state.addOperation({ id: 'op-3', userId: 'u1' });
    state.addOperation({ id: 'op-4', userId: 'u1' });

    assert.equal(state.operations.length, 3);
    assert.equal(state.operations[0].id, 'op-2');
    assert.equal(state.operations[2].id, 'op-4');
});
