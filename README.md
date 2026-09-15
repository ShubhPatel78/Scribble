# CanvasCollab

**Real-time collaborative whiteboard built with HTML5 Canvas, WebSockets, Node.js, and Supabase.**

[Live Demo](https://collaborative-canvas-y2gi.onrender.com/) · [Source Code](https://github.com/ShubhPatel78/collaborative-canvas)

CanvasCollab enables multiple users to draw and collaborate on a shared canvas in real time. Users can create or join rooms, draw simultaneously, view collaborator presence, and persist their boards.

## Features

* **Real-time collaboration** — Synchronizes drawing operations and cursor activity using WebSockets.
* **Room-based sessions** — Create or join collaborative rooms using unique room codes.
* **Drawing tools** — Freehand drawing, lines, rectangles, circles, and eraser.
* **Undo/Redo** — Operation-based history for editing canvas changes.
* **Infinite canvas** — Pan and zoom across the workspace.
* **Collaborator presence** — Displays connected users and cursor positions.
* **Persistent boards** — Stores canvas state using Supabase.
* **Export** — Export boards as PNG or JSON.
* **HiDPI rendering** — Supports high-resolution and Retina displays.

## Tech Stack

| Layer                   | Technology                      |
| ----------------------- | ------------------------------- |
| Frontend                | HTML5, CSS3, Vanilla JavaScript |
| Rendering               | HTML5 Canvas API                |
| Backend                 | Node.js, Express                |
| Real-time Communication | WebSocket                       |
| Database                | Supabase PostgreSQL             |
| Testing                 | Node.js Test Runner             |
| Deployment              | Render                          |

## Architecture

```text
┌─────────────────────┐
│      Browser        │
│                     │
│ HTML5 Canvas        │
│ Vanilla JavaScript  │
└──────────┬──────────┘
           │
           │ WebSocket
           ▼
┌─────────────────────┐
│     Node.js         │
│                     │
│ Express             │
│ WebSocket Server    │
│ Room Management     │
│ Canvas State        │
└──────────┬──────────┘
           │
           │ Persistence
           ▼
┌─────────────────────┐
│      Supabase       │
│     PostgreSQL      │
│                     │
│ Room Data           │
│ Canvas State        │
└─────────────────────┘
```

### Data Flow

1. A client creates or joins a room.
2. The client establishes a WebSocket connection with the server.
3. Drawing operations are sent to the server.
4. The server broadcasts operations to other clients in the same room.
5. Clients apply the operations to their local canvas.
6. Canvas state is persisted to Supabase.

## Real-Time Protocol

CanvasCollab uses WebSockets for bidirectional communication between clients and the server.

| Event         | Description                            |
| ------------- | -------------------------------------- |
| `join`        | Join a room                            |
| `stroke:live` | Stream an active stroke                |
| `op:commit`   | Commit a drawing operation             |
| `op:undo`     | Undo an operation                      |
| `op:redo`     | Redo an operation                      |
| `cursor`      | Synchronize cursor position            |
| `user:joined` | Notify clients of a new user           |
| `user:left`   | Notify clients when a user disconnects |

## Project Structure

```text
collaborative-canvas/
├── client/              # Frontend application
├── server/              # Node.js backend
├── supabase/             # Database schema/configuration
├── tests/                # Unit and integration tests
├── Screenshot/           # Application screenshots
├── ARCHITECTURE.md       # Architecture documentation
├── .env.example          # Environment variable template
├── render.yaml           # Render deployment configuration
├── package.json
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

The application will be available at:

```text
http://localhost:3000
```

### Run Tests

```bash
npm test
```

## Deployment

CanvasCollab is deployed on Render.

**Production:** [collaborative-canvas-y2gi.onrender.com](https://collaborative-canvas-y2gi.onrender.com/)

The deployment uses the project's `render.yaml` configuration and environment variables for Supabase integration.

## Future Improvements

* User authentication
* Private/password-protected rooms
* Text and sticky-note tools
* Image support
* Board version history
* Improved mobile and touch support
* Advanced conflict resolution

## License

This project is licensed under the MIT License.

## Author

**Shubh Patel**

[GitHub](https://github.com/ShubhPatel78)
