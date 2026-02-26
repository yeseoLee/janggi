import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import Board from '../components/Board';
import { TEAM } from '../game/constants';

const BOARD_ZOOM_STORAGE_KEY = 'janggi_board_zoomed';

function GamePage() {
  const [searchParams] = useSearchParams();
  const mode = searchParams.get('mode') || 'ai'; // 'ai', 'online', 'friendly', 'solo'
  const friendlyMatchId = searchParams.get('matchId') || '';
  
  const [viewTeam, setViewTeam] = useState(TEAM.CHO);
  const [invertColor, setInvertColor] = useState(false);
  const [useRotatedPieces, setUseRotatedPieces] = useState(false);
  const [styleVariant, setStyleVariant] = useState('2');
  const [boardZoomed, setBoardZoomed] = useState(() => localStorage.getItem(BOARD_ZOOM_STORAGE_KEY) === '1');

  useEffect(() => {
    localStorage.setItem(BOARD_ZOOM_STORAGE_KEY, boardZoomed ? '1' : '0');
  }, [boardZoomed]);

  return (
      <Board 
        gameMode={mode}
        friendlyMatchId={friendlyMatchId}
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

export default GamePage;
