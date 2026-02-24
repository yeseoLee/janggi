import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import Login from './pages/Login';
import Register from './pages/Register';
import MainMenu from './pages/MainMenu';
import GamePage from './pages/GamePage';
import ReplayList from './pages/ReplayList';
import ReplayPage from './pages/ReplayPage';
import Profile from './pages/Profile';
import './App.css';

const ProtectedRoute = ({ children }) => {
    const { user, token } = useAuth();
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
                    <Route path="/records" element={<ReplayList />} />
                    <Route path="/replay" element={<ReplayList />} />
                    <Route path="/replay/:id" element={<ReplayPage />} />
                    <Route path="/profile" element={
                        <ProtectedRoute>
                            <Profile />
                        </ProtectedRoute>
                    } />
                </Routes>
            </div>
        </BrowserRouter>
    </AuthProvider>
  );
}

export default App;
