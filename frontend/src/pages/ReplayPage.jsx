import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import axios from 'axios';
import Board from '../components/Board';
import { toReplayFrames } from '../game/replay';
import { useLanguage } from '../context/LanguageContext';

function ReplayPage() {
    const { id } = useParams();
    const navigate = useNavigate();
    const [gameData, setGameData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const { t } = useLanguage();

    useEffect(() => {
        setLoading(true);
        setError('');
        axios.get(`/api/games/${id}`)
            .then((res) => setGameData(res.data))
            .catch((err) => {
                console.error(err);
                setError(t('replay.detailLoadFailed'));
            })
            .finally(() => setLoading(false));
    }, [id, t]);

    if (loading) {
        return <div style={{ color: 'white', padding: '20px' }}>{t('replay.detailLoading')}</div>;
    }

    if (error) {
        return (
            <div style={{ color: 'white', padding: '20px' }}>
                <p>{error}</p>
                <button onClick={() => navigate('/replay')}>{t('replay.backToList')}</button>
            </div>
        );
    }

    const replayHistory = toReplayFrames(gameData);

    if (!replayHistory || replayHistory.length === 0) {
        return (
            <div style={{ color: 'white', padding: '20px' }}>
                <p>{t('replay.noPlayableData')}</p>
                <button onClick={() => navigate('/replay')}>{t('replay.backToList')}</button>
            </div>
        );
    }

    return (
        <Board 
            gameMode="replay"
            replayHistory={replayHistory}
        />
    );
}

export default ReplayPage;
