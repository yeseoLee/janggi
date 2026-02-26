import { BrowserRouter, Routes, Route, Navigate, useNavigate } from 'react-router-dom';
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
    const { token, authLoading } = useAuth();
    if (token && authLoading) {
        return <div className="page-loading">Loading...</div>;
    }
    if (!token) {
        return <Navigate to="/login" replace />;
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
                </Routes>
            </div>
        </BrowserRouter>
    </AuthProvider>
  );
}

export default App;
