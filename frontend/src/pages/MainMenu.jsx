import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useNavigate, Link } from 'react-router-dom';
import axios from 'axios';
import { useLanguage } from '../context/LanguageContext';

function MainMenu() {
  const { user, logout, refreshUser } = useAuth();
  const navigate = useNavigate();
  const { t } = useLanguage();
  const [toastMessage, setToastMessage] = useState('');
  const [isRecharging, setIsRecharging] = useState(false);
  const [isStartingAi, setIsStartingAi] = useState(false);
  const toastTimerRef = useRef(null);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) {
        clearTimeout(toastTimerRef.current);
      }
    };
  }, []);

  const showToast = (message) => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToastMessage(message);
    toastTimerRef.current = setTimeout(() => {
      setToastMessage('');
    }, 2200);
  };

  const handleWithdraw = async () => {
      if (confirm(t('menu.withdrawConfirm'))) {
          try {
              await axios.delete('/api/auth/me');
              logout();
              alert(t('menu.accountDeleted'));
          } catch {
              alert(t('menu.withdrawFailed'));
          }
      }
  };

  const handleRechargeCoins = async () => {
    if (!user || isRecharging) return;
    setIsRecharging(true);
    try {
      // TODO(next): after coin grant, chain ad-link navigation and daily-limit feedback in this flow.
      const response = await axios.post('/api/coins/recharge');
      await refreshUser();
      showToast(t('menu.rechargeSuccess', { amount: response.data?.added ?? 10 }));
    } catch {
      showToast(t('menu.rechargeFailed'));
    } finally {
      setIsRecharging(false);
    }
  };

  const handleAiMatchStart = async () => {
    if (isStartingAi) return;
    if (!user) {
      navigate('/login');
      return;
    }

    setIsStartingAi(true);
    try {
      await axios.post('/api/coins/spend-ai-match');
      await refreshUser();
      navigate('/game?mode=ai');
    } catch (err) {
      if (err.response?.status === 400) {
        showToast(t('menu.aiMatchNotEnoughCoins'));
        return;
      }
      showToast(t('menu.aiMatchStartFailed'));
    } finally {
      setIsStartingAi(false);
    }
  };

  if (!user) {
    return (
      <div style={{ width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, padding: 50, textAlign: 'center' }}>
        <Link to="/login"><button>{t('menu.login')}</button></Link>
        <Link to="/register"><button>{t('menu.register')}</button></Link>
      </div>
    );
  }

  return (
    <div style={{ width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 30, padding: 50, position: 'relative', textAlign: 'center' }}>
      <h1>{t('menu.title')}</h1>

      <div style={{ background: '#333', padding: 20, borderRadius: 8, width: 300, textAlign: 'center' }}>
        <h3>{t('menu.welcome', { nickname: user.nickname })}</h3>
        <p>{t('menu.rank', { rank: user.rank })}</p>
        <p>{t('menu.record', { wins: user.wins, losses: user.losses })}</p>
        <p>{t('menu.coins', { coins: user.coins })}</p>
        <div style={{ display: 'flex', gap: 10, marginTop: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
          <button onClick={logout} style={{ fontSize: '0.8em', background: '#555' }}>{t('menu.logout')}</button>
          <button onClick={handleWithdraw} style={{ fontSize: '0.8em', background: '#a00' }}>{t('menu.withdraw')}</button>
          <button onClick={handleRechargeCoins} disabled={isRecharging} style={{ fontSize: '0.8em', background: '#d08700' }}>{t('menu.rechargeCoins')}</button>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 15, width: 250 }}>
          <button onClick={handleAiMatchStart} disabled={isStartingAi}>{t('menu.aiMatch')}</button>
          <button onClick={() => navigate('/game?mode=online')}>{t('menu.onlineMatch')}</button>
          <button onClick={() => navigate('/replay')}>{t('menu.replay')}</button>
      </div>

      {toastMessage && (
        <div
          style={{
            position: 'fixed',
            bottom: 28,
            left: '50%',
            transform: 'translateX(-50%)',
            padding: '10px 14px',
            borderRadius: 10,
            background: 'rgba(20, 20, 24, 0.94)',
            border: '1px solid rgba(255, 255, 255, 0.2)',
            color: '#f5f5f5',
            fontSize: '0.9rem',
            zIndex: 500,
            boxShadow: '0 8px 20px rgba(0, 0, 0, 0.25)',
          }}
        >
          {toastMessage}
        </div>
      )}
    </div>
  );
}

export default MainMenu;
