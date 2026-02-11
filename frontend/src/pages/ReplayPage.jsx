import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom'; // Changed useSearchParams to useParams
import axios from 'axios';
import Board from '../components/Board';

function ReplayPage() {
    const { id } = useParams();
    const [gameData, setGameData] = useState(null);

    useEffect(() => {
        axios.get(`/api/games/${id}`)
            .then(res => setGameData(res.data))
            .catch(err => console.error(err));
    }, [id]);

    if (!gameData) return <div style={{color:'white'}}>Loading...</div>;

    const history = JSON.parse(gameData.moves);

    return (
        <Board 
            gameMode="replay"
            replayHistory={history}
        />
    );
}

export default ReplayPage;
