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
        this.bindEvents();
    }

    /**
     * Resizes canvases matching container dimensions and DPI.
     */
    resize() {
        const width = this.viewport.clientWidth;
        const height = this.viewport.clientHeight;
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

            const world = this.screenToWorld(e.clientX, e.clientY);
            this.isInteracting = true;
            this.activeShapeStart = world;
            this.activeStrokePoints = [world];

            if (this.currentTool === 'brush' || this.currentTool === 'eraser') {
                if (this.onLiveStroke) {
                    this.onLiveStroke({
                        tool: this.currentTool,
                        color: this.currentColor,
                        width: this.currentWidth,
                        points: this.activeStrokePoints
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

            if (this.currentTool === 'brush' || this.currentTool === 'eraser') {
                this.activeStrokePoints.push(world);

                // Throttle live stroke updates to remote peers
                if (this.onLiveStroke && this.activeStrokePoints.length % 3 === 0) {
                    this.onLiveStroke({
                        tool: this.currentTool,
                        color: this.currentColor,
                        width: this.currentWidth,
                        points: this.activeStrokePoints
                    });
                }
            } else {
                // For shapes, activeShapeStart is origin, world is current end
                this.activeStrokePoints = [this.activeShapeStart, world];
            }

            this.renderOverlay();
        });

        // Pointer up
        const endInteraction = (e) => {
            if (this.isPanning) {
                this.isPanning = false;
                this.viewport.classList.remove('panning');
                return;
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
    drawOperation(ctx, op) {
        if (!op) return;

        ctx.save();
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        if (op.type === 'eraser') {
            ctx.strokeStyle = '#fafbfc'; // matches canvas background
            ctx.lineWidth = (op.width || 4) * 2;
        } else {
            ctx.strokeStyle = op.color || '#000000';
            ctx.lineWidth = op.width || 3;
            ctx.fillStyle = op.color || '#000000';
        }

        switch (op.type) {
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
                    // Smooth Bézier curves using midpoints
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

                if (op.fill) {
                    ctx.globalAlpha = 0.25;
                    ctx.fillRect(x, y, w, h);
                    ctx.globalAlpha = 1.0;
                }
                ctx.strokeRect(x, y, w, h);
                break;
            }

            case 'circle': {
                const cx = (op.x0 + op.x1) / 2;
                const cy = (op.y0 + op.y1) / 2;
                const rx = Math.abs(op.x1 - op.x0) / 2;
                const ry = Math.abs(op.y1 - op.y0) / 2;

                ctx.beginPath();
                ctx.ellipse(cx, cy, Math.max(0.1, rx), Math.max(0.1, ry), 0, 0, Math.PI * 2);
                if (op.fill) {
                    ctx.globalAlpha = 0.25;
                    ctx.fill();
                    ctx.globalAlpha = 1.0;
                }
                ctx.stroke();
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
                this.drawOperation(this.ctx, op);
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

        // 1. Render active local stroke/shape preview
        if (this.isInteracting && this.activeStrokePoints.length > 0) {
            let previewOp = null;
            if (this.currentTool === 'brush' || this.currentTool === 'eraser') {
                previewOp = {
                    type: this.currentTool,
                    color: this.currentColor,
                    width: this.currentWidth,
                    points: this.activeStrokePoints
                };
            } else if (this.activeShapeStart && this.activeStrokePoints.length > 1) {
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
                this.drawOperation(this.overlayCtx, previewOp);
            }
        }

        // 2. Render remote live strokes
        this.remoteLiveStrokes.forEach((stroke) => {
            this.drawOperation(this.overlayCtx, stroke);
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
