import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import axios from 'axios';
import Board from '../components/Board';
import { toReplayFrames } from '../game/replay';

function ReplayPage() {
    const { id } = useParams();
    const navigate = useNavigate();
    const [gameData, setGameData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    useEffect(() => {
        setLoading(true);
        setError('');
        axios.get(`/api/games/${id}`)
            .then((res) => setGameData(res.data))
            .catch((err) => {
                console.error(err);
                setError('기보를 불러오지 못했습니다.');
            })
            .finally(() => setLoading(false));
    }, [id]);

    if (loading) {
        return <div style={{ color: 'white', padding: '20px' }}>Loading replay...</div>;
    }

    if (error) {
        return (
            <div style={{ color: 'white', padding: '20px' }}>
                <p>{error}</p>
                <button onClick={() => navigate('/replay')}>기보 목록으로</button>
            </div>
        );
    }

    const replayHistory = toReplayFrames(gameData);

    if (!replayHistory || replayHistory.length === 0) {
        return (
            <div style={{ color: 'white', padding: '20px' }}>
                <p>재생 가능한 기보 데이터가 없습니다.</p>
                <button onClick={() => navigate('/replay')}>기보 목록으로</button>
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
