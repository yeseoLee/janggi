import { useAuth } from '../context/AuthContext';
import { useNavigate, Link } from 'react-router-dom';
import axios from 'axios';
import { useLanguage } from '../context/LanguageContext';

function MainMenu() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const { t } = useLanguage();

  const handleWithdraw = async () => {
      if (confirm(t('menu.withdrawConfirm'))) {
          try {
              await axios.delete('/api/auth/me');
              logout();
              alert(t('menu.accountDeleted'));
          } catch (err) {
              alert(t('menu.withdrawFailed'));
          }
      }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 30, padding: 50 }}>
      <h1>{t('menu.title')}</h1>
      
      {user ? (
          <div style={{ background: '#333', padding: 20, borderRadius: 8, width: 300, textAlign: 'left' }}>
              <h3>{t('menu.welcome', { nickname: user.nickname })}</h3>
              <p>{t('menu.rank', { rank: user.rank })}</p>
              <p>{t('menu.record', { wins: user.wins, losses: user.losses })}</p>
              <p>{t('menu.coins', { coins: user.coins })}</p>
              <div style={{ display: 'flex', gap: 10, marginTop: 10 }}>
                  <button onClick={logout} style={{ fontSize: '0.8em', background: '#555' }}>{t('menu.logout')}</button>
                  <button onClick={handleWithdraw} style={{ fontSize: '0.8em', background: '#a00' }}>{t('menu.withdraw')}</button>
              </div>
          </div>
      ) : (
          <div>
              <Link to="/login"><button>{t('menu.login')}</button></Link>
              <Link to="/register"><button style={{ marginLeft: 10 }}>{t('menu.register')}</button></Link>
          </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 15, width: 250 }}>
          <button onClick={() => navigate('/game?mode=ai')}>{t('menu.aiMatch')}</button>
          <button onClick={() => navigate('/game?mode=online')}>{t('menu.onlineMatch')}</button>
          <button onClick={() => navigate('/replay')}>{t('menu.replay')}</button>
      </div>
    </div>
  );
}

export default MainMenu;
