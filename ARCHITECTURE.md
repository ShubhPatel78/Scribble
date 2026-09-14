# System Architecture & Technical Deep Dive

This document details the architectural design decisions, mathematical models, data structures, and synchronization protocols implemented in **CanvasCollab**.

---

## 1. High-Level Architectural Model

CanvasCollab employs an **Event-Sourced, Server-Mediated Client-Server Architecture** over full-duplex WebSockets.

```
┌────────────────────────────────────────────────────────┐
│                        BROWSER                         │
│  ┌─────────────────┐             ┌──────────────────┐  │
│  │   UI Overlay    │             │   CanvasEngine   │  │
│  │ (Tools/Nav/DOM) │             │ (Infinite Camera)│  │
│  └────────┬────────┘             └────────▲─────────┘  │
│           │                               │            │
│           ▼                               │            │
│  ┌────────────────────────────────────────┴─────────┐  │
│  │                 WebSocketClient                  │  │
│  └────────────────────────▲─────────────────────────┘  │
└───────────────────────────┼────────────────────────────┘
                            │ Full-Duplex WebSockets
                            │ (JSON Payloads + Heartbeat)
┌───────────────────────────┼────────────────────────────┐
│                           ▼                            │
│  ┌──────────────────────────────────────────────────┐  │
│  │                   server.js                      │  │
│  │           (Connection Lifecycle & Ping)          │  │
│  └────────────────────────┬─────────────────────────┘  │
│                           │                            │
│                           ▼                            │
│  ┌──────────────────────────────────────────────────┐  │
│  │                  RoomManager                     │  │
│  │        (Multi-Room Isolation & Cleanup)          │  │
│  └────────────────────────┬─────────────────────────┘  │
│                           │                            │
│                           ▼                            │
│  ┌──────────────────────────────────────────────────┐  │
│  │                 DrawingState                     │  │
│  │       (Event Sourcing & Per-User Undo)           │  │
│  └──────────────────────────────────────────────────┘  │
│                     NODE.JS BACKEND                    │
└────────────────────────────────────────────────────────┘
```

---

## 2. Event Sourcing & Stroke Lifecycle

### 2.1 The Problem with Micro-Segments
In naive canvas implementations, every mouse movement triggers a `(x0, y0) -> (x1, y1)` broadcast. A single circle drawn quickly produces 300+ events:
1. Saturates WebSocket framing buffers.
2. Quickly overflows the server's history array, evicting previous drawings within seconds.
3. Renders undo meaningless, because `undo` only removes a 2-pixel segment.

### 2.2 Discrete Operation Lifecycle
CanvasCollab introduces a two-phase stroke protocol:

1. **In-Flight Phase (`stroke:live`)**:
   - While the pointer is moving (`pointermove`), sampled points are accumulated locally in `activeStrokePoints`.
   - The client renders immediate feedback on the `overlayCanvas` at 60 FPS.
   - Throttled intermediate updates are broadcasted to peers for live visualization.
2. **Commit Phase (`op:commit`)**:
   - On `pointerup`, the points or shape dimensions are bundled into an immutable operation:
     ```json
     {
       "id": "op_1726359200_a8f9",
       "userId": "user_1_3df9a",
       "type": "brush",
       "color": "#3B82F6",
       "width": 4,
       "points": [{"x": 120.5, "y": 85.0}, ...],
       "timestamp": 1726359200123,
       "undone": false
     }
     ```
   - The server validates the payload, adds it to `DrawingState`, and broadcasts the committed operation to all room subscribers.

---

## 3. Non-Destructive Per-User Undo/Redo

### 3.1 Tombstone Pattern
Standard stack-based undo/redo (`pop()` and `push()`) fails in multi-user environments because popping removes the most recent global action, irrespective of who created it.

CanvasCollab utilizes **tombstones (soft-deletes)** coupled with isolated per-user undo stacks:

```
Operations Timeline:
[Op 1: Alice] ──> [Op 2: Bob] ──> [Op 3: Alice] ──> [Op 4: Bob]

Alice clicks Undo:
Op 3 is marked { undone: true }
Op 4 (Bob) and Op 2 (Bob) remain untouched and active.

Alice clicks Redo:
Op 3 is restored { undone: false }
```

### 3.2 State Transition Matrix
- **`undo(userId)`**:
  - Scans `operations` in reverse order for the latest operation matching `op.userId === userId && !op.undone`.
  - Sets `op.undone = true`.
  - Pushes `op.id` to `undoneOperationsByUser.get(userId)`.
- **`redo(userId)`**:
  - Pops `opId` from `undoneOperationsByUser.get(userId)`.
  - Sets corresponding operation `op.undone = false`.
- **New Stroke Invalidation**:
  - If a user commits a new stroke after undoing, their undone stack is cleared to maintain deterministic timeline branching.

---

## 4. Coordinate Normalization & Camera Math

### 4.1 DPI & Viewport Decoupling
To ensure that a circle drawn on a 13-inch MacBook Retina display renders identically on a 27-inch 4K desktop or 1080p display:
- Canvases scale backing stores by `window.devicePixelRatio`.
- World coordinates are independent of CSS pixel bounds.

### 4.2 Camera Affine Transformation
The canvas maintains a 2D camera state:
- `panX, panY`: World translation offset in pixels.
- `zoom`: Scale factor (clamped between `0.2` and `4.0`).

#### Screen to World Projection:
$$\begin{aligned}
x_{\text{world}} &= \frac{x_{\text{screen}} - \text{panX}}{\text{zoom}} \\
y_{\text{world}} &= \frac{y_{\text{screen}} - \text{panY}}{\text{zoom}}
\end{aligned}$$

#### World to Screen Projection:
$$\begin{aligned}
x_{\text{screen}} &= x_{\text{world}} \cdot \text{zoom} + \text{panX} \\
y_{\text{screen}} &= y_{\text{world}} \cdot \text{zoom} + \text{panY}
\end{aligned}$$

#### Zoom Towards Focal Point $(c_x, c_y)$:
When zooming with the mouse wheel centered at cursor $(c_x, c_y)$:
$$\begin{aligned}
\text{panX}' &= c_x - (c_x - \text{panX}) \cdot \frac{\text{zoom}'}{\text{zoom}} \\
\text{panY}' &= c_y - (c_y - \text{panY}) \cdot \frac{\text{zoom}'}{\text{zoom}}
\end{aligned}$$

---

## 5. Bézier Curve Smoothing Algorithm

Raw mouse sampling generates jagged polyline strokes. CanvasCollab applies midpoint quadratic Bézier curve interpolation:

Given sequential points $P_0, P_1, P_2, \dots, P_n$:
For each adjacent pair $(P_i, P_{i+1})$, compute midpoint:
$$M_i = \left(\frac{P_{i}.x + P_{i+1}.x}{2}, \frac{P_{i}.y + P_{i+1}.y}{2}\right)$$
The rendering engine executes:
```javascript
ctx.moveTo(P0.x, P0.y);
for (let i = 1; i < points.length - 1; i++) {
    const midX = (points[i].x + points[i + 1].x) / 2;
    const midY = (points[i].y + points[i + 1].y) / 2;
    ctx.quadraticCurveTo(points[i].x, points[i].y, midX, midY);
}
ctx.lineTo(lastPoint.x, lastPoint.y);
ctx.stroke();
```
This produces organic, calligraphy-grade curves at minimal mathematical cost.

---

## 6. Multi-Tenant Memory Budgeting & Cleanup

- Each active room maintains its own `DrawingState` instance with an operations cap (default: 5,000 operations).
- Inactivity Pruning: When all users disconnect from a room, a 5-minute cleanup timer is initiated. If no user reconnects within the window, the room is safely garbage-collected from the `RoomManager` map to prevent memory leaks on long-running servers.
- Heartbeat: A 30-second ping/pong sweep detects half-open or stalled TCP sockets, preventing ghost presence.
