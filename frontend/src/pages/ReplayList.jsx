import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import '../components/Board.css'; // Reuse basic styles
import { useLanguage } from '../context/LanguageContext';

function ReplayList() {
    const [games, setGames] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const navigate = useNavigate();
    const { t } = useLanguage();

    useEffect(() => {
        setLoading(true);
        axios.get('/api/games')
            .then((res) => setGames(res.data))
            .catch((err) => {
                console.error(err);
                setError(t('replay.listLoadFailed'));
            })
            .finally(() => setLoading(false));
    }, [t]);

    const getResultLabel = (resultType) => {
        const key = `replay.result.${resultType || 'unknown'}`;
        const translated = t(key);
        return translated === key ? t('replay.result.unknown') : translated;
    };

    return (
        <div className="replay-list-container" style={{ color: 'white', padding: '20px', textAlign: 'center' }}>
            <h1>{t('replay.listTitle')}</h1>
            <button onClick={() => navigate('/')} style={{ marginBottom: '20px', padding: '10px' }}>{t('replay.backToMain')}</button>
            
            {loading && <p>{t('replay.loading')}</p>}
            {!loading && error && <p>{error}</p>}
            {!loading && !error && games.length === 0 && <p>{t('replay.noGames')}</p>}

            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', alignItems: 'center' }}>
                {games.map(game => (
                    <div key={game.id} 
                         onClick={() => navigate(`/replay/${game.id}`)}
                         style={{
                             background: 'rgba(255,255,255,0.1)',
                             padding: '15px',
                             borderRadius: '8px',
                             width: '80%',
                             maxWidth: '600px',
                             cursor: 'pointer',
                             display: 'flex',
                             justifyContent: 'space-between'
                        }}>
                        <div>
                            <span style={{ color: '#5078f2' }}>{game.cho_name || (game.winner_team === 'cho' ? game.winner_name : game.loser_name)} ({t('board.team.cho')})</span>
                            {' vs '}
                            <span style={{ color: '#f25050' }}>{game.han_name || (game.winner_team === 'han' ? game.winner_name : game.loser_name)} ({t('board.team.han')})</span>
                        </div>
                        <div>
                            {t('replay.winner')}: <strong>{game.winner_name}</strong> ({game.winner_team?.toUpperCase()})
                        </div>
                        <div>
                            {t('replay.moves')}: <strong>{game.move_count ?? 0}</strong>
                        </div>
                        <div>
                            {t('replay.end')}: <strong>{getResultLabel(game.result_type)}</strong>
                        </div>
                        <div style={{ fontSize: '0.8em', color: '#ccc' }}>
                            {new Date(game.played_at).toLocaleString()}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}

export default ReplayList;
