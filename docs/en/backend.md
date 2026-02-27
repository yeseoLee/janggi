# Backend Documentation (Express + Socket.IO + PostgreSQL)

## 1. Scope
Backend is the core authoritative service for:
- JWT auth/session lifecycle
- user profile and account deletion
- ranked game matchmaking and real-time game state sync
- friendly match invitation and room lifecycle
- social graph (friends / friend requests / villains)
- replay storage and retrieval APIs
- rank + ELO progression updates
- AI relay API (`/api/ai/move`)

It also serves built frontend assets in production mode.

## 2. Runtime Stack
- Node.js + Express
- Socket.IO
- PostgreSQL (`pg` pool)
- JWT + bcrypt

Entry point: `backend/server.js`

## 3. Authentication and Session Model

### 3.1 JWT Payload
On login, token payload includes:
- `id` (user id)
- `username`
- `sid` (session id, random UUID)

### 3.2 Duplicate Login Protection
In-memory map `activeSessions` tracks valid session id and connected sockets per user.

If a new login occurs:
- previous sockets are force-terminated,
- in-progress game is auto-resigned (or pre-game match canceled),
- previous clients receive `session_terminated` event.

REST middleware `authenticateToken` also blocks invalid session id tokens with:
- `401 { code: 'DUPLICATE_LOGIN' }`.

## 4. Database Model
Auto-initialized/migrated at startup (`initDB`).

### 4.1 Tables
- `users`
  - identity/auth: `username`, `password`, `nickname`
  - progression: `rank`, `wins`, `losses`, `rank_wins`, `rank_losses`, `rating`
  - economy: `coins`
- `games`
  - participants: `winner_id`, `loser_id`, `winner_team`, `loser_team`
  - mode/result: `game_mode`, `result_type`, `move_count`
  - replay: `moves` (legacy), `move_log` (JSONB), `cho_setup`, `han_setup`
  - timeline: `started_at`, `ended_at`, `played_at`
- `friendships` (bidirectional rows)
- `friend_requests` (`pending|accepted|rejected|cancelled` lifecycle)
- `villains` (block list relation)

### 4.2 Key Indexes
- `idx_games_played_at`, `idx_games_move_count`
- social indexes for friend/villain lookup and pending request query

## 5. REST API

## 5.1 Auth / User
- `POST /api/auth/register`
- `POST /api/auth/login`
- `GET /api/user/me`
- `DELETE /api/auth/me` (withdraw)

## 5.2 Social
- `GET /api/social/users/search?q=`
- `GET /api/social/friend-requests`
- `GET /api/social/friends`
- `POST /api/social/friends` (send friend request)
- `POST /api/social/friend-requests/:requestId/accept`
- `POST /api/social/friend-requests/:requestId/reject`
- `DELETE /api/social/friends/:friendId`
- `GET /api/social/villains`
- `POST /api/social/villains`
- `DELETE /api/social/villains/:targetUserId`
- `GET /api/social/friends/:friendId/games`

## 5.3 Economy / AI / Records
- `POST /api/coins/spend-ai-match`
- `POST /api/coins/recharge`
- `POST /api/ai/move` (backend -> ai-server relay)
- `POST /api/games/ai` (store AI replay)
- `GET /api/games`
- `GET /api/games/:id`

## 6. Socket.IO Protocol
Transport endpoint: `/socket.io`.

### 6.1 Client -> Server Events
- `find_match`
- `friendly_invite_send`
- `friendly_invite_accept`
- `friendly_invite_decline`
- `join_friendly_match`
- `setup_phase_started`
- `submit_setup`
- `cancel_match`
- `move`
- `pass`
- `resign`
- `checkmate`
- `finish_by_rule` (score decision)

### 6.2 Server -> Client Events
- `match_found`
- `setup_timer_sync`
- `opponent_setup`
- `clock_sync`
- `move`
- `pass_turn`
- `game_over`
- `match_cancelled`
- `friendly_invite_received`
- `friendly_invite_declined`
- `friendly_match_ready`
- `session_terminated`

## 7. Matchmaking and Social Constraints

### 7.1 Ranked Queue
- Queue pairs users while avoiding villain-blocked pairs.
- Cho/Han assignment prioritizes lower rank/win-rate side rules; tie breaks randomly.

### 7.2 Friendly Match Flow
- Invite allowed only between confirmed friends.
- Invite is rejected if users are blocked by villain relation.
- Accepted invite creates temporary pending match; both players then join via `matchId`.

## 8. Time Control and Setup Timers

### 8.1 Setup Selection Timer
- 20 seconds per selecting side.
- Timeout before game start cancels match.

### 8.2 Game Clock
Authoritative server clock state per side:
- Main time: 5 minutes
- Byoyomi: 30 seconds x 3 periods

Clock is updated on every action and periodic projections are emitted via `clock_sync`.
Timeout triggers `game_over` with type `time`.

## 9. Game End Processing
`processGameEnd(roomId, winnerTeam, resultType)` does:
- idempotent finish mark
- timeout cleanup
- DB transaction:
  - lock both users
  - update total wins/losses
  - update rank counters and rank promotion/demotion state
  - update ELO ratings (`K=32`, minimum rating floor)
  - persist game replay and metadata

Supported result types include:
- `resign`
- `time`
- `piece`
- `checkmate`
- `score`
- `unknown`

## 10. Replay Semantics
- `/api/games` returns perspective-aware fields:
  - `my_result`, `my_team`, `opponent_name`
- mode-aware game typing:
  - ranked / friendly / ai
- `/api/games/:id` includes friend-access policy and legacy payload fallback conversion.

## 11. AI Relay Logic
`POST /api/ai/move`:
- validates board/turn
- converts board -> Janggi FEN
- clamps depth/movetime
- calls AI server `/move`
- parses `bestmove` into board coordinates
- returns `pass: true` if no parseable move

## 12. Key Source Files
- `server.js` – full API/socket orchestration and game lifecycle
- `src/rank.js` – rank threshold logic
- `src/coinService.js` – coin spend/recharge service
- `src/aiMove.js` – board/FEN and engine move parsing
- `src/streak.js` – max win streak helper

## 13. Run / Test
```bash
cd backend
npm install
npm start
npm test
npm run test:coverage
```

Default service port: `3000`.
