const express = require('express');
const http = require('http');
const jwt = require('jsonwebtoken');
const { randomUUID } = require('crypto');
const { Server } = require('socket.io');

require('dotenv').config();

const PORT = Number(process.env.PORT || 4100);
const JWT_SECRET = process.env.JWT_SECRET || 'secret_key';
const CHAT_MAX_USERS = Number(process.env.CHAT_MAX_USERS || 1000);
const CHAT_RETENTION_MS = Number(process.env.CHAT_RETENTION_MS || 10 * 60 * 1000);
const CHAT_MAX_MESSAGE_LENGTH = Number(process.env.CHAT_MAX_MESSAGE_LENGTH || 300);

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  path: '/chat/socket.io',
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
});

// userId -> number of active sockets for this user
const connectedUsers = new Map();
const messages = [];

function sanitizeText(rawText) {
  if (typeof rawText !== 'string') return '';
  return rawText.trim().slice(0, CHAT_MAX_MESSAGE_LENGTH);
}

function sanitizeNickname(rawNickname, fallback) {
  const value = typeof rawNickname === 'string' ? rawNickname.trim() : '';
  if (!value) return fallback;
  return value.slice(0, 20);
}

function getOnlineCount() {
  return connectedUsers.size;
}

function pruneOldMessages(nowMs = Date.now()) {
  const threshold = nowMs - CHAT_RETENTION_MS;
  while (messages.length > 0) {
    const firstCreatedAtMs = new Date(messages[0].createdAt).getTime();
    if (Number.isNaN(firstCreatedAtMs) || firstCreatedAtMs >= threshold) {
      break;
    }
    messages.shift();
  }
}

function emitPresence() {
  io.emit('chat_presence', {
    onlineCount: getOnlineCount(),
    maxUsers: CHAT_MAX_USERS,
  });
}

function getHandshakeToken(socket) {
  const authToken = socket?.handshake?.auth?.token;
  if (typeof authToken === 'string' && authToken.trim()) return authToken.trim();

  const authHeader = socket?.handshake?.headers?.authorization;
  if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7).trim();
  }

  const queryToken = socket?.handshake?.query?.token;
  if (typeof queryToken === 'string' && queryToken.trim()) return queryToken.trim();

  return null;
}

setInterval(() => {
  pruneOldMessages();
}, 30 * 1000).unref();

app.get('/chat/health', (_req, res) => {
  pruneOldMessages();
  res.json({
    ok: true,
    onlineCount: getOnlineCount(),
    messageCount: messages.length,
    retentionMs: CHAT_RETENTION_MS,
    maxUsers: CHAT_MAX_USERS,
  });
});

io.on('connection', (socket) => {
  const token = getHandshakeToken(socket);
  if (!token) {
    socket.disconnect(true);
    return;
  }

  let decoded;
  try {
    decoded = jwt.verify(token, JWT_SECRET);
  } catch (_err) {
    socket.disconnect(true);
    return;
  }

  const userId = Number(decoded?.id);
  if (!Number.isInteger(userId) || userId <= 0) {
    socket.disconnect(true);
    return;
  }

  const isAlreadyConnected = connectedUsers.has(userId);
  if (!isAlreadyConnected && connectedUsers.size >= CHAT_MAX_USERS) {
    socket.emit('chat_room_full', { maxUsers: CHAT_MAX_USERS });
    socket.disconnect(true);
    return;
  }

  const fallbackName = typeof decoded?.username === 'string' && decoded.username.trim()
    ? decoded.username.trim()
    : `User${userId}`;
  const nickname = sanitizeNickname(socket?.handshake?.auth?.nickname, fallbackName);

  connectedUsers.set(userId, (connectedUsers.get(userId) || 0) + 1);
  socket.data.userId = userId;
  socket.data.nickname = nickname;

  pruneOldMessages();
  socket.emit('chat_init', {
    messages,
    onlineCount: getOnlineCount(),
    maxUsers: CHAT_MAX_USERS,
    retentionMs: CHAT_RETENTION_MS,
  });
  emitPresence();

  socket.on('chat_send', (payload = {}, callback) => {
    const respond = typeof callback === 'function' ? callback : () => {};
    const text = sanitizeText(payload.text);

    if (!text) {
      respond({ ok: false, error: 'EMPTY_MESSAGE' });
      return;
    }

    pruneOldMessages();
    const message = {
      id: randomUUID(),
      userId,
      nickname: socket.data.nickname || nickname,
      text,
      createdAt: new Date().toISOString(),
    };

    messages.push(message);
    io.emit('chat_message', message);
    respond({ ok: true });
  });

  socket.on('disconnect', () => {
    const current = connectedUsers.get(userId) || 0;
    if (current <= 1) {
      connectedUsers.delete(userId);
    } else {
      connectedUsers.set(userId, current - 1);
    }
    emitPresence();
  });
});

server.listen(PORT, () => {
  console.log(`Chat server listening on port ${PORT}`);
});
