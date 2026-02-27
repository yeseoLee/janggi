# Chat Server Documentation (Lobby Realtime Chat)

## 1. Scope
`chat-server` provides one global real-time lobby chat room used from the main menu.

Key guarantees:
- single room model
- max concurrent user limit
- short-lived server-side message retention (10 min default)
- live online user count broadcast

Entry point: `chat-server/server.js`

## 2. Runtime Stack
- Express + HTTP server
- Socket.IO (path: `/chat/socket.io`)
- JWT verification for socket auth

## 3. Connection Model

### 3.1 Authentication
Each socket must provide a valid JWT token via handshake auth/header/query.
Invalid or missing token -> immediate disconnect.

### 3.2 Capacity Control
- Unique user count is tracked via `connectedUsers` map.
- If room is full (`CHAT_MAX_USERS`) and user is not already connected:
  - emits `chat_room_full`
  - disconnects the socket

### 3.3 Presence
On connect/disconnect, server emits `chat_presence` with:
- `onlineCount`
- `maxUsers`

## 4. Message Storage Rules
Messages are held in memory only.

- retention window: `CHAT_RETENTION_MS` (default 10 minutes)
- pruning job runs every 30 seconds
- old messages are removed automatically

This keeps memory bounded and satisfies “recent chat only” behavior.

## 5. Socket Events

### 5.1 Server -> Client
- `chat_init`
  - initial message snapshot
  - current online count
  - room metadata
- `chat_presence`
  - online user count updates
- `chat_message`
  - broadcast new message
- `chat_room_full`
  - capacity reached

### 5.2 Client -> Server
- `chat_send`
  - payload: `{ text }`
  - ack: `{ ok: true }` or error (`EMPTY_MESSAGE` etc.)

## 6. Input Sanitization
- message text is trimmed and length-limited (`CHAT_MAX_MESSAGE_LENGTH`)
- nickname is sanitized/truncated (max 20 chars)

## 7. Health Endpoint
`GET /chat/health` returns:
- `ok`
- `onlineCount`
- `messageCount`
- `retentionMs`
- `maxUsers`

## 8. Environment Variables
- `PORT` (default `4100`)
- `JWT_SECRET` (must match backend token secret)
- `CHAT_MAX_USERS` (default `1000`)
- `CHAT_RETENTION_MS` (default `600000`)
- `CHAT_MAX_MESSAGE_LENGTH` (default `300`)

## 9. Integration
Frontend connects with:
- Socket path `/chat/socket.io`
- auth `{ token, nickname }`

In Docker, frontend Nginx proxies `/chat/socket.io` to `chat-server:4100`.

## 10. Run
```bash
cd chat-server
npm install
npm start
```

Default port: `4100`.
