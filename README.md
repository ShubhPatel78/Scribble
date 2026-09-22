# 🎨 Scribble • Real-Time Multiplayer Drawing & Guessing Game

[![Node.js](https://img.shields.io/badge/Node.js-18%2B-green.svg)](https://nodejs.org/)
[![WebSocket](https://img.shields.io/badge/WebSockets-ws-blue.svg)](https://github.com/websockets/ws)
[![Tests](https://img.shields.io/badge/Tests-23%20Passing-brightgreen.svg)](#-testing)
[![License](https://img.shields.io/badge/License-MIT-purple.svg)](./LICENSE)

**Scribble** is a modern, responsive, real-time multiplayer drawing and word-guessing game (inspired by *Skribbl.io*) built with **HTML5 Canvas**, **WebSockets**, **Node.js**, and optional **Supabase PostgreSQL** persistence.

[**🌐 Play Live Demo**](https://collaborative-canvas-y2gi.onrender.com/) · [**📁 GitHub Repository**](https://github.com/ShubhPatel78/collaborative-canvas) · [**📐 System Architecture**](./ARCHITECTURE.md)

---

## ✨ Features Overview

### 🎮 Multiplayer Game Engine
- **Turn-Based Game Loop**:
  - **Lobby Phase**: Players join with custom avatars and nicknames; room host can configure timer and round count.
  - **Word Choice Phase**: Drawer receives 3 random word options with a 15-second decision countdown.
  - **Drawing Phase**: Configurable draw time (15s–240s) with automated progressive letter hints (revealed at 75% and 40% time remaining).
  - **Round Summary & 10s Leaderboard**: Intermission modal showing the revealed word, highlighting the **Fastest Guesser (Max Points)** with a ⚡ badge, and displaying points gained this turn (`+480 pts`, `+150 pts Drawing`) alongside cumulative standings.
  - **Game Over & Podium**: 1st, 2nd, and 3rd place podium celebrating match winners with a Host **"🔄 Play Again"** button.
- **Speed-Based Scoring**: Guessers receive points dynamically based on remaining time (up to 500 pts). The active drawer earns bonus points for every successful guess.
- **Strict Turn Access Control**: During active drawing turns, only the designated drawer can draw or commit strokes to the canvas.

### 💬 Live Chat, Guessing & Social Interaction
- **Dual Chat & Guessing System**: Guessers can guess words or chat normally. Correct guesses are automatically scored and hidden from the chat to prevent spoilers.
- **Spoiler & Leak Prevention**: Active drawers and players who have already guessed can chat freely; if they accidentally type the secret word, the message is blocked and they receive a private alert.
- **Visual Role Badges**: Messages display `🎨 Drawer`, `✅ Guessed`, and `(You)` tags.
- **Quick Reaction Emoji Bar**: One-tap reaction bar (`👍`, `❤️`, `😂`, `🔥`, `👏`, `🎨`, `🤔`, `🎉`, `😮`, `💯`) for quick expressions while drawing or guessing.
- **In-Canvas Floating Chat Bubble**: Transient animated overlay on the canvas displaying incoming chat messages for 3.5 seconds so players never miss conversation while focused on the canvas.

### 📱 Mobile & Touch Optimized
- **Touch Gesture Zoom & Pan**: Two-finger pinch-to-zoom and two-finger drag-to-pan.
- **Dedicated Navigation Hand Tool (✋)** and floating zoom controls (`➖`, `100%`, `➕`, `🎯 Reset View`).
- **Responsive Layout**: Designed for phones, tablets, and desktops with an adaptive toolbar and fixed-viewport geometry.

### 🚪 Mid-Game Exit & Session Score Recovery
- **Voluntary Exit ("Leave Room")**: Mid-game exit button with confirmation modal. If the host leaves, host permissions are transferred automatically; if the drawer leaves, the turn advances cleanly.
- **60-Second Accidental Disconnect Grace Window**: Client stores persistent `canvas_session_id` in `localStorage`. If a player gets disconnected (Wi-Fi fluctuation, page refresh, mobile backgrounding), reconnecting within 60 seconds completely restores their accumulated score, host status, avatar color, and turn state.

### 🎨 Advanced Drawing Tools
- **Freehand Brush**: Smooth Bézier curve rendering with configurable size.
- **Geometric Shapes**: Lines, Rectangles, and Circles/Ellipses with optional fill mode.
- **Flood Fill (Paint Bucket)**: High-performance canvas bucket fill algorithm with color tolerance.
- **Custom Eraser**: Visual radius ring indicator.
- **Collaborative Undo / Redo**: Non-destructive per-user undo stack (tombstone pattern).
- **Themes**: Light, Dark Slate, Blueprint, and Vintage Sepia themes.
- **Export Options**: Export canvas as high-resolution PNG image or structured JSON state.

### 🌐 Room Management & Infrastructure
- **6-Character Room Codes**: Easy-to-share codes (e.g., `K9X2P4`) and direct invite links.
- **Multi-Room Isolation**: Automatic cleanup of inactive rooms and independent drawing states.
- **Dual Persistence Mode**: In-memory store with optional Supabase PostgreSQL sync.

---

## 🚀 Quick Start

### Prerequisites
- [Node.js](https://nodejs.org/) (version 18.0.0 or higher)
- npm (version 8 or higher)

### Installation

1. **Clone the repository**:
   ```bash
   git clone https://github.com/ShubhPatel78/collaborative-canvas.git
   cd collaborative-canvas
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Start the local server**:
   ```bash
   npm start
   ```

4. **Open in browser**:
   Navigate to [http://localhost:3000](http://localhost:3000) to create or join a room.

---

## 🧪 Testing

The repository includes an automated test suite covering drawing state operations, word hint generation, game mechanics, session reconnection, and multi-client WebSocket synchronization.

To run the test suite:
```bash
npm test
```

Test coverage includes:
- `DrawingState`: Operation management, per-user undo/redo, flood fill, operation limit budgeting.
- `words`: Normalization and Levenshtein-distance close-guess matching.
- `GameEngine`: Player management, word options, speed scoring, 10s round leaderboard, winner podium, custom timers, and spoiler protection.
- `Integration`: Multi-room isolation, real-time live strokes, session score restoration upon reconnect, and voluntary exit handling.

---

## 🏗️ Project Architecture

```text
collaborative-canvas/
├── client/
│   ├── index.html          # Single-page UI with game arena, scoreboard, modals & portal
│   ├── style.css           # Modern CSS with responsive design & multi-theme variables
│   ├── canvas.js           # CanvasEngine (Bézier curves, camera pan/zoom, shapes, flood fill)
│   ├── websocket.js        # WebSocketClient with auto-reconnect & session persistence
│   ├── game-client.js      # Game UI controller (modals, scoreboard, chat & timer badges)
│   └── main.js             # Application bootstrap and keyboard shortcut controller
├── server/
│   ├── server.js           # Express app & WebSocket server connection router
│   ├── rooms.js            # RoomManager (multi-room lifecycle & Supabase synchronization)
│   ├── game-engine.js      # Scribble state machine, scoring rules & turn management
│   ├── words.js            # Curated word banks & Levenshtein close-guess utility
│   ├── state.js            # Event-sourced DrawingState with per-user undo tombstones
│   └── supabase.js         # Supabase client connector & persistence schema
├── tests/
│   ├── state.test.js       # Drawing state & undo/redo unit tests
│   ├── game-engine.test.js # Game engine state machine & scoring unit tests
│   ├── rooms.test.js       # Multi-room isolation & code generation unit tests
│   └── integration.test.js # End-to-end WebSocket integration tests
├── ARCHITECTURE.md         # In-depth system design & mathematical formulations
├── package.json            # Project manifest and scripts
└── README.md               # Project documentation
```

For full details on the mathematical coordinate systems, synchronization protocol, and tombstone undo algorithms, see [**`ARCHITECTURE.md`**](./ARCHITECTURE.md).

---

## ⚙️ Environment Variables (Optional)

Scribble runs out-of-the-box in high-performance in-memory mode. To enable persistent room storage with Supabase PostgreSQL, create a `.env` file in the root directory:

```env
PORT=3000
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_KEY=your-supabase-service-role-key
```

---

## ⌨️ Keyboard Shortcuts

| Shortcut | Action | Condition |
| :--- | :--- | :--- |
| `P` / `B` | Select Brush Tool | When drawer |
| `E` | Select Eraser Tool | When drawer |
| `F` / `G` | Select Flood Fill Bucket | When drawer |
| `R` | Select Rectangle Shape | When drawer |
| `O` / `C` | Select Circle Shape | When drawer |
| `L` | Select Line Shape | When drawer |
| `H` / `Space (Hold)` | Pan Hand Tool | Always available |
| `Ctrl / Cmd + Z` | Undo Last Stroke | When drawer |
| `Ctrl / Cmd + Y` | Redo Stroke | When drawer |
| `+` / `=` | Zoom In | Always available |
| `-` | Zoom Out | Always available |
| `0` | Reset Canvas View (100% Center) | Always available |

---

## 📄 License

This project is licensed under the MIT License — see the [LICENSE](./LICENSE) file for details.

## 👤 Author

**Shubh Patel** — [@ShubhPatel78](https://github.com/ShubhPatel78)
