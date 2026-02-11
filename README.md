# Janggi (Korean Chess) Online

![Janggi Board](https://upload.wikimedia.org/wikipedia/commons/thumb/c/c5/Xiangqi_board.svg/1200px-Xiangqi_board.svg.png)
*(Note: Visual representation only, actual game UI differs)*

A modern, web-based implementation of **Janggi (Korean Chess)** featuring real-time multiplayer matchmaking, AI opponents, and game record replay (Gibo). Built with modern web technologies and fully containerized.

## 🌟 Key Features

### 🎮 Game Modes
- **Online Match**: Real-time 1vs1 matchmaking system based on rank and win rate.
  - **Sequential Setup**: Authentic game start flow where 'Han' (Red) sets up first, followed by 'Cho' (Blue), with real-time UI synchronization.
  - **Live Gameplay**: Instant move updates via WebSockets.
  - **Game States**: Handling of Check (Janggun), Checkmate, Resignation, and Draws.
- **AI Match**: Solo practice mode (Currently supports basic heuristic/random moves).
- **Replay (Gibo)**: 
  - Automatically saves all ranked games to the database.
  - View list of past games with winners and timestamps.
  - Step-by-step replay functionality (Prev/Next) to analyze matches.

### 🛡️ User System
- **Authentication**: Secure Signup/Login using JWT and bcrypt.
- **Stats Tracking**: Tracks Wins, Losses, Rank, and Win Rate.
- **Rank System**: Matchmaking prioritizes users of similar skill levels.

### 💻 UI/UX
- **Responsive Design**: Playable on desktop and mobile screens.
- **Interactive Board**: Highlights valid moves, last move markers, and check alerts.
- **Setup Selection**: Choose your 'Sang' (Elephant) and 'Ma' (Horse) positions (e.g., Masang-Masang, Yang-Gwi-Ma).

---

## 🛠 Tech Stack

### Frontend
- **React 18** (Vite)
- **Socket.IO Client** for real-time events.
- **React Router** for navigation.
- **CSS3** for responsive board layout and animations.

### Backend
- **Node.js** + **Express**
- **Socket.IO** for WebSocket communication.
- **PostgreSQL** for persistent data (Users, Games).
- **Nginx** as a reverse proxy and static file server.

### Infrastructure
- **Docker** & **Docker Compose**: Orchestrates Frontend (Nginx), Backend, and Database containers.

---

## 🚀 Getting Started

### Prerequisites
- [Docker](https://www.docker.com/products/docker-desktop) installed on your machine.
- [Git](https://git-scm.com/)

### Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/yeseoLee/janggi.git
   cd janggi
   ```

2. **Run with Docker Compose**
   ```bash
   docker-compose up --build
   ```
   *This will build the frontend/backend images and start the PostgreSQL database.*

3. **Access the Game**
   - Open your browser and navigate to: `http://localhost`

### Default Ports
- **Frontend (Nginx)**: 80 (mapped to localhost:80)
- **Backend API**: 3000 (internal)
- **PostgreSQL**: 5432 (mapped to localhost:5432)

---

## 📋 How to Play

1. **Register/Login**: Create an account to track your stats.
2. **Choose Mode**:
   - Select **Online Match** to find a human opponent.
   - Select **AI Match** to practice alone.
3. **Setup Phase**:
   - If you are **Han (Red)**, choose your setup first.
   - If you are **Cho (Blue)**, wait for Han, then choose your setup.
4. **Gameplay**:
   - Cho (Blue) moves first.
   - Click a piece to see valid moves (green dots).
   - Click a valid spot to move.
   - The game ends on Checkmate or Resignation.

---

## 📂 Project Structure

```
janggi/
├── backend/            # Express Server & Socket.IO logic
│   ├── server.js       # Main entry point
│   ├── jwt.js          # Auth middleware
│   └── init.sql        # Database schema
├── frontend/           # React Application
│   ├── src/
│   │   ├── components/ # Board, Piece, Overlays
│   │   ├── game/       # Game Rules & Constants
│   │   └── pages/      # Login, MainMenu, GamePage, Replay
├── docker-compose.yml  # Container orchestration
└── nginx.conf          # Nginx configuration
```

## 📜 License
This project is open-source.
