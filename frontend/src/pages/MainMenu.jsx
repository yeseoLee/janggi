import { useAuth } from '../context/AuthContext';
import { useNavigate, Link } from 'react-router-dom';
import axios from 'axios';

function MainMenu() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const handleWithdraw = async () => {
      if (confirm('Are you sure you want to withdraw? This cannot be undone.')) {
          try {
              await axios.delete('/api/auth/me');
              logout();
              alert('Account deleted.');
          } catch (err) {
              alert('Withdrawal failed');
          }
      }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 30, padding: 50 }}>
      <h1>Janggi Online</h1>
      
      {user ? (
          <div style={{ background: '#333', padding: 20, borderRadius: 8, width: 300, textAlign: 'left' }}>
              <h3>Welcome, {user.nickname}</h3>
              <p>Rank: {user.rank}</p>
              <p>Record: {user.wins}W - {user.losses}L</p>
              <p>Coins: {user.coins}</p>
              <div style={{ display: 'flex', gap: 10, marginTop: 10 }}>
                  <button onClick={logout} style={{ fontSize: '0.8em', background: '#555' }}>Logout</button>
                  <button onClick={handleWithdraw} style={{ fontSize: '0.8em', background: '#a00' }}>Withdraw</button>
              </div>
          </div>
      ) : (
          <div>
              <Link to="/login"><button>Login</button></Link>
              <Link to="/register"><button style={{ marginLeft: 10 }}>Register</button></Link>
          </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 15, width: 250 }}>
          <button onClick={() => navigate('/game?mode=ai')}>AI Match (Solo Play)</button>
          <button onClick={() => navigate('/game?mode=online')}>Online Match</button>
          <button onClick={() => navigate('/replay')} disabled>Replay (Coming Soon)</button>
      </div>
    </div>
  );
}

export default MainMenu;
