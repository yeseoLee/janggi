import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import Login from './pages/Login';
import Register from './pages/Register';
import MainMenu from './pages/MainMenu';
import GamePage from './pages/GamePage';
import './App.css';

// Protected Route Component
const ProtectedRoute = ({ children }) => {
    const { user, token } = useAuth();
    // Allow if token exists (user might be loading), or redirect
    if (!token) {
        return <Navigate to="/login" replace />;
    }
    return children;
};

function App() {
  return (
    <AuthProvider>
        <BrowserRouter>
            <div className="App">
                <Routes>
                    <Route path="/login" element={<Login />} />
                    <Route path="/register" element={<Register />} />
                    <Route path="/" element={<MainMenu />} />
                    <Route path="/game" element={
                        <ProtectedRoute>
                            <GamePage />
                        </ProtectedRoute>
                    } />
                    {/* Placeholder for Replay */}
                    <Route path="/replay" element={<div>Replay Feature Coming Soon</div>} />
                </Routes>
            </div>
        </BrowserRouter>
    </AuthProvider>
  );
}

export default App;
