# Frontend Documentation (React + Vite)

## 1. Scope
The frontend provides all user-facing UI and client-side game orchestration for:
- Authentication (login/register/logout)
- Main lobby and mode entry
- Online/Friendly/AI/Solo play UI
- Replay list + replay viewer
- Social tab (friends, requests, villains)
- Lobby real-time chat
- Profile and language settings

This service runs as a static SPA (Nginx) in Docker and talks to:
- Backend REST + Socket.IO (`/api`, `/socket.io`)
- Chat Socket.IO namespace path (`/chat/socket.io`)

## 2. Tech Stack
- React 19
- React Router
- Axios
- Socket.IO client
- Vite
- Plain CSS (custom design system, modal/toast-driven feedback)

## 3. Routing and Auth Guards
Main router is in `src/App.jsx`.

### 3.1 Routes
- `/` main menu (or auth entry if logged out)
- `/login`
- `/register`
- `/game?mode=online|friendly|ai|solo`
- `/replay` (alias `/records`)
- `/replay/:id`
- `/profile`
- `/social`
- `/social/friend/:friendId/records`

### 3.2 Access Control
- `ProtectedRoute` blocks game/profile/social without valid auth state.
- `AuthContext` restores token from localStorage and resolves user via `/api/user/me`.

### 3.3 Hard-Reload Recovery
`ReloadRouteGate` solves the blank-screen/route-loss issue on refresh:
- Persists last route in session storage.
- On hard reload:
  - If user was in `/game...`, restores that game route.
  - Otherwise redirects to `/`.

## 4. Session and Duplicate Login Handling
Implemented in `src/context/AuthContext.jsx` and app-level forced logout modal.

- Backend token includes a session id (`sid`).
- If duplicate login is detected (`DUPLICATE_LOGIN` or `session_terminated`), frontend:
  - opens forced-logout modal,
  - clears token/user on confirm,
  - redirects to `/login`.

This behavior is also wired during WebSocket sessions so active players are notified reliably.

## 5. Main Menu and Mode Entry
`src/pages/MainMenu.jsx`

### 5.1 Mode Entry UX
Main mode cards include:
- AI match
- Solo mode (self-play)
- Friendly match
- Ranked online match

Actions are modal/confirm driven (not browser alert/confirm).

### 5.2 Ranked Progress Panel
Main menu displays ranked-only progression data:
- current rank
- ranked win/loss counters
- ranked win rate
- promotion/demotion progress bar labels

### 5.3 Live Chat Card
Main menu includes a real-time lobby chat panel:
- one global room
- online count
- live messages
- room-full/disconnect toast handling

## 6. Board Component and Game Flows
Core gameplay lives in `src/components/Board.jsx`.

### 6.1 Supported Modes
- `online` (ranked)
- `friendly`
- `ai`
- `solo`
- `replay`

### 6.2 Setup Phase and Match Start
- Setup selection is modal-based and center aligned.
- Setup timeout: `20s` per setup owner.
- Timeout/cancel events are synchronized through server payloads (`setup_timer_sync`).
- Match-start summary modal auto-confirms after `5s` with progress animation.

### 6.3 Clocks and Byoyomi
Client consumes server clock snapshots (`clock_sync`) and projects remaining time in UI:
- Main time: 5 minutes each
- Byoyomi: 30 seconds × 3 periods
- UI renders both main time and remaining byoyomi periods.

### 6.4 Auto-End Rules Reflected in UI
Board UI handles and visualizes these ending paths:
- Double pass (both players use pass consecutively) -> score decision
- Score threshold (<=10) -> score decision
- 200-ply limit -> score decision
- Timeout -> time loss
- Resignation/checkmate/score endings

Result messaging is rendered from each player's perspective and by method:
- `resign`, `time`, `piece`, `checkmate` (mapped to localized labels)

### 6.5 Replay-Specific Behavior
- Replay mode does not show end-of-game modal.
- Replay step controls and move reconstruction support both legacy and v2 record payloads.

### 6.6 Board Display Options
Settings panel supports:
- starting side (`초`/`한` view)
- piece color inversion
- opponent-piece rotation
- board zoom (persisted in `localStorage` as `janggi_board_zoomed`)

## 7. Social Features (Client)
`src/pages/SocialPage.jsx`, `useFriendlyMatchSocket`

### 7.1 Friend System
- user search
- send friend request
- incoming/outgoing request list
- accept/reject request
- friend removal

### 7.2 Friendly Match
- can invite only confirmed friends
- invite receive/accept/decline modals
- match-ready modal and direct transition to friendly game room

### 7.3 Villain System
- register/remove villains
- villain relation blocks matching/invitation flows

### 7.4 Friend Replay View
- navigate to a friend-specific replay list page.

## 8. Records and Replay UI
`src/pages/ReplayList.jsx`, `src/pages/ReplayPage.jsx`

- Match history filter by mode:
  - Ranked
  - Friendly
  - AI
- Result badges are perspective-based (win/loss) and method-based.
- Replay detail page reconstructs board frames from move log.

## 9. i18n
`src/context/LanguageContext.jsx`

- Supported: `ko`, `en`
- Default (if no saved preference): `ko`
- Persisted key: `janggi_language`

## 10. Important Files
- `src/App.jsx` – routing, reload gate, forced logout modal
- `src/context/AuthContext.jsx` – token/session lifecycle
- `src/pages/MainMenu.jsx` – mode cards, rank panel, recent records, lobby chat
- `src/pages/SocialPage.jsx` – social graph UI
- `src/pages/ReplayList.jsx` – filtered records list
- `src/components/Board.jsx` – gameplay state machine and modals
- `src/hooks/useFriendlyMatchSocket.js`
- `src/hooks/useLobbyChatSocket.js`

## 11. Run and Build
```bash
cd frontend
npm install
npm run dev
npm run build
npm run preview
```

In Docker Compose, frontend is served by Nginx on port `80`.
