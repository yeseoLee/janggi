import { useRef, useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import axios from 'axios';
import BottomNav from '../components/BottomNav';

function Profile() {
  const { user, logout, refreshUser } = useAuth();
  const navigate = useNavigate();
  const { t, language, setLanguage } = useLanguage();
  const [toastMessage, setToastMessage] = useState('');
  const [isRecharging, setIsRecharging] = useState(false);
  const [showWithdrawModal, setShowWithdrawModal] = useState(false);
  const [isWithdrawing, setIsWithdrawing] = useState(false);
  const toastTimerRef = useRef(null);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  }, []);

  if (!user) {
    navigate('/login');
    return null;
  }

  const showToast = (message) => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToastMessage(message);
    toastTimerRef.current = setTimeout(() => setToastMessage(''), 2200);
  };

  const handleWithdraw = () => {
    if (isWithdrawing) return;
    setShowWithdrawModal(true);
  };

  const handleCancelWithdraw = () => {
    if (isWithdrawing) return;
    setShowWithdrawModal(false);
  };

  const handleConfirmWithdraw = async () => {
    if (isWithdrawing) return;
    setIsWithdrawing(true);
    try {
      await axios.delete('/api/auth/me');
      setShowWithdrawModal(false);
      showToast(t('menu.accountDeleted'));
      setTimeout(() => {
        logout();
      }, 700);
    } catch {
      setShowWithdrawModal(false);
      showToast(t('menu.withdrawFailed'));
    } finally {
      setIsWithdrawing(false);
    }
  };

  const handleRechargeCoins = async () => {
    if (!user || isRecharging) return;
    setIsRecharging(true);
    try {
      const response = await axios.post('/api/coins/recharge');
      await refreshUser();
      showToast(t('menu.rechargeSuccess', { amount: response.data?.added ?? 10 }));
    } catch {
      showToast(t('menu.rechargeFailed'));
    } finally {
      setIsRecharging(false);
    }
  };

  const totalGames = (user.wins ?? 0) + (user.losses ?? 0);
  const winRate = totalGames > 0 ? ((user.wins / totalGames) * 100).toFixed(1) : '0.0';
  const lossRate = totalGames > 0 ? ((user.losses / totalGames) * 100).toFixed(1) : '0.0';
  const winPct = totalGames > 0 ? Math.round((user.wins / totalGames) * 100) : 0;

  const rankWins = user.rank_wins ?? 0;
  const rankLosses = user.rank_losses ?? 0;
  const rankTotal = rankWins + rankLosses;
  const rankWinPct = rankTotal > 0 ? Math.round((rankWins / rankTotal) * 100) : 0;
  const rankWinRate = rankTotal > 0 ? ((rankWins / rankTotal) * 100).toFixed(1) : '0.0';

  return (
    <>
      <header className="profile-page-header">
        <button className="header-icon-btn" onClick={() => navigate('/')}>
          <span className="material-icons-round">arrow_back</span>
        </button>
        <h1>{t('profile.title')}</h1>
        <button className="header-icon-btn" onClick={logout}>
          <span className="material-icons-round">logout</span>
        </button>
      </header>

      <div className="profile-page page-with-nav">
        {/* Main Profile Card */}
        <div className="profile-main-card">
          <div className="profile-avatar-large">
            <div className="profile-avatar-large-img">
              {user.nickname?.charAt(0) || '?'}
            </div>
          </div>
          <h2>{user.nickname}</h2>
          <p className="profile-id">ID: {user.username}</p>
          <div className="profile-status">
            <div className="profile-status-dot" />
            {t('profile.online')}
          </div>
        </div>

        {/* Rank & Rating */}
        <div className="profile-rank-rating">
          <div className="profile-rank-card">
            <span className="profile-rank-card-label">{t('profile.currentRank')}</span>
            <div className="profile-rank-icon">
              <span>漢</span>
            </div>
            <span className="profile-rank-text">{user.rank || '18급'}</span>
          </div>
          <div className="profile-rating-card">
            <span className="profile-rating-card-label">{t('profile.rating')}</span>
            <span className="profile-rating-value">{user.rating ?? 0}</span>
          </div>
        </div>

        {/* Battle Record */}
        <div className="profile-battle-card">
          <div className="profile-battle-header">
            <h3>{t('profile.battleRecord')}</h3>
          </div>
          <div className="profile-battle-content">
            <div className="profile-battle-row">
              <label>
                <span>{t('profile.totalRecord')}</span>
                <span>{totalGames}{t('profile.games')} {user.wins ?? 0}{t('records.winShort')} {user.losses ?? 0}{t('records.lossShort')}</span>
              </label>
              <div className="profile-progress-bar">
                <div className="win-bar" style={{ width: `${winPct}%` }} />
                <div className="loss-bar" style={{ width: `${100 - winPct}%` }} />
              </div>
              <div className="profile-progress-labels">
                <span>{t('profile.winRateLabel')} {winRate}%</span>
                <span>{t('profile.lossRateLabel')} {lossRate}%</span>
              </div>
            </div>

            <div className="profile-battle-row">
              <label>
                <span>{t('profile.rankRecord')}</span>
                <span>{rankTotal}{t('profile.games')} {rankWins}{t('records.winShort')} {rankLosses}{t('records.lossShort')}</span>
              </label>
              <div className="profile-progress-bar">
                <div className="primary-bar" style={{ width: `${rankWinPct}%` }} />
              </div>
              <div className="profile-progress-labels">
                <span>{t('profile.winRateLabel')} {rankWinRate}%</span>
              </div>
            </div>
          </div>
        </div>

        {/* Gold */}
        <div className="profile-gold-card">
          <div className="profile-gold-left">
            <div className="profile-gold-icon">
              <span className="material-icons-round">monetization_on</span>
            </div>
            <div>
              <div className="profile-gold-label">{t('profile.goldLabel')}</div>
              <div className="profile-gold-amount">{(user.coins ?? 0).toLocaleString()} G</div>
            </div>
          </div>
          <button className="profile-charge-btn" onClick={handleRechargeCoins} disabled={isRecharging}>
            {t('profile.charge')}
          </button>
        </div>

        {/* Settings */}
        <div className="profile-settings-list">
          <div className="profile-settings-item language-row">
            <div className="profile-settings-item-left">
              <span className="material-icons-round">language</span>
              <span>{t('profile.language')}</span>
            </div>
            <div className="profile-lang-toggle">
              <button
                className={`profile-lang-btn ${language === 'ko' ? 'active' : ''}`}
                onClick={() => setLanguage('ko')}
              >
                한국어
              </button>
              <button
                className={`profile-lang-btn ${language === 'en' ? 'active' : ''}`}
                onClick={() => setLanguage('en')}
              >
                English
              </button>
            </div>
          </div>
          <button className="profile-settings-item" onClick={() => navigate('/records')}>
            <div className="profile-settings-item-left">
              <span className="material-icons-round">history</span>
              <span>{t('profile.gameRecords')}</span>
            </div>
            <span className="material-icons-round">chevron_right</span>
          </button>
          <button className="profile-settings-item" onClick={logout}>
            <div className="profile-settings-item-left">
              <span className="material-icons-round">logout</span>
              <span>{t('profile.logout')}</span>
            </div>
          </button>
          <button className="profile-settings-item danger" onClick={handleWithdraw}>
            <div className="profile-settings-item-left">
              <span className="material-icons-round">delete_forever</span>
              <span>{t('profile.withdraw')}</span>
            </div>
          </button>
        </div>
      </div>

      {showWithdrawModal && (
        <div className="menu-confirm-overlay" onClick={handleCancelWithdraw}>
          <div className="menu-confirm-card" onClick={(e) => e.stopPropagation()}>
            <div className="menu-confirm-title">{t('menu.withdrawConfirm')}</div>
            <div className="menu-confirm-actions">
              <button className="menu-confirm-btn secondary" onClick={handleCancelWithdraw} disabled={isWithdrawing}>
                {t('common.no')}
              </button>
              <button className="menu-confirm-btn primary" onClick={handleConfirmWithdraw} disabled={isWithdrawing}>
                {t('common.yes')}
              </button>
            </div>
          </div>
        </div>
      )}

      {toastMessage && <div className="toast-notification">{toastMessage}</div>}

      <BottomNav />
    </>
  );
}

export default Profile;
