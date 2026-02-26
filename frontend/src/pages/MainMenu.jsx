import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useNavigate, Link } from 'react-router-dom';
import axios from 'axios';
import { useLanguage } from '../context/LanguageContext';
import BottomNav from '../components/BottomNav';
import { normalizeResultMethod } from '../game/result';

function MainMenu() {
  const { user, logout, refreshUser } = useAuth();
  const navigate = useNavigate();
  const { t } = useLanguage();
  const [toastMessage, setToastMessage] = useState('');
  const [isStartingAi, setIsStartingAi] = useState(false);
  const [recentGames, setRecentGames] = useState([]);
  const [matchRequestType, setMatchRequestType] = useState(null);
  const toastTimerRef = useRef(null);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (user) {
      axios.get('/api/games')
        .then(res => setRecentGames((res.data || []).slice(0, 3)))
        .catch(() => {});
    }
  }, [user]);

  const showToast = (message) => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToastMessage(message);
    toastTimerRef.current = setTimeout(() => setToastMessage(''), 2200);
  };

  const handleAiMatchStart = async () => {
    if (isStartingAi) return;
    if (!user) { navigate('/login'); return; }
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

  const openMatchRequestModal = (type) => {
    if (!user) {
      navigate('/login');
      return;
    }
    setMatchRequestType(type);
  };

  const closeMatchRequestModal = () => {
    if (isStartingAi) return;
    setMatchRequestType(null);
  };

  const handleConfirmMatchRequest = async () => {
    if (matchRequestType === 'ai') {
      setMatchRequestType(null);
      await handleAiMatchStart();
      return;
    }

    if (matchRequestType === 'online') {
      setMatchRequestType(null);
      navigate('/game?mode=online');
    }
  };

  const winRate = user && (user.wins + user.losses > 0)
    ? ((user.wins / (user.wins + user.losses)) * 100).toFixed(1)
    : '0.0';
  const maxWinStreakRaw = Number(user?.max_win_streak);
  const maxWinStreak = Number.isFinite(maxWinStreakRaw)
    ? Math.max(0, Math.floor(maxWinStreakRaw))
    : 0;

  if (!user) {
    return (
      <div className="auth-page">
        <div className="auth-lattice-bg" />
        <div className="auth-logo">
          <div className="auth-logo-diamond">
            <div className="auth-logo-diamond-bg" />
            <div className="auth-logo-diamond-inner" />
            <span className="auth-logo-char">漢</span>
          </div>
          <h1>{t('menu.titleSimple')}</h1>
          <p>Master Janggi</p>
        </div>
        <div className="auth-form-card" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <Link to="/login" className="auth-submit-btn" style={{ textAlign: 'center', textDecoration: 'none' }}>
            {t('menu.login')}
          </Link>
          <Link to="/register" className="auth-secondary-btn">
            {t('menu.register')}
          </Link>
        </div>
      </div>
    );
  }

  const getResultLabel = (game) => {
    if (!game.winner_name) return { type: 'draw', label: t('records.draw') };
    const resultMethod = normalizeResultMethod(game.result_type);
    const methodLabel = t(`replay.result.${resultMethod}`);
    if (game.winner_name === user.nickname) {
      return { type: 'win', label: t('replay.resultWin', { method: methodLabel }) };
    }
    return { type: 'loss', label: t('replay.resultLoss', { method: methodLabel }) };
  };

  const getTeamChar = (game) => {
    const isCho = (game.cho_name === user.nickname) ||
      (game.winner_team === 'cho' && game.winner_name === user.nickname) ||
      (game.winner_team === 'han' && game.winner_name !== user.nickname);
    return isCho ? { char: '楚', team: 'cho' } : { char: '漢', team: 'han' };
  };

  const getOpponentName = (game) => {
    const choName = game.cho_name || (game.winner_team === 'cho' ? game.winner_name : game.loser_name);
    const hanName = game.han_name || (game.winner_team === 'han' ? game.winner_name : game.loser_name);
    if (choName === user.nickname) return hanName || 'AI';
    return choName || 'AI';
  };

  const formatTimeAgo = (dateStr) => {
    if (!dateStr) return '';
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return t('records.justNow');
    if (mins < 60) return t('records.timeAgoMinutes', { count: mins });
    const hours = Math.floor(mins / 60);
    if (hours < 24) return t('records.timeAgoHours', { count: hours });
    return t('records.timeAgoDays', { count: Math.floor(hours / 24) });
  };

  return (
    <>
      <header className="app-header">
        <div className="app-header-left">
          <span className="material-icons-round">grid_on</span>
          <h1>K-Janggi</h1>
        </div>
        <div className="app-header-right">
          <button className="header-icon-btn" onClick={() => navigate('/profile')}>
            <span className="material-icons-round">settings</span>
          </button>
        </div>
      </header>

      <div className="home-page page-with-nav">
        <section className="profile-card">
          <div className="profile-card-deco" />
          <div className="profile-card-top">
            <div className="profile-avatar">
              <div className="profile-avatar-img">
                {user.nickname?.charAt(0) || '?'}
              </div>
              <div className="profile-rank-badge">{user.rank || '18급'}</div>
            </div>
            <div className="profile-info">
              <h2>{user.nickname}</h2>
              <p>Rating: <span className="rating">{user.rating ? `${user.rating}p` : '-'}</span></p>
            </div>
            <div className="profile-record">
              <div className="profile-record-label">{t('menu.recordLabel')}</div>
              <div className="profile-record-value">
                {user.wins ?? 0}{t('records.winShort')} {user.losses ?? 0}{t('records.lossShort')}
              </div>
            </div>
          </div>
          <div className="profile-card-stats">
            <div className="profile-stat">
              <div className="profile-stat-label">{t('menu.winStreak')}</div>
              <div className="profile-stat-value primary">{maxWinStreak}</div>
            </div>
            <div className="profile-stat-divider" />
            <div className="profile-stat">
              <div className="profile-stat-label">{t('menu.winRate')}</div>
              <div className="profile-stat-value">{winRate}%</div>
            </div>
            <div className="profile-stat-divider" />
            <div className="profile-stat">
              <div className="profile-stat-label">{t('menu.gold')}</div>
              <div className="profile-stat-value gold">
                <span className="material-icons-round">monetization_on</span>
                {user.coins?.toLocaleString() ?? 0}
              </div>
            </div>
          </div>
        </section>

        <section className="match-buttons">
          <button className="match-btn ai" onClick={() => openMatchRequestModal('ai')} disabled={isStartingAi}>
            <span className="material-icons-round">smart_toy</span>
            <span className="match-btn-title">{t('menu.aiMatchShort')}</span>
            <span className="match-btn-subtitle">{t('menu.aiMatchSub')}</span>
          </button>
          <button className="match-btn online" onClick={() => openMatchRequestModal('online')}>
            <span className="material-icons-round">sports_esports</span>
            <span className="match-btn-title">{t('menu.onlineMatchShort')}</span>
            <span className="match-btn-subtitle">{t('menu.onlineMatchSub')}</span>
          </button>
        </section>

        <section>
          <div className="recent-section-header">
            <h3>{t('menu.recentGames')}</h3>
            <a onClick={() => navigate('/records')}>{t('menu.viewMore')}</a>
          </div>
          <div className="recent-records-list">
            {recentGames.length === 0 && (
              <div className="page-empty" style={{ padding: '30px 0' }}>
                <span className="material-icons-round">inbox</span>
                <span>{t('records.noGames')}</span>
              </div>
            )}
            {recentGames.map(game => {
              const result = getResultLabel(game);
              const teamInfo = getTeamChar(game);
              const opponent = getOpponentName(game);
              return (
                <div key={game.id} className="recent-record-card" onClick={() => navigate(`/replay/${game.id}`)}>
                  <div className="recent-record-left">
                    <div className={`recent-team-icon ${teamInfo.team}`}>{teamInfo.char}</div>
                    <div className="recent-record-info">
                      <div className="opponent">vs {opponent}</div>
                      <div className="meta">
                        {formatTimeAgo(game.played_at)} {game.move_count ? `• ${game.move_count}${t('board.movesUnit')}` : ''}
                      </div>
                    </div>
                  </div>
                  <div className="recent-record-right">
                    <span className={`result-badge ${result.type}`}>{result.label}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      </div>

      {matchRequestType && (
        <div className="menu-confirm-overlay" onClick={closeMatchRequestModal}>
          <div className="menu-confirm-card" onClick={(e) => e.stopPropagation()}>
            <div className="menu-confirm-title">
              {matchRequestType === 'online' ? t('menu.onlineMatchConfirm') : t('menu.aiMatchConfirm')}
            </div>
            <div className="menu-confirm-actions">
              <button className="menu-confirm-btn secondary" onClick={closeMatchRequestModal}>
                {t('common.no')}
              </button>
              <button
                className="menu-confirm-btn primary"
                onClick={handleConfirmMatchRequest}
                disabled={matchRequestType === 'ai' && isStartingAi}
              >
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

export default MainMenu;
