import { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useNavigate, Link } from 'react-router-dom';
import axios from 'axios';
import { useLanguage } from '../context/LanguageContext';

const GUP_PATTERN = /^([1-9]|1[0-8])급$/;
const DAN_PATTERN = /^([1-9])단$/;

const normalizeCounter = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.floor(parsed));
};

const getRankThreshold = (rank) => {
  const gupMatch = rank?.match(GUP_PATTERN);
  if (gupMatch) {
    const gup = Number(gupMatch[1]);
    return gup >= 10 ? 3 : 5;
  }
  if (DAN_PATTERN.test(rank || '')) return 7;
  return 3;
};

const getRankTier = (rank) => {
  const gupMatch = rank?.match(GUP_PATTERN);
  if (gupMatch) return 18 - Number(gupMatch[1]);

  const danMatch = rank?.match(DAN_PATTERN);
  if (danMatch) return 17 + Number(danMatch[1]);

  return 0;
};

const buildRankProgress = (rank, rankWins, rankLosses) => {
  const wins = normalizeCounter(rankWins);
  const losses = normalizeCounter(rankLosses);
  const threshold = getRankThreshold(rank);
  const tier = getRankTier(rank);
  const canPromote = tier < 26;
  const canDemote = tier > 0;

  return {
    wins,
    losses,
    canPromote,
    canDemote,
    winsRemaining: canPromote ? Math.max(0, threshold - wins) : 0,
    lossesRemaining: canDemote ? Math.max(0, threshold - losses) : 0,
  };
};

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

  const rankProgress = useMemo(
    () => buildRankProgress(user?.rank, user?.rank_wins, user?.rank_losses),
    [user?.rank, user?.rank_wins, user?.rank_losses],
  );

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
      <div className="screen-centered initial-auth-page">
        <h1 className="initial-title">{t('menu.titleSimple')}</h1>
        <div className="initial-auth-buttons">
          <Link to="/login"><button>{t('menu.login')}</button></Link>
          <Link to="/register"><button>{t('menu.register')}</button></Link>
        </div>
      </div>
    );
  }

  return (
    <div className="menu-page">
      <h1 className="menu-page-title">{t('menu.title')}</h1>

      <div className="menu-user-card">
        <h3>{t('menu.welcome', { nickname: user.nickname })}</h3>
        <p className="menu-rank-line">
          {t('menu.rank', { rank: user.rank })}
          <span className="menu-rank-inline">
            {t('menu.rankRecordShort', { wins: rankProgress.wins, losses: rankProgress.losses })}
          </span>
        </p>
        <p className="menu-rank-remaining">
          {t('menu.rankProgressToGo', {
            promotion: rankProgress.canPromote
              ? t('menu.rankProgressPromotionLeft', { count: rankProgress.winsRemaining })
              : t('menu.rankProgressPromotionLocked'),
            demotion: rankProgress.canDemote
              ? t('menu.rankProgressDemotionLeft', { count: rankProgress.lossesRemaining })
              : t('menu.rankProgressDemotionLocked'),
          })}
        </p>
        <p>{t('menu.record', { wins: user.wins, losses: user.losses })}</p>
        <p>{t('menu.coins', { coins: user.coins })}</p>
        <div className="menu-account-actions">
          <button onClick={logout} style={{ background: '#555' }}>{t('menu.logout')}</button>
          <button onClick={handleWithdraw} style={{ background: '#a00' }}>{t('menu.withdraw')}</button>
          <button onClick={handleRechargeCoins} disabled={isRecharging} style={{ background: '#d08700' }}>{t('menu.rechargeCoins')}</button>
        </div>
      </div>

      <div className="menu-play-actions">
        <button onClick={handleAiMatchStart} disabled={isStartingAi}>{t('menu.aiMatch')}</button>
        <button onClick={() => navigate('/game?mode=online')}>{t('menu.onlineMatch')}</button>
        <button onClick={() => navigate('/replay')}>{t('menu.replay')}</button>
      </div>

      {toastMessage && (
        <div className="menu-toast">
          {toastMessage}
        </div>
      )}
    </div>
  );
}

export default MainMenu;
