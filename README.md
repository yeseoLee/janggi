# Janggi (Korean Chess) Online

Web-based Janggi service with online matchmaking, Fairy-Stockfish AI matches, replay (기보), rank progression, and bilingual UI (Korean/English).

## Detailed Documentation / 상세 문서

Detailed EN/KO technical documents are organized per layer/service.

| Area | English | 한국어 |
|---|---|---|
| Frontend | [Frontend Docs](docs/en/frontend.md) | [프론트엔드 문서](docs/ko/frontend.md) |
| Backend | [Backend Docs](docs/en/backend.md) | [백엔드 문서](docs/ko/backend.md) |
| AI Server | [AI Server Docs](docs/en/ai-server.md) | [AI 서버 문서](docs/ko/ai-server.md) |
| Chat Server | [Chat Server Docs](docs/en/chat-server.md) | [채팅 서버 문서](docs/ko/chat-server.md) |

Documentation includes:
- full route/event contracts
- session and duplicate-login handling
- ranked/friendly/AI/solo/replay flow details
- clock/byoyomi and setup timer behavior
- social/chat architecture and operations

## Current Features

### Game Modes
- Online Match (Socket.IO)
  - Real-time 1v1 matchmaking
  - Sequential setup flow (Han setup -> Cho setup)
  - Move/pass/resign/checkmate/disconnect handling
  - Game record persisted to DB at game end
- AI Match (Fairy-Stockfish)
  - AI entry cost: 1 coin
  - Start flow: AI strength(depth) -> side select(Cho/Han) -> setup select (my setup + AI setup)
  - Calls backend AI API (`/api/ai/move`) and validates legal moves on frontend
  - Undo behavior in AI mode:
    - On player turn: undo 2 plies (player move + AI reply)
    - On AI turn: undo 1 ply
- Replay (기보)
  - Game list API and detail API
  - Step-by-step replay (Prev/Next)
  - Supports both current `move_log` format and legacy payload fallback

### User / Economy / Rank
- JWT auth (register/login/me/withdraw)
- Coin system
  - Initial coins: 10
  - AI match costs 1 coin
  - Manual recharge button grants +10 coins (`/api/coins/recharge`)
  - Note: ad-link and daily-limit logic are planned (TODO in code)
- Rank system
  - Range: `18급 ~ 1급`, `1단 ~ 9단`
  - No coin reward on victory
  - Per-rank progress counters (`rank_wins`, `rank_losses`)
  - Promotion / demotion thresholds:
    - `18급 ~ 10급`: 3 wins / 3 losses
    - `9급 ~ 1급`: 5 wins / 5 losses
    - `단`: 7 wins / 7 losses

### UI / UX
- Mobile-first centered layout for initial/login/register/menu/game/replay screens
- Language selector (`한국어` / `English`)
- Board UI improvements:
  - Centered responsive board
  - Captured pieces panel for both Cho/Han
  - Setup previews rendered with piece images
  - Valid move marker uses green dot

## Architecture

- `frontend`: React + Vite + Axios + Socket.IO client
- `backend`: Go + Gin + Socket.IO-compatible realtime server + PostgreSQL
- `ai-server`: Go + Gin wrapper around a persistent Fairy-Stockfish process
- `postgres`: persistent DB

### Docker Compose Services
- `frontend` (port `80`)
- `backend` (port `3000`)
- `ai-server` (port `4000`)
- `postgres` (port `5432`)

`ai-server` builds Fairy-Stockfish from source and selects build arch for Docker target platform (`amd64`/`arm64`).

Node implementations are preserved under `benchmarks/node-baseline/` for equivalence and benchmark comparison only. They are not the active runtime services anymore.

## Quick Start

1. Clone repository
```bash
git clone https://github.com/yeseoLee/janggi.git
cd janggi
```

2. Run all services
```bash
docker compose up --build
```

3. Open
- `http://localhost`

## Environment Notes

### Backend (`docker-compose.yml`)
- `AI_SERVICE_URL` default: `http://ai-server:4000`
- `AI_MOVE_TIME_MS` default: `700`
- `AI_SEARCH_DEPTH` default fallback: `8` (used when client depth is missing)

### AI Server
- `AI_VARIANT` default: `janggi`
- `AI_MOVE_TIME_MS` default: `700`

## API Overview

### Auth / User
- `POST /api/auth/register`
- `POST /api/auth/login`
- `GET /api/user/me`
- `DELETE /api/auth/me`

### Coins
- `POST /api/coins/spend-ai-match`
- `POST /api/coins/recharge`

### AI
- `POST /api/ai/move`
  - body: `board`, `turn`, optional `movetime`, optional `depth`

### Replay
- `GET /api/games`
- `GET /api/games/:id`

## Testing

Go unit tests:
```bash
cd backend && go test ./...
cd ../ai-server && go test ./...
```

Node baseline tests are still available for reference:
```bash
npm --prefix benchmarks/node-baseline/backend test
```

### Equivalence Verification

Backend and AI wrapper equivalence can be reproduced with:
```bash
docker compose -f docker-compose.equivalence.yml up --build -d
node scripts/equivalence.cjs
docker compose -f docker-compose.equivalence.yml down
```

What this verifies:
- Node baseline backend vs Go backend with the same REST and Socket.IO scenario set
- Node baseline ai-server vs Go ai-server against a deterministic fake engine
- Real Fairy-Stockfish smoke checks for both ai-server implementations

### Benchmark Report

Generate the comparison report and raw metrics:
```bash
docker compose -p janggi-bench -f docker-compose.benchmark.yml up --build -d
node scripts/benchmark.cjs
docker compose -p janggi-bench -f docker-compose.benchmark.yml down
```

Outputs:
- `benchmarks/results/benchmark-results.json`
- `benchmarks/results/migration-report.md`

## Project Structure

```text
janggi/
├── ai-server/              # Go AI wrapper service
├── backend/
│   ├── *.go                # REST + Socket.IO + DB integration
│   └── init.sql
├── benchmarks/
│   ├── node-baseline/      # frozen Node reference servers
│   └── results/            # generated benchmark artifacts
├── frontend/
│   └── src/
│       ├── components/
│       ├── context/
│       ├── game/
│       ├── i18n/
│       └── pages/
├── docker-compose.yml
├── docker-compose.equivalence.yml
└── docker-compose.benchmark.yml
```
