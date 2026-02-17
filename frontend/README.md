# Frontend (React + Vite)

This frontend provides the full web UI for Janggi:
- Initial auth landing (`로그인` / `회원가입` only)
- Login / register
- Main menu with rank/coins/actions
- Online match / AI match board
- Replay list / replay viewer

## Stack

- React 19
- React Router
- Axios
- Socket.IO client
- Plain CSS (responsive, centered layout)

## Run (Local)

```bash
npm install
npm run dev
```

Build:
```bash
npm run build
```

Preview build:
```bash
npm run preview
```

## Routes

- `/` main menu (or initial auth landing if logged out)
- `/login`
- `/register`
- `/game?mode=online`
- `/game?mode=ai`
- `/replay`
- `/replay/:id`

## Key UI/Flow Notes

### Language
- `LanguageContext` + `translations.js`
- Supports `ko` and `en`
- Selection persisted in `localStorage` (`janggi_language`)

### AI Match Start Flow
1. Set AI strength (`Search Depth`)
2. Select side (`Cho` / `Han`)
3. Select my setup
4. Select AI setup
5. Start game

### AI In-game Behavior
- Engine move requested via `/api/ai/move`
- Returned move is checked against local legal move generation
- If invalid/error, frontend falls back to local legal move picker
- Undo in AI mode:
  - On player turn: undo 2 plies
  - On AI turn: undo 1 ply

### Replay
- Uses normalized frames from `src/game/replay.js`
- Supports current move-log format and legacy data fallback

## Important Files

- `src/components/Board.jsx`: gameplay UI + state machine
- `src/components/Board.css`: board/sidebar/setup styling
- `src/pages/MainMenu.jsx`: coins, rank progress, mode entry
- `src/pages/ReplayList.jsx`, `src/pages/ReplayPage.jsx`
- `src/context/LanguageContext.jsx`
- `src/i18n/translations.js`

## Backend Integration (Used by Frontend)

- `POST /api/auth/login`
- `POST /api/auth/register`
- `GET /api/user/me`
- `DELETE /api/auth/me`
- `POST /api/coins/spend-ai-match`
- `POST /api/coins/recharge`
- `POST /api/ai/move`
- `GET /api/games`
- `GET /api/games/:id`

