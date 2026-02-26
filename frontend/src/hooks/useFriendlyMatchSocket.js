import { useCallback, useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { useAuth } from '../context/AuthContext';

export function useFriendlyMatchSocket() {
  const { token, user } = useAuth();
  const socketRef = useRef(null);
  const [pendingInvite, setPendingInvite] = useState(null);
  const [matchReady, setMatchReady] = useState(null);

  useEffect(() => {
    if (!token || !user?.id) return undefined;

    const socket = io('/', {
      autoConnect: false,
      auth: { token },
    });
    socketRef.current = socket;

    socket.on('friendly_invite_received', (payload) => {
      setPendingInvite(payload || null);
    });
    socket.on('friendly_match_ready', (payload) => {
      setMatchReady(payload || null);
    });
    socket.connect();

    return () => {
      socket.off('friendly_invite_received');
      socket.off('friendly_match_ready');
      socket.disconnect();
      if (socketRef.current === socket) socketRef.current = null;
    };
  }, [token, user?.id]);

  const ensureConnected = useCallback(() => new Promise((resolve) => {
    const socket = socketRef.current;
    if (!socket) {
      resolve(false);
      return;
    }
    if (socket.connected) {
      resolve(true);
      return;
    }

    const timeoutId = setTimeout(() => {
      socket.off('connect', handleConnect);
      resolve(false);
    }, 1500);

    const handleConnect = () => {
      clearTimeout(timeoutId);
      socket.off('connect', handleConnect);
      resolve(true);
    };

    socket.on('connect', handleConnect);
    socket.connect();
  }), []);

  const emitWithAck = useCallback((event, payload) => new Promise((resolve) => {
    ensureConnected().then((connected) => {
      const socket = socketRef.current;
      if (!socket || !connected || !socket.connected) {
        resolve({ ok: false, error: 'NOT_CONNECTED' });
        return;
      }
      socket.emit(event, payload, (response) => {
        resolve(response || { ok: false, error: 'NO_RESPONSE' });
      });
    });
  }), [ensureConnected]);

  const sendInvite = useCallback((targetUserId) => (
    emitWithAck('friendly_invite_send', { targetUserId })
  ), [emitWithAck]);

  const acceptInvite = useCallback(async (inviteId) => {
    const response = await emitWithAck('friendly_invite_accept', { inviteId });
    if (response?.ok) {
      setPendingInvite(null);
    }
    return response;
  }, [emitWithAck]);

  const declineInvite = useCallback(async (inviteId) => {
    const response = await emitWithAck('friendly_invite_decline', { inviteId });
    setPendingInvite(null);
    return response;
  }, [emitWithAck]);

  const clearPendingInvite = useCallback(() => {
    setPendingInvite(null);
  }, []);

  const clearMatchReady = useCallback(() => {
    setMatchReady(null);
  }, []);

  return {
    pendingInvite,
    matchReady,
    sendInvite,
    acceptInvite,
    declineInvite,
    clearPendingInvite,
    clearMatchReady,
  };
}

export default useFriendlyMatchSocket;
