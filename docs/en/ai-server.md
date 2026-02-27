# AI Server Documentation (Fairy-Stockfish Wrapper)

## 1. Scope
`ai-server` is a dedicated process wrapper around Fairy-Stockfish for Janggi move search.

Responsibilities:
- maintain a long-lived engine process
- serialize engine commands safely (single queue)
- expose simple HTTP APIs for backend use
- keep engine variant and move-time behavior configurable by env

Entry point: `ai-server/server.js`

## 2. Runtime Design

### 2.1 Engine Lifecycle
The service starts one Fairy-Stockfish child process and initializes it with:
1. `uci`
2. `setoption name UCI_Variant value janggi`
3. `isready`

If process exits, pending waiters are rejected and health reflects non-initialized state.

### 2.2 Serialized Command Queue
Engine access uses an internal promise queue (`enqueue`) so concurrent requests do not interleave `position/go` commands.

## 3. HTTP API

### 3.1 `GET /health`
Returns basic health and engine metadata:
- `ok`
- `initialized`
- `variant`
- `pid`

### 3.2 `POST /move`
Request body:
- `fen` (required)
- `movetime` (optional)
- `depth` (optional)

Response:
- `bestmove`
- `ponder` (nullable)

Validation:
- missing/empty `fen` -> `400`
- engine failure -> `500`

## 4. Time/Depth Behavior
- `movetime` is clamped in server-side guard (100ms to 5000ms)
- backend may request depth-based search instead of movetime
- timeout budget for waiting `bestmove` depends on command type

## 5. Environment Variables
- `PORT` (default `4000`)
- `STOCKFISH_PATH` (default `/usr/local/bin/fairy-stockfish`)
- `AI_VARIANT` (default `janggi`)
- `AI_MOVE_TIME_MS` (default `700`)

## 6. Docker Build Notes
`ai-server/Dockerfile`:
- builds Fairy-Stockfish from source in a builder stage
- selects architecture profile by Docker `TARGETARCH`
- copies built binary into slim Node runtime image

This ensures reproducible engine availability in Compose without host dependency.

## 7. Integration Contract
Called by backend endpoint `POST /api/ai/move`.

Backend converts board state to Janggi FEN and passes it here. AI server is intentionally stateless regarding users/games and only computes move suggestions.

## 8. Run
```bash
cd ai-server
npm install
npm start
```

Default port: `4000`.
