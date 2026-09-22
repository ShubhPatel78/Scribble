/**
 * PerfectFreehand + Catmull-Rom Spline Drawing Library
 *
 * Implements:
 * 1. Pressure-sensitive vector stroke polygon generator (getStroke)
 * 2. Catmull-Rom spline curve interpolator for ultra-smooth organic strokes
 */

(function (global) {
    'use strict';

    // =========================================================================
    // Vector & Math Helper Functions
    // =========================================================================

    function vec(x, y) {
        return { x: Number(x) || 0, y: Number(y) || 0 };
    }

    function vecAdd(a, b) {
        return { x: a.x + b.x, y: a.y + b.y };
    }

    function vecSub(a, b) {
        return { x: a.x - b.x, y: a.y - b.y };
    }

    function vecMul(a, n) {
        return { x: a.x * n, y: a.y * n };
    }

    function vecDiv(a, n) {
        return { x: a.x / (n || 1), y: a.y / (n || 1) };
    }

    function vecDist(a, b) {
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        return Math.hypot(dx, dy);
    }

    function vecDist2(a, b) {
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        return dx * dx + dy * dy;
    }

    function vecMed(a, b) {
        return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    }

    function vecLrp(a, b, t) {
        return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    }

    function vecPer(a) {
        return { x: -a.y, y: a.x };
    }

    function vecRot(a, angle) {
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        return {
            x: a.x * cos - a.y * sin,
            y: a.x * sin + a.y * cos
        };
    }

    function clamp(n, min, max) {
        return Math.max(min, Math.min(max, n));
    }

    function normalizePoint(p) {
        if (Array.isArray(p)) {
            return {
                x: p[0],
                y: p[1],
                pressure: p[2] !== undefined ? p[2] : 0.5
            };
        }
        return {
            x: p.x,
            y: p.y,
            pressure: p.pressure !== undefined ? p.pressure : 0.5
        };
    }

    // =========================================================================
    // Stroke Points Computation
    // =========================================================================

    function getStrokePoints(rawPoints, options = {}) {
        if (!rawPoints || rawPoints.length === 0) return [];

        const {
            streamline = 0.5,
            size = 16,
            simulatePressure = true
        } = options;

        const pts = rawPoints.map(normalizePoint);
        if (pts.length === 1) {
            pts.push({ ...pts[0], x: pts[0].x + 0.01, y: pts[0].y + 0.01 });
        }

        const strokePoints = [];
        let prev = pts[0];
        let runningLength = 0;

        // Initialize first stroke point
        strokePoints.push({
            point: { x: prev.x, y: prev.y },
            pressure: prev.pressure,
            distance: 0,
            vector: { x: 1, y: 1 },
            runningLength: 0
        });

        // Minimum distance to prevent duplicate overlapping collinear points
        const minDistance = size * 0.05;

        for (let i = 1; i < pts.length; i++) {
            const curr = pts[i];
            const d = vecDist(prev, curr);

            if (d < minDistance && i < pts.length - 1) {
                continue;
            }

            // Streamlining filter
            const smoothedPoint = vecLrp(prev, curr, 1 - streamline);

            // Compute simulated velocity/distance pressure if not provided by hardware stylus
            let pressure = curr.pressure;
            if (simulatePressure && (pressure === 0.5 || pressure === 0 || pressure === undefined)) {
                // Lower pressure at high speed / large distance (calligraphic effect)
                const speed = d;
                pressure = clamp(1 - (speed / (size * 2)), 0.2, 0.95);
            }

            runningLength += d;
            const vector = d > 0 ? vecDiv(vecSub(curr, prev), d) : strokePoints[strokePoints.length - 1].vector;

            strokePoints.push({
                point: smoothedPoint,
                pressure,
                distance: d,
                vector,
                runningLength
            });

            prev = smoothedPoint;
        }

        return strokePoints;
    }

    // =========================================================================
    // Stroke Outline Points (Polygon generator)
    // =========================================================================

    function getStrokeOutlinePoints(strokePoints, options = {}) {
        if (!strokePoints || strokePoints.length === 0) return [];

        const {
            size = 16,
            thinning = 0.5,
            smoothing = 0.5,
            easing = (t) => t,
            start = {},
            end = {}
        } = options;

        const {
            cap: capStart = true,
            taper: taperStart = 0
        } = start;

        const {
            cap: capEnd = true,
            taper: taperEnd = 0
        } = end;

        const totalLength = strokePoints[strokePoints.length - 1].runningLength;
        const leftPts = [];
        const rightPts = [];

        for (let i = 0; i < strokePoints.length; i++) {
            const curr = strokePoints[i];
            const { point, vector, pressure, runningLength } = curr;

            // Radius calculation with pressure thinning & taper
            let r = (size / 2) * (1 - thinning * (1 - 2 * (pressure - 0.5)));

            // Apply start taper
            if (taperStart > 0 && runningLength < taperStart) {
                const t = runningLength / taperStart;
                r *= easing(t);
            }

            // Apply end taper
            if (taperEnd > 0 && totalLength - runningLength < taperEnd) {
                const t = (totalLength - runningLength) / taperEnd;
                r *= easing(t);
            }

            r = Math.max(r, 0.5);

            // Perpendicular normal vector
            const perp = vecPer(vector);

            leftPts.push(vecAdd(point, vecMul(perp, r)));
            rightPts.push(vecSub(point, vecMul(perp, r)));
        }

        // Generate complete closed outline polygon
        const outline = [];

        // Start cap
        if (capStart) {
            const first = strokePoints[0];
            const perp = vecPer(first.vector);
            const r = (size / 2);
            const steps = 6;
            for (let i = 0; i <= steps; i++) {
                const angle = Math.PI + (Math.PI * i) / steps;
                const offset = vecRot(perp, angle);
                outline.push(vecAdd(first.point, vecMul(offset, r * 0.8)));
            }
        }

        // Left boundary
        for (let i = 0; i < leftPts.length; i++) {
            outline.push(leftPts[i]);
        }

        // End cap
        if (capEnd) {
            const last = strokePoints[strokePoints.length - 1];
            const perp = vecPer(last.vector);
            const r = (size / 2);
            const steps = 6;
            for (let i = 0; i <= steps; i++) {
                const angle = (Math.PI * i) / steps;
                const offset = vecRot(perp, angle);
                outline.push(vecAdd(last.point, vecMul(offset, r * 0.8)));
            }
        }

        // Right boundary (reversed)
        for (let i = rightPts.length - 1; i >= 0; i--) {
            outline.push(rightPts[i]);
        }

        return outline;
    }

    /**
     * getStroke: Main entry point for perfect-freehand stroke polygon calculation.
     */
    function getStroke(points, options = {}) {
        if (!points || points.length === 0) return [];
        const strokePoints = getStrokePoints(points, options);
        return getStrokeOutlinePoints(strokePoints, options);
    }

    // =========================================================================
    // Catmull-Rom Spline Curve Interpolation
    // =========================================================================

    /**
     * Converts a Catmull-Rom spline segment (p0, p1, p2, p3) with tension alpha
     * into a standard Cubic Bézier curve on a Canvas2D rendering context.
     */
    function renderCatmullRomStroke(ctx, outlinePoints, isClosed = true) {
        if (!outlinePoints || outlinePoints.length === 0) return;

        const n = outlinePoints.length;
        if (n < 3) {
            // Degenerate outline: draw small circular dot
            ctx.beginPath();
            ctx.arc(outlinePoints[0].x, outlinePoints[0].y, 2, 0, Math.PI * 2);
            ctx.fill();
            return;
        }

        ctx.beginPath();
        ctx.moveTo(outlinePoints[0].x, outlinePoints[0].y);

        // Catmull-Rom to Cubic Bézier conversion
        // CP1 = P1 + (P2 - P0) / 6
        // CP2 = P2 - (P3 - P1) / 6
        for (let i = 0; i < n; i++) {
            const p0 = outlinePoints[(i - 1 + n) % n];
            const p1 = outlinePoints[i];
            const p2 = outlinePoints[(i + 1) % n];
            const p3 = outlinePoints[(i + 2) % n];

            const cp1x = p1.x + (p2.x - p0.x) / 6;
            const cp1y = p1.y + (p2.y - p0.y) / 6;
            const cp2x = p2.x - (p3.x - p1.x) / 6;
            const cp2y = p2.y - (p3.y - p1.y) / 6;

            ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, p2.x, p2.y);
        }

        if (isClosed) {
            ctx.closePath();
        }

        ctx.fill();
    }

    // Expose API on global window
    global.PerfectFreehand = {
        getStroke,
        getStrokePoints,
        getStrokeOutlinePoints,
        renderCatmullRomStroke
    };

})(typeof window !== 'undefined' ? window : globalThis);
