import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import axios from 'axios';
import BottomNav from '../components/BottomNav';
import { useLanguage } from '../context/LanguageContext';
import { normalizeResultMethod } from '../game/result';

function FriendReplayList() {
  const navigate = useNavigate();
  const { friendId } = useParams();
  const { t } = useLanguage();
  const [friend, setFriend] = useState(null);
  const [games, setGames] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    setLoading(true);
    axios.get(`/api/social/friends/${friendId}/games`)
      .then((res) => {
        setFriend(res.data?.friend || null);
        setGames(res.data?.games || []);
      })
      .catch(() => {
        setError(t('social.friendRecordsLoadFailed'));
      })
      .finally(() => setLoading(false));
  }, [friendId, t]);

  const getResultLabel = (game) => {
    const method = normalizeResultMethod(game.result_type);
    const methodLabel = t(`replay.result.${method}`);
    if (game.my_result === 'win') return { type: 'win', label: t('replay.resultWin', { method: methodLabel }) };
    if (game.my_result === 'loss') return { type: 'loss', label: t('replay.resultLoss', { method: methodLabel }) };
    return { type: 'draw', label: t('records.draw') };
  };

  const getTeamChar = (game) => {
    const team = game.my_team === 'han' ? 'han' : 'cho';
    return team === 'cho' ? { char: '楚', team } : { char: '漢', team };
  };

  const getOpponentName = (game) => {
    if (typeof game.opponent_name === 'string' && game.opponent_name.trim()) return game.opponent_name;
    const choName = game.cho_name || (game.winner_team === 'cho' ? game.winner_name : game.loser_name);
    const hanName = game.han_name || (game.winner_team === 'han' ? game.winner_name : game.loser_name);
    if (friend?.nickname && choName === friend.nickname) return hanName || 'AI';
    return choName || 'AI';
  };

  const formatDate = (dateStr) => {
    if (!dateStr) return '';
    return new Date(dateStr).toLocaleDateString();
  };

  return (
    <>
      <header className="records-header">
        <button className="header-icon-btn" onClick={() => navigate('/social')}>
          <span className="material-icons-round">arrow_back</span>
        </button>
        <h1>{t('social.friendRecordsTitle', { nickname: friend?.nickname || '-' })}</h1>
        <div style={{ width: 40 }} />
      </header>

      <div className="records-page page-with-nav">
        {loading && <div className="page-loading">{t('replay.loading')}</div>}
        {!loading && error && <div className="page-empty"><span className="material-icons-round">error_outline</span>{error}</div>}

        {!loading && !error && (
          <div className="records-list" style={{ paddingTop: 12 }}>
            {games.length === 0 && (
              <div className="page-empty" style={{ padding: '24px 0' }}>
                <span className="material-icons-round">inbox</span>
                <span>{t('records.noGames')}</span>
              </div>
            )}
            {games.map((game) => {
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
                        {formatDate(game.played_at)} {game.move_count ? `• ${game.move_count}${t('board.movesUnit')}` : ''}
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
        )}
      </div>
      <BottomNav />
    </>
  );
}

export default FriendReplayList;
