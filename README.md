# CanvasCollab

**Real-time collaborative whiteboard built with HTML5 Canvas, WebSockets, Node.js, and Supabase.**

[**Live Demo**](https://collaborative-canvas-y2gi.onrender.com/) · [**Source Code**](https://github.com/ShubhPatel78/collaborative-canvas) · [**Architecture**](./ARCHITECTURE.md)

CanvasCollab is a browser-based collaborative whiteboard that allows multiple users to draw and interact on the same canvas in real time. It uses a server-mediated WebSocket architecture with operation-based state, room isolation, live presence, and persistent canvas snapshots.

## Features

### Drawing

* Freehand brush with smooth Bézier-curve rendering
* Lines
* Rectangles
* Circles / ellipses
* Eraser
* Filled and outlined shapes
* Adjustable stroke properties
* PNG export
* JSON canvas export

### Collaboration

* Real-time multi-user drawing
* Live collaborator cursors
* Usernames and user-specific colors
* Room-based collaboration
* Shareable room codes and URLs
* Automatic room creation for new visitors
* Room-level state isolation

### Canvas

* Infinite workspace
* Pan and zoom
* Cursor-focused zooming
* World-coordinate rendering
* HiDPI / Retina support
* Consistent rendering across different viewport sizes

### State & Reliability

* Operation-based drawing state
* Per-user undo/redo
* Non-destructive collaborative undo
* Two-phase live-stroke and commit protocol
* WebSocket heartbeat
* Automatic inactive-room cleanup
* Operation limits per room
* Persistent canvas snapshots

## Live Demo

**https://collaborative-canvas-y2gi.onrender.com/**

Opening the application automatically creates a new room when no room is specified. Users can then share the generated room code or URL to invite collaborators.

## Architecture

```text
┌──────────────────────────────────────────────────────┐
│                     Browser                          │
│                                                      │
│  UI / Drawing Tools    Canvas Engine    Camera       │
│          │                   │             │         │
│          └───────────────────┴─────────────┘         │
│                           │                          │
│                     WebSocket Client                │
└───────────────────────────┼──────────────────────────┘
                            │
                     Full-Duplex WebSocket
                            │
                            ▼
┌──────────────────────────────────────────────────────┐
│                    Node.js Server                    │
│                                                      │
│  Express                                              │
│  WebSocket Server                                     │
│  Connection Lifecycle                                 │
│  Room Manager                                         │
│  Drawing State                                        │
│  Presence Management                                  │
└───────────────────────────┬──────────────────────────┘
                            │
                    Persistent Snapshots
                            │
                            ▼
┌──────────────────────────────────────────────────────┐
│                 Supabase PostgreSQL                  │
│                                                      │
│  Room Data                                            │
│  Canvas Snapshots                                     │
└──────────────────────────────────────────────────────┘
```

For the detailed system design, see [`ARCHITECTURE.md`](./ARCHITECTURE.md).

## Real-Time Synchronization

CanvasCollab separates an active drawing stroke from its committed state.

### Live Stroke

While a user is drawing:

```text
Pointer Movement
       │
       ▼
Local Stroke State
       │
       ├──────────────► Local Overlay
       │
       ▼
  stroke:live
       │
       ▼
Other Clients
```

Intermediate points are throttled and broadcast to other clients for live visualization.

### Commit

When the pointer is released:

```text
Pointer Up
    │
    ▼
op:commit
    │
    ▼
Server Validation
    │
    ▼
DrawingState
    │
    ├──────────────► Room Broadcast
    │
    └──────────────► Persistence
```

This treats an entire drawing action as one logical operation instead of storing every pointer movement as a separate operation.

## Collaborative Undo / Redo

A global stack-based undo system does not work correctly in a multi-user environment because the latest operation may belong to another user.

CanvasCollab uses **per-user undo state with tombstones**.

```text
Alice ──► Op 1
Bob   ──► Op 2
Alice ──► Op 3
Bob   ──► Op 4

Alice → Undo

Alice ──► Op 1
Bob   ──► Op 2
Alice ──► Op 3  [undone]
Bob   ──► Op 4
```

Undo marks the user's operation as inactive rather than removing it from the shared operation history. Redo restores the operation. A new operation after an undo clears that user's redo state.

## Infinite Canvas

CanvasCollab separates screen coordinates from world coordinates using a camera transformation.

```text
Screen Coordinates
        │
        ▼
┌─────────────────┐
│ Camera          │
│                 │
│ Pan + Zoom      │
└────────┬────────┘
         │
         ▼
World Coordinates
```

The camera supports:

* Pan
* Zoom
* Cursor-focused zoom
* Zoom limits
* Device-pixel-ratio normalization
* Consistent remote drawing coordinates

The current implementation maintains `panX`, `panY`, and `zoom`, with zoom constrained between `0.2` and `4.0`.

## Smooth Freehand Rendering

Raw pointer samples can produce visibly jagged strokes.

CanvasCollab uses **midpoint quadratic Bézier interpolation** to smooth freehand paths:

```text
P0 ─── P1 ─── P2 ─── P3
       │
       ▼
  Midpoint Bézier
       │
       ▼
 Smooth Stroke
```

This improves the visual quality of freehand drawing without requiring a heavyweight rendering library.

## Room Management

Each active room maintains its own drawing state and connected users.

```text
Room A
├── Users
├── Presence
└── DrawingState

Room B
├── Users
├── Presence
└── DrawingState
```

The server includes:

* Room-level message isolation
* Operation limits
* Inactive-room cleanup
* WebSocket heartbeat checks
* Connection lifecycle management

Active rooms are garbage-collected after users disconnect and the configured inactivity period expires. A heartbeat mechanism detects stale WebSocket connections.

## WebSocket Protocol

| Event         | Purpose                                        |
| ------------- | ---------------------------------------------- |
| `join`        | Join a collaboration room                      |
| `stroke:live` | Stream an active drawing stroke                |
| `op:commit`   | Commit a drawing operation                     |
| `op:undo`     | Undo the user's latest active operation        |
| `op:redo`     | Redo a previously undone operation             |
| `cursor`      | Synchronize cursor position                    |
| `user:joined` | Notify clients of a new collaborator           |
| `user:left`   | Notify clients when a collaborator disconnects |

## Tech Stack

| Layer                   | Technology                      |
| ----------------------- | ------------------------------- |
| Frontend                | HTML5, CSS3, Vanilla JavaScript |
| Rendering               | HTML5 Canvas 2D API             |
| Backend                 | Node.js, Express                |
| Real-time Communication | WebSockets (`ws`)               |
| Database                | Supabase PostgreSQL             |
| Testing                 | Node.js `node:test`             |
| Deployment              | Render                          |

## Project Structure

```text
collaborative-canvas/
│
├── client/                 # Frontend application
├── server/                 # Node.js backend
├── supabase/               # Database schema and persistence
├── tests/                  # Unit and integration tests
├── Screenshot/             # Application screenshots
│
├── ARCHITECTURE.md         # Technical architecture
├── .env.example            # Environment configuration template
├── render.yaml             # Render deployment configuration
├── package.json
├── package-lock.json
└── README.md
```

## Getting Started

### Prerequisites

* Node.js 18+
* npm
* Supabase project for persistent storage

### Installation

```bash
git clone https://github.com/ShubhPatel78/collaborative-canvas.git
cd collaborative-canvas
npm install
```

### Environment Variables

Create a `.env` file using `.env.example`:

```env
PORT=3000
SUPABASE_URL=your_supabase_project_url
SUPABASE_ANON_KEY=your_supabase_anon_key
```

### Run Locally

```bash
npm start
```

Open:

```text
http://localhost:3000
```

### Run Tests

```bash
npm test
```

## Deployment

CanvasCollab is deployed on **Render**.

**Production:**
https://collaborative-canvas-y2gi.onrender.com/

The repository includes `render.yaml` for deployment configuration and Supabase environment variables for persistent storage.

## Future Improvements

* User authentication
* Private/password-protected rooms
* Text and sticky-note tools
* Image support
* Board version history
* Mobile and touch optimization
* Advanced conflict resolution

## License

MIT License

## Author

**Shubh Patel**

[GitHub](https://github.com/ShubhPatel78)
