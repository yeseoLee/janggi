import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { useLanguage } from '../context/LanguageContext';
import { useAuth } from '../context/AuthContext';
import BottomNav from '../components/BottomNav';

function ReplayList() {
  const [games, setGames] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const navigate = useNavigate();
  const { t } = useLanguage();
  const { user } = useAuth();

  useEffect(() => {
    setLoading(true);
    axios.get('/api/games')
      .then((res) => setGames(res.data || []))
      .catch(() => setError(t('replay.listLoadFailed')))
      .finally(() => setLoading(false));
  }, [t]);

  const getResultInfo = (game) => {
    if (!game.winner_name) return { type: 'draw', text: t('records.drawChar'), sub: 'Draw' };
    if (user && game.winner_name === user.nickname) return { type: 'win', text: t('records.winChar'), sub: 'Win' };
    return { type: 'loss', text: t('records.lossChar'), sub: 'Loss' };
  };

  const getMyTeam = (game) => {
    if (!user) return 'cho';
    const isCho = (game.cho_name === user.nickname) ||
      (game.winner_team === 'cho' && game.winner_name === user.nickname) ||
      (game.winner_team === 'han' && game.winner_name !== user.nickname);
    return isCho ? 'cho' : 'han';
  };

  const getOpponentName = (game) => {
    const choName = game.cho_name || (game.winner_team === 'cho' ? game.winner_name : game.loser_name);
    const hanName = game.han_name || (game.winner_team === 'han' ? game.winner_name : game.loser_name);
    if (user && choName === user.nickname) return hanName || 'AI';
    if (user && hanName === user.nickname) return choName || 'AI';
    return `${choName || '?'} vs ${hanName || '?'}`;
  };

  const getGameType = (game) => {
    if (game.game_mode === 'ai') return t('records.aiMatch');
    if (game.game_mode === 'online') return t('records.rankedMatch');
    return t('records.friendlyMatch');
  };

  const getResultType = (game) => {
    const key = `replay.result.${game.result_type || 'unknown'}`;
    const translated = t(key);
    return translated === key ? null : translated;
  };

  const totalGames = games.length;
  const wins = user ? games.filter(g => g.winner_name === user.nickname).length : 0;
  const winRate = totalGames > 0 ? ((wins / totalGames) * 100).toFixed(1) : '0.0';

  return (
    <>
      <header className="records-header">
        <button className="header-icon-btn" onClick={() => navigate('/')}>
          <span className="material-icons-round">arrow_back</span>
        </button>
        <h1>{t('records.title')}</h1>
        <div style={{ width: 40 }} />
      </header>

      <div className="records-page page-with-nav">
        <div className="records-stats-bar">
          <div className="records-stat">
            <div className="records-stat-label">{t('records.totalGames')}</div>
            <div className="records-stat-value">{totalGames.toLocaleString()}</div>
          </div>
          <div className="records-stat">
            <div className="records-stat-label">{t('records.winRateStat')}</div>
            <div className="records-stat-value">{winRate}%</div>
          </div>
        </div>

        {loading && <div className="page-loading">{t('replay.loading')}</div>}
        {!loading && error && <div className="page-empty"><span className="material-icons-round">error_outline</span>{error}</div>}
        {!loading && !error && games.length === 0 && (
          <div className="page-empty">
            <span className="material-icons-round">inbox</span>
            {t('records.noGames')}
          </div>
        )}

        <div className="records-list">
          {games.map(game => {
            const result = getResultInfo(game);
            const myTeam = getMyTeam(game);
            const opponent = getOpponentName(game);
            const gameType = getGameType(game);
            const specialResult = getResultType(game);
            const dateStr = game.played_at ? new Date(game.played_at).toLocaleDateString() : '';

            return (
              <div key={game.id} className="record-card" onClick={() => navigate(`/replay/${game.id}`)}>
                <div className="record-result-col">
                  <span className={`record-result-text ${result.type}`}>{result.text}</span>
                  <span className="record-result-sub">{result.sub}</span>
                </div>
                <div className="record-card-body">
                  <div className="record-card-top">
                    <span className="record-game-type">{gameType}</span>
                    <span className="record-date">{dateStr}</span>
                  </div>
                  <div className="record-match-row">
                    <div className={`record-team-badge ${myTeam}`}>
                      {myTeam === 'cho' ? '楚' : '漢'}
                    </div>
                    <span className="record-vs">VS</span>
                    <span className="record-opponent-name">{opponent}</span>
                  </div>
                  <div className="record-meta-row">
                    {game.move_count != null && (
                      <span className="record-meta-item">
                        <span className="material-icons-round">timer</span>
                        {game.move_count}{t('board.movesUnit')}
                      </span>
                    )}
                    {specialResult && (
                      <span className={`record-special-badge ${result.type === 'win' ? 'win-special' : 'loss-special'}`}>
                        {specialResult}
                      </span>
                    )}
                  </div>
                </div>
                <div className="record-card-arrow">
                  <span className="material-icons-round">chevron_right</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <BottomNav />
    </>
  );
}

export default ReplayList;
