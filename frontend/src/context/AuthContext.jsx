import { createContext, useState, useContext, useEffect, useCallback, useRef } from 'react';
import axios from 'axios';
import { io } from 'socket.io-client';

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(localStorage.getItem('token'));
  const [forcedLogoutReason, setForcedLogoutReason] = useState(null);
  const authSocketRef = useRef(null);
  const tokenRef = useRef(token);

  useEffect(() => {
    tokenRef.current = token;
  }, [token]);

  const markDuplicateLogin = useCallback(() => {
    setForcedLogoutReason('duplicate_login');
  }, []);

  const logout = useCallback(() => {
    if (authSocketRef.current) {
      authSocketRef.current.disconnect();
      authSocketRef.current = null;
    }
    localStorage.removeItem('token');
    delete axios.defaults.headers.common['Authorization'];
    setToken(null);
    setUser(null);
    setForcedLogoutReason(null);
  }, []);

  const refreshUser = useCallback(async () => {
    const activeToken = tokenRef.current;
    if (!activeToken) return null;
    try {
      const res = await axios.get('/api/user/me');
      if (tokenRef.current !== activeToken) return null;
      setUser(res.data);
      return res.data;
    } catch (err) {
      if (tokenRef.current !== activeToken) return null;
      if (err.response?.status === 401 && err.response?.data?.code === 'DUPLICATE_LOGIN') {
        markDuplicateLogin();
        return null;
      }
      logout();
      return null;
    }
  }, [logout, markDuplicateLogin]);

  const acknowledgeForcedLogout = useCallback(() => {
    logout();
  }, [logout]);

  useEffect(() => {
    const interceptorId = axios.interceptors.response.use(
      (response) => response,
      (error) => {
        if (error.response?.status === 401 && error.response?.data?.code === 'DUPLICATE_LOGIN') {
          markDuplicateLogin();
        }
        return Promise.reject(error);
      },
    );
    return () => axios.interceptors.response.eject(interceptorId);
  }, [markDuplicateLogin]);

  // Configure axios default header
  useEffect(() => {
    let isActive = true;
    const controller = new AbortController();

    if (token) {
      axios.defaults.headers.common['Authorization'] = `Bearer ${token}`;
      axios.get('/api/user/me', { signal: controller.signal })
        .then((res) => {
          if (!isActive || tokenRef.current !== token) return;
          setUser(res.data);
        })
        .catch((err) => {
          if (!isActive || tokenRef.current !== token) return;
          if (err?.code === 'ERR_CANCELED') return;
          if (err.response?.status === 401 && err.response?.data?.code === 'DUPLICATE_LOGIN') {
            markDuplicateLogin();
            return;
          }
          logout();
        });
    } else {
      delete axios.defaults.headers.common['Authorization'];
      setUser(null);
    }

    return () => {
      isActive = false;
      controller.abort();
    };
  }, [token, logout, markDuplicateLogin]);

  useEffect(() => {
    if (!token) return undefined;

    const sessionToken = token;
    const sessionSocket = io('/', { autoConnect: false, auth: { token: sessionToken } });
    authSocketRef.current = sessionSocket;

    const handleSessionTerminated = (payload = {}) => {
      if (tokenRef.current !== sessionToken) return;
      if (payload.reason === 'duplicate_login') {
        markDuplicateLogin();
      }
    };

    sessionSocket.on('session_terminated', handleSessionTerminated);
    sessionSocket.connect();

    return () => {
      sessionSocket.off('session_terminated', handleSessionTerminated);
      sessionSocket.disconnect();
      if (authSocketRef.current === sessionSocket) {
        authSocketRef.current = null;
      }
    };
  }, [token, markDuplicateLogin]);

  const login = (newToken, userInfo) => {
    if (authSocketRef.current) {
      authSocketRef.current.disconnect();
      authSocketRef.current = null;
    }
    localStorage.setItem('token', newToken);
    axios.defaults.headers.common['Authorization'] = `Bearer ${newToken}`;
    setToken(newToken);
    setUser(userInfo);
    setForcedLogoutReason(null);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        login,
        logout,
        refreshUser,
        forcedLogoutReason,
        acknowledgeForcedLogout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
