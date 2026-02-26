import { createContext, useState, useContext, useEffect, useCallback, useRef } from 'react';
import axios from 'axios';
import { io } from 'socket.io-client';

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(localStorage.getItem('token'));
  const [forcedLogoutReason, setForcedLogoutReason] = useState(null);
  const authSocketRef = useRef(null);

  const markDuplicateLogin = useCallback(() => {
    setForcedLogoutReason('duplicate_login');
  }, []);

  const logout = useCallback(() => {
    if (authSocketRef.current) {
      authSocketRef.current.disconnect();
      authSocketRef.current = null;
    }
    localStorage.removeItem('token');
    setToken(null);
    setUser(null);
    setForcedLogoutReason(null);
  }, []);

  const refreshUser = useCallback(async () => {
    if (!token) return null;
    try {
      const res = await axios.get('/api/user/me');
      setUser(res.data);
      return res.data;
    } catch (err) {
      if (err.response?.status === 401 && err.response?.data?.code === 'DUPLICATE_LOGIN') {
        markDuplicateLogin();
        return null;
      }
      logout();
      return null;
    }
  }, [token, logout, markDuplicateLogin]);

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
    if (token) {
      axios.defaults.headers.common['Authorization'] = `Bearer ${token}`;
      axios.get('/api/user/me')
        .then(res => setUser(res.data))
        .catch((err) => {
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
  }, [token, logout, markDuplicateLogin]);

  useEffect(() => {
    if (!token) return undefined;

    const sessionSocket = io('/', { autoConnect: false, auth: { token } });
    authSocketRef.current = sessionSocket;

    const handleSessionTerminated = (payload = {}) => {
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
    localStorage.setItem('token', newToken);
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
