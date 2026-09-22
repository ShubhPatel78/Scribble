const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const vm = require('vm');

// Load client/perfect-freehand.js into a sandboxed environment
const code = fs.readFileSync(__dirname + '/../client/perfect-freehand.js', 'utf8');
const context = { window: {}, globalThis: {} };
vm.createContext(context);
vm.runInContext(code, context);
const PerfectFreehand = context.window.PerfectFreehand || context.globalThis.PerfectFreehand;

test('PerfectFreehand - getStroke returns polygon outline for points', () => {
    assert.ok(PerfectFreehand, 'PerfectFreehand should be defined');

    const points = [
        { x: 10, y: 10 },
        { x: 20, y: 20 },
        { x: 30, y: 15 },
        { x: 40, y: 25 }
    ];

    const outline = PerfectFreehand.getStroke(points, {
        size: 8,
        thinning: 0.5,
        smoothing: 0.5,
        simulatePressure: true
    });

    assert.ok(Array.isArray(outline), 'Outline should be an array');
    assert.ok(outline.length > points.length, 'Outline polygon should contain boundary points');

    outline.forEach(pt => {
        assert.ok(typeof pt.x === 'number' && !isNaN(pt.x), 'pt.x must be a valid number');
        assert.ok(typeof pt.y === 'number' && !isNaN(pt.y), 'pt.y must be a valid number');
    });
});

test('PerfectFreehand - handles single point and empty points gracefully', () => {
    const emptyOutline = PerfectFreehand.getStroke([]);
    assert.strictEqual(emptyOutline.length, 0);

    const singlePointOutline = PerfectFreehand.getStroke([{ x: 50, y: 50, pressure: 0.8 }], { size: 10 });
    assert.ok(singlePointOutline.length > 0, 'Single point should produce outline vertices');
});

test('PerfectFreehand - renderCatmullRomStroke calls Canvas2D Bézier curve methods', () => {
    const bezierCalls = [];
    let fillCalled = false;
    let beginPathCalled = false;

    const mockCtx = {
        beginPath() { beginPathCalled = true; },
        moveTo(x, y) {},
        bezierCurveTo(cp1x, cp1y, cp2x, cp2y, x, y) {
            bezierCalls.push({ cp1x, cp1y, cp2x, cp2y, x, y });
        },
        closePath() {},
        arc() {},
        fill() { fillCalled = true; }
    };

    const outlinePoints = [
        { x: 10, y: 10 },
        { x: 20, y: 10 },
        { x: 25, y: 20 },
        { x: 15, y: 25 },
        { x: 5, y: 15 }
    ];

    PerfectFreehand.renderCatmullRomStroke(mockCtx, outlinePoints, true);

    assert.ok(beginPathCalled, 'beginPath should be called');
    assert.ok(bezierCalls.length === outlinePoints.length, 'Catmull-Rom should generate smooth Bézier segments for all points');
    assert.ok(fillCalled, 'fill should be called to rasterize the smooth stroke');
});
