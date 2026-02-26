import { useCallback, useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';

const MAX_CLIENT_MESSAGES = 300;

function normalizeMessages(messages) {
  if (!Array.isArray(messages)) return [];
  return messages
    .filter((message) => message && typeof message === 'object')
    .map((message) => ({
      id: message.id || `${message.userId || 'u'}-${message.createdAt || Date.now()}`,
      userId: Number(message.userId) || 0,
      nickname: String(message.nickname || 'Unknown'),
      text: String(message.text || ''),
      createdAt: message.createdAt || new Date().toISOString(),
    }))
    .filter((message) => message.text.trim())
    .slice(-MAX_CLIENT_MESSAGES);
}

export function useLobbyChatSocket({ token, userId, nickname }) {
  const socketRef = useRef(null);
  const [messages, setMessages] = useState([]);
  const [onlineCount, setOnlineCount] = useState(0);
  const [isConnected, setIsConnected] = useState(false);
  const [isRoomFull, setIsRoomFull] = useState(false);

  useEffect(() => {
    if (!token || !userId) {
      setMessages([]);
      setOnlineCount(0);
      setIsConnected(false);
      setIsRoomFull(false);
      return undefined;
    }

    const socket = io('/', {
      autoConnect: false,
      path: '/chat/socket.io',
      auth: {
        token,
        nickname,
      },
    });
    socketRef.current = socket;

    socket.on('connect', () => {
      setIsConnected(true);
      setIsRoomFull(false);
    });

    socket.on('disconnect', () => {
      setIsConnected(false);
    });

    socket.on('chat_init', (payload = {}) => {
      setMessages(normalizeMessages(payload.messages));
      setOnlineCount(Number(payload.onlineCount) || 0);
    });

    socket.on('chat_presence', (payload = {}) => {
      setOnlineCount(Number(payload.onlineCount) || 0);
    });

    socket.on('chat_message', (payload = {}) => {
      const normalized = normalizeMessages([payload]);
      if (normalized.length === 0) return;
      const nextMessage = normalized[0];
      setMessages((prev) => {
        const next = [...prev, nextMessage];
        return next.slice(-MAX_CLIENT_MESSAGES);
      });
    });

    socket.on('chat_room_full', () => {
      setIsRoomFull(true);
      setIsConnected(false);
    });

    socket.connect();

    return () => {
      socket.off('connect');
      socket.off('disconnect');
      socket.off('chat_init');
      socket.off('chat_presence');
      socket.off('chat_message');
      socket.off('chat_room_full');
      socket.disconnect();
      if (socketRef.current === socket) socketRef.current = null;
    };
  }, [nickname, token, userId]);

  const sendMessage = useCallback((text) => new Promise((resolve) => {
    const socket = socketRef.current;
    const safeText = typeof text === 'string' ? text.trim() : '';

    if (!socket || !socket.connected) {
      resolve({ ok: false, error: 'NOT_CONNECTED' });
      return;
    }

    if (!safeText) {
      resolve({ ok: false, error: 'EMPTY_MESSAGE' });
      return;
    }

    socket.emit('chat_send', { text: safeText }, (response = {}) => {
      resolve(response);
    });
  }), []);

  return {
    messages,
    onlineCount,
    isConnected,
    isRoomFull,
    sendMessage,
  };
}

export default useLobbyChatSocket;
