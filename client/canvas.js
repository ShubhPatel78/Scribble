/**
 * CanvasEngine: Production-grade 2D infinite canvas with Pan & Zoom,
 * HiDPI Retina support, normalized coordinate projection, and shape renderers.
 */

class CanvasEngine {
    constructor(viewportElement, drawingCanvas, overlayCanvas) {
        this.viewport = viewportElement;
        this.drawingCanvas = drawingCanvas;
        this.overlayCanvas = overlayCanvas;

        this.ctx = drawingCanvas.getContext('2d');
        this.overlayCtx = overlayCanvas.getContext('2d');

        // Viewport Transform Matrix
        this.zoom = 1.0;
        this.minZoom = 0.2;
        this.maxZoom = 4.0;
        this.panX = 0;
        this.panY = 0;
        this.dpr = window.devicePixelRatio || 1;

        // Current tool settings
        this.currentTool = 'brush'; // 'brush' | 'line' | 'rectangle' | 'circle' | 'eraser' | 'pan'
        this.currentColor = '#3B82F6';
        this.currentWidth = 4;
        this.isFillEnabled = false;

        // Interactive drawing state
        this.isInteracting = false;
        this.isPanning = false;
        this.panStartX = 0;
        this.panStartY = 0;
        this.activeShapeStart = null; // { x, y } in world coordinates
        this.activeStrokePoints = []; // [{ x, y }] in world coordinates
        this.lastEraserPoint = null;  // last point painted — for incremental erase

        // In-flight remote live strokes and cursors
        this.remoteLiveStrokes = new Map(); // userId -> { points, color, width, tool }
        this.remoteCursors = new Map(); // userId -> { x, y, username, color }

        // Callbacks
        this.onCommitOperation = null; // (op) => void
        this.onLiveStroke = null; // (strokeData) => void
        this.onCursorMove = null; // (worldX, worldY) => void
        this.onZoomChange = null; // (zoom) => void

        this.init();
    }

    init() {
        this.resize();
        window.addEventListener('resize', () => this.resize());
        if (typeof window.ResizeObserver !== 'undefined') {
            const ro = new ResizeObserver(() => this.resize());
            ro.observe(this.viewport);
            if (this.viewport.parentElement) {
                ro.observe(this.viewport.parentElement);
            }
        }
        requestAnimationFrame(() => this.resize());
        setTimeout(() => this.resize(), 100);
        this.bindEvents();
    }

    /**
     * Resizes canvases matching container dimensions and DPI.
     */
    resize() {
        const width = Math.max(this.viewport.clientWidth, this.viewport.offsetWidth, 100);
        const height = Math.max(this.viewport.clientHeight, this.viewport.offsetHeight, 100);
        this.dpr = window.devicePixelRatio || 1;

        [this.drawingCanvas, this.overlayCanvas].forEach(canvas => {
            canvas.width = width * this.dpr;
            canvas.height = height * this.dpr;
            canvas.style.width = `${width}px`;
            canvas.style.height = `${height}px`;
        });

        if (this.onNeedsRedraw) {
            this.onNeedsRedraw();
        }
    }

    /**
     * Converts screen coordinates (MouseEvent clientX, clientY) to world coordinates.
     */
    screenToWorld(clientX, clientY) {
        const rect = this.viewport.getBoundingClientRect();
        const sx = clientX - rect.left;
        const sy = clientY - rect.top;
        return {
            x: (sx - this.panX) / this.zoom,
            y: (sy - this.panY) / this.zoom
        };
    }

    /**
     * Converts world coordinates to screen coordinates.
     */
    worldToScreen(worldX, worldY) {
        return {
            x: worldX * this.zoom + this.panX,
            y: worldY * this.zoom + this.panY
        };
    }

    setZoom(newZoom, centerX = null, centerY = null) {
        const clampedZoom = Math.min(Math.max(newZoom, this.minZoom), this.maxZoom);
        if (Math.abs(clampedZoom - this.zoom) < 0.001) return;

        const rect = this.viewport.getBoundingClientRect();
        const cx = centerX !== null ? centerX - rect.left : rect.width / 2;
        const cy = centerY !== null ? centerY - rect.top : rect.height / 2;

        // Zoom relative to pivot point
        this.panX = cx - (cx - this.panX) * (clampedZoom / this.zoom);
        this.panY = cy - (cy - this.panY) * (clampedZoom / this.zoom);
        this.zoom = clampedZoom;

        if (this.onZoomChange) {
            this.onZoomChange(this.zoom);
        }

        if (this.onNeedsRedraw) {
            this.onNeedsRedraw();
        }
        this.renderOverlay();
    }

    resetView() {
        this.zoom = 1.0;
        this.panX = 0;
        this.panY = 0;
        if (this.onZoomChange) this.onZoomChange(this.zoom);
        if (this.onNeedsRedraw) this.onNeedsRedraw();
        this.renderOverlay();
    }

    bindEvents() {
        // Pointer down
        this.viewport.addEventListener('pointerdown', (e) => {
            // Middle mouse button or Space key or Pan tool triggers pan
            if (e.button === 1 || this.currentTool === 'pan' || e.spaceKey) {
                this.isPanning = true;
                this.panStartX = e.clientX - this.panX;
                this.panStartY = e.clientY - this.panY;
                this.viewport.classList.add('panning');
                return;
            }

            if (e.button !== 0) return; // Only primary button draws

            try {
                if (e.pointerId !== undefined) {
                    this.viewport.setPointerCapture(e.pointerId);
                }
            } catch (_) {}

            const world = this.screenToWorld(e.clientX, e.clientY);
            this.isInteracting = true;
            this.activeShapeStart = world;
            this.activeStrokePoints = [world];

            if (this.currentTool === 'fill-bucket') {
                const opId = `op_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
                const op = {
                    id: opId,
                    type: 'fill-bucket',
                    color: this.currentColor,
                    seedX: world.x,
                    seedY: world.y
                };
                this.executeFloodFill(this.ctx, world.x, world.y, this.currentColor);
                if (this.onCommitOperation) {
                    this.onCommitOperation(op);
                }
                return;
            }

            if (this.currentTool === 'eraser') {
                // Paint initial erase dot directly on drawing canvas
                this.lastEraserPoint = world;
                this._paintEraserSegment(world, world);
            } else if (this.currentTool === 'brush') {
                if (this.onLiveStroke) {
                    this.onLiveStroke({
                        type: 'brush',
                        tool: 'brush',
                        color: this.currentColor,
                        width: this.currentWidth,
                        points: [...this.activeStrokePoints]
                    });
                }
            }
            this.renderOverlay();
        });

        // Pointer move
        this.viewport.addEventListener('pointermove', (e) => {
            if (this.isPanning) {
                this.panX = e.clientX - this.panStartX;
                this.panY = e.clientY - this.panStartY;
                if (this.onNeedsRedraw) this.onNeedsRedraw();
                this.renderOverlay();
                return;
            }

            const world = this.screenToWorld(e.clientX, e.clientY);

            if (this.onCursorMove) {
                this.onCursorMove(world.x, world.y);
            }

            if (!this.isInteracting) return;

            if (this.currentTool === 'brush') {
                this.activeStrokePoints.push(world);
                // Throttle live stroke updates to remote peers
                if (this.onLiveStroke && this.activeStrokePoints.length % 2 === 0) {
                    this.onLiveStroke({
                        type: 'brush',
                        tool: 'brush',
                        color: this.currentColor,
                        width: this.currentWidth,
                        points: [...this.activeStrokePoints]
                    });
                }
                this.renderOverlay();
            } else if (this.currentTool === 'eraser') {
                this.activeStrokePoints.push(world);
                // Paint ONLY the new segment — O(1), no full redraw
                this._paintEraserSegment(this.lastEraserPoint || world, world);
                this.lastEraserPoint = world;
            } else {
                // Shapes: activeShapeStart is origin, world is current end
                this.activeStrokePoints = [this.activeShapeStart, world];
                this.renderOverlay();
            }
        });

        // Pointer up
        const endInteraction = (e) => {
            if (this.isPanning) {
                this.isPanning = false;
                this.viewport.classList.remove('panning');
                return;
            }

            if (e && e.pointerId !== undefined) {
                try {
                    this.viewport.releasePointerCapture(e.pointerId);
                } catch (_) {}
            }

            if (!this.isInteracting) return;
            this.isInteracting = false;

            const world = e ? this.screenToWorld(e.clientX, e.clientY) : this.activeStrokePoints[this.activeStrokePoints.length - 1];

            let operation = null;
            const opId = `op_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;

            if (this.currentTool === 'brush' || this.currentTool === 'eraser') {
                if (this.activeStrokePoints.length > 0) {
                    operation = {
                        id: opId,
                        type: this.currentTool,
                        color: this.currentColor,
                        width: this.currentWidth,
                        points: [...this.activeStrokePoints]
                    };
                }
            } else if (['rectangle', 'circle', 'line'].includes(this.currentTool)) {
                if (this.activeShapeStart) {
                    operation = {
                        id: opId,
                        type: this.currentTool,
                        color: this.currentColor,
                        width: this.currentWidth,
                        fill: this.isFillEnabled,
                        x0: this.activeShapeStart.x,
                        y0: this.activeShapeStart.y,
                        x1: world.x,
                        y1: world.y
                    };
                }
            }

            this.activeStrokePoints = [];
            this.activeShapeStart = null;
            this.lastEraserPoint = null;
            this.renderOverlay();

            if (operation && this.onCommitOperation) {
                this.onCommitOperation(operation);
            }
        };

        window.addEventListener('pointerup', endInteraction);
        window.addEventListener('pointercancel', endInteraction);

        // Mouse Wheel Zooming
        this.viewport.addEventListener('wheel', (e) => {
            e.preventDefault();
            const zoomDelta = e.deltaY < 0 ? 1.1 : 0.9;
            this.setZoom(this.zoom * zoomDelta, e.clientX, e.clientY);
        }, { passive: false });
    }

    /**
     * Paints one eraser segment directly on the drawing canvas.
     * O(1) per call — no full redraw needed.
     */
    _paintEraserSegment(from, to) {
        this.applyTransform(this.ctx);
        this.ctx.globalCompositeOperation = 'destination-out';
        this.ctx.strokeStyle = 'rgba(0,0,0,1)';
        this.ctx.fillStyle = 'rgba(0,0,0,1)';
        this.ctx.lineWidth = (this.currentWidth || 4) * 2;
        this.ctx.lineCap = 'round';
        this.ctx.lineJoin = 'round';

        if (from.x === to.x && from.y === to.y) {
            // Single click — paint a dot
            this.ctx.beginPath();
            this.ctx.arc(from.x, from.y, this.ctx.lineWidth / 2, 0, Math.PI * 2);
            this.ctx.fill();
        } else {
            this.ctx.beginPath();
            this.ctx.moveTo(from.x, from.y);
            this.ctx.lineTo(to.x, to.y);
            this.ctx.stroke();
        }

        this.ctx.restore(); // restore from applyTransform
    }

    /**
     * Parses a hex or rgb string into RGBA object.
     */
    parseColor(color) {
        if (!color) return { r: 59, g: 130, b: 246, a: 255 };
        if (color.startsWith('#')) {
            let hex = color.slice(1);
            if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
            if (hex.length === 6) {
                const num = parseInt(hex, 16);
                return {
                    r: (num >> 16) & 255,
                    g: (num >> 8) & 255,
                    b: num & 255,
                    a: 255
                };
            }
        }
        return { r: 59, g: 130, b: 246, a: 255 };
    }

    /**
     * Fast Queue-based Flood Fill algorithm with Boundary Dilation
     * to eliminate anti-aliasing gaps and fringes along stroke edges.
     */
    executeFloodFill(ctx, seedWorldX, seedWorldY, colorHex) {
        const screen = this.worldToScreen(seedWorldX, seedWorldY);
        const startX = Math.round(screen.x * this.dpr);
        const startY = Math.round(screen.y * this.dpr);
        const width = this.drawingCanvas.width;
        const height = this.drawingCanvas.height;

        if (startX < 0 || startX >= width || startY < 0 || startY >= height) return;

        const imgData = ctx.getImageData(0, 0, width, height);
        const data = imgData.data;

        const startIdx = (startY * width + startX) * 4;
        const targetR = data[startIdx];
        const targetG = data[startIdx + 1];
        const targetB = data[startIdx + 2];
        const targetA = data[startIdx + 3];

        const fillColor = this.parseColor(colorHex);

        // If clicking on same color, skip
        if (Math.abs(targetR - fillColor.r) + Math.abs(targetG - fillColor.g) +
            Math.abs(targetB - fillColor.b) + Math.abs(targetA - fillColor.a) < 15) {
            return;
        }

        const tolerance = 50;
        const visited = new Uint8Array(width * height);

        const match = (idx) => {
            return Math.abs(data[idx] - targetR) <= tolerance &&
                   Math.abs(data[idx + 1] - targetG) <= tolerance &&
                   Math.abs(data[idx + 2] - targetB) <= tolerance &&
                   Math.abs(data[idx + 3] - targetA) <= tolerance;
        };

        // Linear buffer queue for maximum speed
        const queue = new Int32Array(width * height);
        let head = 0;
        let tail = 0;

        const startPos = startY * width + startX;
        queue[tail++] = startPos;
        visited[startPos] = 1;

        // Step 1: Standard 4-way Flood Fill
        while (head < tail) {
            const pos = queue[head++];
            const cx = pos % width;
            const cy = (pos / width) | 0;

            if (cx > 0) {
                const nPos = pos - 1;
                if (!visited[nPos] && match(nPos * 4)) {
                    visited[nPos] = 1;
                    queue[tail++] = nPos;
                }
            }
            if (cx < width - 1) {
                const nPos = pos + 1;
                if (!visited[nPos] && match(nPos * 4)) {
                    visited[nPos] = 1;
                    queue[tail++] = nPos;
                }
            }
            if (cy > 0) {
                const nPos = pos - width;
                if (!visited[nPos] && match(nPos * 4)) {
                    visited[nPos] = 1;
                    queue[tail++] = nPos;
                }
            }
            if (cy < height - 1) {
                const nPos = pos + width;
                if (!visited[nPos] && match(nPos * 4)) {
                    visited[nPos] = 1;
                    queue[tail++] = nPos;
                }
            }
        }

        // Step 2: Dilation / Anti-Aliasing Edge Expansion (expand by ~2-3px into stroke boundary)
        // This completely eliminates the white gap/halo artifact along anti-aliased stroke edges.
        const dilationRadius = Math.max(2, Math.round(this.dpr * 1.5));
        const dilated = new Uint8Array(visited);
        let currentBoundary = [];

        for (let i = 0; i < tail; i++) {
            const pos = queue[i];
            const cx = pos % width;
            const cy = (pos / width) | 0;

            const isBorder = (cx > 0 && !visited[pos - 1]) ||
                             (cx < width - 1 && !visited[pos + 1]) ||
                             (cy > 0 && !visited[pos - width]) ||
                             (cy < height - 1 && !visited[pos + width]);

            if (isBorder) {
                currentBoundary.push(pos);
            }
        }

        for (let step = 0; step < dilationRadius; step++) {
            const nextBoundary = [];
            for (let i = 0; i < currentBoundary.length; i++) {
                const pos = currentBoundary[i];
                const cx = pos % width;
                const cy = (pos / width) | 0;

                const neighbors = [];
                if (cx > 0) neighbors.push(pos - 1);
                if (cx < width - 1) neighbors.push(pos + 1);
                if (cy > 0) neighbors.push(pos - width);
                if (cy < height - 1) neighbors.push(pos + width);

                for (let j = 0; j < neighbors.length; j++) {
                    const nPos = neighbors[j];
                    if (!dilated[nPos]) {
                        dilated[nPos] = 1;
                        nextBoundary.push(nPos);
                    }
                }
            }
            currentBoundary = nextBoundary;
        }

        // Step 3: Write filled & dilated pixels into image data
        for (let pos = 0; pos < width * height; pos++) {
            if (dilated[pos]) {
                const idx = pos * 4;
                const existingA = data[idx + 3];

                // Replace fully transparent and semi-transparent anti-aliased fringe pixels
                if (visited[pos] || existingA < 245) {
                    data[idx] = fillColor.r;
                    data[idx + 1] = fillColor.g;
                    data[idx + 2] = fillColor.b;
                    data[idx + 3] = 255;
                }
            }
        }

        ctx.putImageData(imgData, 0, 0);
    }

    /**
     * Applies world camera matrix transform to a 2D context.
     */
    applyTransform(ctx) {
        ctx.save();
        ctx.scale(this.dpr, this.dpr);
        ctx.translate(this.panX, this.panY);
        ctx.scale(this.zoom, this.zoom);
    }

    /**
     * Draws an operation (stroke, line, rectangle, circle).
     */
    drawOperation(ctx, op, isPreview = false) {
        if (!op) return;

        ctx.save();
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        const opType = op.type || op.tool || 'brush';

        if (opType === 'eraser') {
            if (isPreview) {
                // For live preview on overlay: paint white so it visually simulates erasing.
                // destination-out on a transparent overlay has no visible effect.
                ctx.strokeStyle = '#fafbfc';
                ctx.fillStyle = '#fafbfc';
                ctx.lineWidth = (op.width || 4) * 2;
            } else {
                // Committed eraser: genuinely remove pixels from the drawing canvas
                ctx.globalCompositeOperation = 'destination-out';
                ctx.strokeStyle = 'rgba(0,0,0,1)';
                ctx.fillStyle = 'rgba(0,0,0,1)';
                ctx.lineWidth = (op.width || 4) * 2;
            }
        } else {
            ctx.strokeStyle = op.color || '#000000';
            ctx.lineWidth = op.width || 3;
            ctx.fillStyle = op.color || '#000000';
        }

        switch (opType) {
            case 'brush':
            case 'eraser': {
                const pts = op.points;
                if (!pts || pts.length === 0) break;

                ctx.beginPath();
                if (pts.length === 1) {
                    ctx.arc(pts[0].x, pts[0].y, ctx.lineWidth / 2, 0, Math.PI * 2);
                    ctx.fill();
                } else {
                    ctx.moveTo(pts[0].x, pts[0].y);
                    for (let i = 1; i < pts.length - 1; i++) {
                        const midX = (pts[i].x + pts[i + 1].x) / 2;
                        const midY = (pts[i].y + pts[i + 1].y) / 2;
                        ctx.quadraticCurveTo(pts[i].x, pts[i].y, midX, midY);
                    }
                    const last = pts[pts.length - 1];
                    ctx.lineTo(last.x, last.y);
                    ctx.stroke();
                }
                break;
            }

            case 'line': {
                ctx.beginPath();
                ctx.moveTo(op.x0, op.y0);
                ctx.lineTo(op.x1, op.y1);
                ctx.stroke();
                break;
            }

            case 'rectangle': {
                const x = Math.min(op.x0, op.x1);
                const y = Math.min(op.y0, op.y1);
                const w = Math.abs(op.x1 - op.x0);
                const h = Math.abs(op.y1 - op.y0);

                ctx.beginPath();
                ctx.rect(x, y, w, h);
                if (op.fill) ctx.fill();
                ctx.stroke();
                break;
            }

            case 'circle': {
                const cx = (op.x0 + op.x1) / 2;
                const cy = (op.y0 + op.y1) / 2;
                const rx = Math.abs(op.x1 - op.x0) / 2;
                const ry = Math.abs(op.y1 - op.y0) / 2;

                ctx.beginPath();
                ctx.ellipse(cx, cy, Math.max(0.1, rx), Math.max(0.1, ry), 0, 0, Math.PI * 2);
                if (op.fill) ctx.fill();
                ctx.stroke();
                break;
            }

            case 'fill-bucket': {
                if (!isPreview) {
                    this.executeFloodFill(ctx, op.seedX, op.seedY, op.color);
                }
                break;
            }
        }

        ctx.restore();
    }

    /**
     * Redraws all persistent operations on the main canvas.
     */
    redraw(operations = []) {
        this.ctx.clearRect(0, 0, this.drawingCanvas.width, this.drawingCanvas.height);
        this.applyTransform(this.ctx);

        operations.forEach(op => {
            if (!op.undone) {
                if (op.type === 'fill-bucket') {
                    this.ctx.restore(); // restore transform to do pixel-level flood fill
                    this.drawOperation(this.ctx, op);
                    this.applyTransform(this.ctx); // re-apply world transform
                } else {
                    this.drawOperation(this.ctx, op);
                }
            }
        });

        this.ctx.restore();
    }

    /**
     * Renders transient preview layer (local drawing + remote cursors).
     */
    renderOverlay() {
        const width = this.overlayCanvas.width;
        const height = this.overlayCanvas.height;
        this.overlayCtx.clearRect(0, 0, width, height);

        this.applyTransform(this.overlayCtx);

        // 1. Render active local stroke/shape preview (brush and shapes only)
        // Eraser is painted incrementally on the drawing canvas via _paintEraserSegment()
        if (this.isInteracting && this.activeStrokePoints.length > 0) {
            let previewOp = null;
            if (this.currentTool === 'brush') {
                previewOp = {
                    type: 'brush',
                    color: this.currentColor,
                    width: this.currentWidth,
                    points: this.activeStrokePoints
                };
            } else if (this.currentTool !== 'eraser' && this.activeShapeStart && this.activeStrokePoints.length > 1) {
                const last = this.activeStrokePoints[this.activeStrokePoints.length - 1];
                previewOp = {
                    type: this.currentTool,
                    color: this.currentColor,
                    width: this.currentWidth,
                    fill: this.isFillEnabled,
                    x0: this.activeShapeStart.x,
                    y0: this.activeShapeStart.y,
                    x1: last.x,
                    y1: last.y
                };
            }
            if (previewOp) {
                this.drawOperation(this.overlayCtx, previewOp, true);
            }
        }

        // 2. Render remote live strokes (also preview — don't erase remote overlay)
        this.remoteLiveStrokes.forEach((stroke) => {
            this.drawOperation(this.overlayCtx, stroke, true);
        });

        this.overlayCtx.restore();

        // 3. Render remote cursors in screen space
        this.overlayCtx.save();
        this.overlayCtx.scale(this.dpr, this.dpr);

        this.remoteCursors.forEach((c) => {
            const screen = this.worldToScreen(c.x, c.y);

            // Draw cursor pointer
            this.overlayCtx.fillStyle = c.color || '#3B82F6';
            this.overlayCtx.beginPath();
            this.overlayCtx.moveTo(screen.x, screen.y);
            this.overlayCtx.lineTo(screen.x, screen.y + 16);
            this.overlayCtx.lineTo(screen.x + 4, screen.y + 12);
            this.overlayCtx.lineTo(screen.x + 12, screen.y + 12);
            this.overlayCtx.closePath();
            this.overlayCtx.fill();

            // Draw username badge
            if (c.username) {
                this.overlayCtx.font = '500 11px Inter, sans-serif';
                const textWidth = this.overlayCtx.measureText(c.username).width;
                const badgeX = screen.x + 14;
                const badgeY = screen.y + 10;

                this.overlayCtx.fillStyle = c.color || '#3B82F6';
                this.overlayCtx.beginPath();
                this.overlayCtx.roundRect(badgeX, badgeY, textWidth + 10, 18, 9);
                this.overlayCtx.fill();

                this.overlayCtx.fillStyle = '#ffffff';
                this.overlayCtx.fillText(c.username, badgeX + 5, badgeY + 13);
            }
        });

        this.overlayCtx.restore();
    }

    /**
     * Exports entire active drawing as a PNG blob URL.
     */
    exportPNG() {
        return this.drawingCanvas.toDataURL('image/png');
    }
}
