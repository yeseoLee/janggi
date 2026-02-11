import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import '../components/Board.css'; // Reuse basic styles

function ReplayList() {
    const [games, setGames] = useState([]);
    const navigate = useNavigate();

    useEffect(() => {
        axios.get('/api/games')
            .then(res => setGames(res.data))
            .catch(err => console.error(err));
    }, []);

    return (
        <div className="replay-list-container" style={{ color: 'white', padding: '20px', textAlign: 'center' }}>
            <h1>Game Replays (Gibo)</h1>
            <button onClick={() => navigate('/')} style={{ marginBottom: '20px', padding: '10px' }}>Back to Main Menu</button>
            
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
                            <span style={{ color: '#5078f2' }}>{game.winner_team === 'cho' ? game.winner_name : game.loser_name} (Cho)</span>
                            {' vs '}
                            <span style={{ color: '#f25050' }}>{game.winner_team === 'han' ? game.winner_name : game.loser_name} (Han)</span>
                        </div>
                        <div>
                            Winner: <strong>{game.winner_name}</strong>
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
