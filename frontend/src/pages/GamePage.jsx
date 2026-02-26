import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import Board from '../components/Board';
import { TEAM } from '../game/constants';

function GamePage() {
  const [searchParams] = useSearchParams();
  const mode = searchParams.get('mode') || 'ai'; // 'ai', 'online', 'friendly', 'solo'
  const friendlyMatchId = searchParams.get('matchId') || '';
  
  const [viewTeam, setViewTeam] = useState(TEAM.CHO);
  const [invertColor, setInvertColor] = useState(false);
  const [useRotatedPieces, setUseRotatedPieces] = useState(false);
  const [styleVariant, setStyleVariant] = useState('2');

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
      />
  );
}

export default GamePage;
