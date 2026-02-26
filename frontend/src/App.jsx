import { useEffect, useRef, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import Login from './pages/Login';
import Register from './pages/Register';
import MainMenu from './pages/MainMenu';
import GamePage from './pages/GamePage';
import ReplayList from './pages/ReplayList';
import ReplayPage from './pages/ReplayPage';
import Profile from './pages/Profile';
import SocialPage from './pages/SocialPage';
import FriendReplayList from './pages/FriendReplayList';
import { useLanguage } from './context/LanguageContext';
import './App.css';

const ProtectedRoute = ({ children }) => {
    const { token, user, authLoading } = useAuth();
    if (authLoading) {
        return <div className="page-loading">Loading...</div>;
    }
    if (!token || !user) {
        return <Navigate to="/login" replace />;
    }
    return children;
};

const isHardReload = () => {
    try {
        const entries = performance.getEntriesByType?.('navigation');
        if (Array.isArray(entries) && entries.length > 0) {
            return entries[0]?.type === 'reload';
        }
        if (typeof performance?.navigation?.type === 'number') {
            return performance.navigation.type === 1;
        }
    } catch (_err) {
        return false;
    }
    return false;
};

const RELOAD_MARKER_KEY = 'janggi_reload_marker';
const LAST_ROUTE_KEY = 'janggi_last_route';

const ReloadRouteGate = ({ children }) => {
    const { token, authLoading } = useAuth();
    const location = useLocation();
    const handledRef = useRef(false);
    const reloadRef = useRef(null);
    const [isReady, setIsReady] = useState(false);
    const [redirectTarget, setRedirectTarget] = useState('');

    if (reloadRef.current === null) {
        const markedReload = sessionStorage.getItem(RELOAD_MARKER_KEY) === '1';
        reloadRef.current = isHardReload() || markedReload;
        sessionStorage.removeItem(RELOAD_MARKER_KEY);
    }

    useEffect(() => {
        const currentRoute = `${location.pathname}${location.search}`;
        sessionStorage.setItem(LAST_ROUTE_KEY, currentRoute);
    }, [location.pathname, location.search]);

    useEffect(() => {
        const handleBeforeUnload = () => {
            sessionStorage.setItem(RELOAD_MARKER_KEY, '1');
            sessionStorage.setItem(LAST_ROUTE_KEY, `${location.pathname}${location.search}`);
        };

        window.addEventListener('beforeunload', handleBeforeUnload);
        return () => window.removeEventListener('beforeunload', handleBeforeUnload);
    }, [location.pathname, location.search]);

    useEffect(() => {
        if (handledRef.current) return;
        if (authLoading) return;

        const reloaded = reloadRef.current;
        const currentRoute = `${location.pathname}${location.search}`;
        const lastRoute = sessionStorage.getItem(LAST_ROUTE_KEY) || currentRoute;

        handledRef.current = true;
        if (!reloaded || !token) {
            setIsReady(true);
            return;
        }

        const isGamePath = lastRoute.startsWith('/game') || location.pathname.startsWith('/game');
        if (isGamePath) {
            if (lastRoute.startsWith('/game') && currentRoute !== lastRoute) {
                setRedirectTarget(lastRoute);
            }
            setIsReady(true);
            return;
        }

        if (currentRoute !== '/') {
            setRedirectTarget('/');
        }
        setIsReady(true);
    }, [authLoading, location.pathname, location.search, token]);

    if (!isReady) {
        return <div className="page-loading">Loading...</div>;
    }

    if (redirectTarget) {
        return <Navigate to={redirectTarget} replace />;
    }

    return children;
};

const ForcedLogoutModal = () => {
    const { forcedLogoutReason, acknowledgeForcedLogout } = useAuth();
    const { t } = useLanguage();
    const navigate = useNavigate();

    if (!forcedLogoutReason) return null;

    const handleConfirm = () => {
        acknowledgeForcedLogout();
        navigate('/login', { replace: true });
    };

    return (
        <div className="menu-confirm-overlay" style={{ zIndex: 1200 }}>
            <div className="menu-confirm-card" onClick={(e) => e.stopPropagation()}>
                <div className="menu-confirm-title">{t('auth.duplicateLoginForcedLogout')}</div>
                <div className="menu-confirm-actions">
                    <button className="menu-confirm-btn primary" style={{ gridColumn: '1 / -1' }} onClick={handleConfirm}>
                        {t('common.ok')}
                    </button>
                </div>
            </div>
        </div>
    );
};

function App() {
  return (
    <AuthProvider>
        <BrowserRouter>
            <div className="App">
                <ForcedLogoutModal />
                <ReloadRouteGate>
                    <Routes>
                        <Route path="/login" element={<Login />} />
                        <Route path="/register" element={<Register />} />
                        <Route path="/" element={<MainMenu />} />
                        <Route path="/game" element={
                            <ProtectedRoute>
                                <GamePage />
                            </ProtectedRoute>
                        } />
                        <Route path="/records" element={<ReplayList />} />
                        <Route path="/replay" element={<ReplayList />} />
                        <Route path="/replay/:id" element={<ReplayPage />} />
                        <Route path="/profile" element={
                            <ProtectedRoute>
                                <Profile />
                            </ProtectedRoute>
                        } />
                        <Route path="/social" element={
                            <ProtectedRoute>
                                <SocialPage />
                            </ProtectedRoute>
                        } />
                        <Route path="/social/friend/:friendId/records" element={
                            <ProtectedRoute>
                                <FriendReplayList />
                            </ProtectedRoute>
                        } />
                        <Route path="*" element={<Navigate to="/" replace />} />
                    </Routes>
                </ReloadRouteGate>
            </div>
        </BrowserRouter>
    </AuthProvider>
  );
}

export default App;
