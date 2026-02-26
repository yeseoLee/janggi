import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import axios from 'axios';
import Board from '../components/Board';
import { toReplayFrames } from '../game/replay';
import { TEAM } from '../game/constants';
import { useLanguage } from '../context/LanguageContext';

const BOARD_ZOOM_STORAGE_KEY = 'janggi_board_zoomed';

function ReplayPage() {
    const { id } = useParams();
    const navigate = useNavigate();
    const [gameData, setGameData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [viewTeam, setViewTeam] = useState(TEAM.CHO);
    const [invertColor, setInvertColor] = useState(false);
    const [useRotatedPieces, setUseRotatedPieces] = useState(false);
    const [styleVariant, setStyleVariant] = useState('2');
    const [boardZoomed, setBoardZoomed] = useState(() => localStorage.getItem(BOARD_ZOOM_STORAGE_KEY) === '1');
    const { t } = useLanguage();

    useEffect(() => {
        localStorage.setItem(BOARD_ZOOM_STORAGE_KEY, boardZoomed ? '1' : '0');
    }, [boardZoomed]);

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
            key={id}
            gameMode="replay"
            replayHistory={replayHistory}
            viewTeam={viewTeam}
            setViewTeam={setViewTeam}
            invertColor={invertColor}
            setInvertColor={setInvertColor}
            useRotatedPieces={useRotatedPieces}
            setUseRotatedPieces={setUseRotatedPieces}
            styleVariant={styleVariant}
            setStyleVariant={setStyleVariant}
            boardZoomed={boardZoomed}
            setBoardZoomed={setBoardZoomed}
        />
    );
}

export default ReplayPage;
