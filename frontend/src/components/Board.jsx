import { useState } from 'react';
import Piece from './Piece';
import { INITIAL_BOARD, TEAM, PIECE_TYPE } from '../game/constants';
import { getValidMoves } from '../game/rules';
import './Board.css';

const Board = ({ viewTeam, invertColor, useRotatedPieces, styleVariant }) => {
  const files = 9;
  const ranks = 10;
  
  const [board, setBoard] = useState(INITIAL_BOARD);
  const [turn, setTurn] = useState(TEAM.CHO); // Cho usually moves first
  const [selectedPos, setSelectedPos] = useState(null);
  const [validMoves, setValidMoves] = useState([]);

  // Handle cell click (logic for selection and movement)
  const handleCellClick = (r, c) => {
    // If we have a selected piece, check if the clicked cell is a valid move
    if (selectedPos) {
      const isMove = validMoves.some(m => m.r === r && m.c === c);
      if (isMove) {
        // Execute move
        movePiece(selectedPos, { r, c });
        return;
      }
    }

    // Select piece
    const piece = board[r][c];
    if (piece && piece.team === turn) {
      setSelectedPos({ r, c });
      const moves = getValidMoves(board, r, c);
      setValidMoves(moves);
    } else {
      // Deselect if clicking empty or enemy piece (without move intent)
      setSelectedPos(null);
      setValidMoves([]);
    }
  };

  const movePiece = (from, to) => {
    const newBoard = board.map(row => [...row]);
    const piece = newBoard[from.r][from.c];
    
    // Capture logic is implicit (overwrite)
    newBoard[to.r][to.c] = piece;
    newBoard[from.r][from.c] = null;
    
    setBoard(newBoard);
    setTurn(turn === TEAM.CHO ? TEAM.HAN : TEAM.CHO);
    setSelectedPos(null);
    setValidMoves([]);
  };

  return (
    <div className="janggi-board">
      <div className="info-panel" style={{ textAlign: 'center', marginBottom: '10px' }}>
         Current Turn: <span style={{ color: turn === TEAM.CHO ? 'blue' : 'red', fontWeight: 'bold' }}>{turn.toUpperCase()}</span>
      </div>

      <div className="grid-container">
        {/* Render grid lines: 9 vertical lines, 10 horizontal lines */}
        {Array.from({ length: ranks - 1 }).map((_, r) => (
          <div key={`row-${r}`} className="grid-row">
            {Array.from({ length: files - 1 }).map((_, c) => (
              <div key={`cell-${r}-${c}`} className="grid-cell"></div>
            ))}
          </div>
        ))}
        
        <div className="palace palace-top">
           <div className="palace-cross"></div>
        </div>
        
        <div className="palace palace-bottom">
           <div className="palace-cross"></div>
        </div>
      </div>
      
      <div className="piece-layer">
        {/* Render Interaction Overlay for Clicks */}
        {/* We need clickable areas for every intersection (9x10) */}
        {Array.from({ length: ranks }).map((_, r) => (
            Array.from({ length: files }).map((_, c) => {
                const isSelected = selectedPos && selectedPos.r === r && selectedPos.c === c;
                const isValid = validMoves.some(m => m.r === r && m.c === c);
                const piece = board[r][c];
                
                // Position calculation (percentage based)
                // If viewing as Han, flip the board (180 degrees)
                const renderR = viewTeam === TEAM.HAN ? (ranks - 1) - r : r;
                const renderC = viewTeam === TEAM.HAN ? (files - 1) - c : c;

                const left = (renderC / (files - 1)) * 100;
                const top = (renderR / (ranks - 1)) * 100;

                // Rotation calculation
                const isOpponent = piece && (piece.team !== viewTeam);
                
                // Opponent rotation: if useRotatedPieces, rotate opponent 180
                // Since we flipped the board coordinates, pieces are drawn upright by default.
                // We only rotate if the user wants "Rotated Pieces" for the opponent.
                let rotation = 0;
                if (useRotatedPieces && isOpponent) rotation = 180;
                
                return (
                    <div 
                        key={`cell-interaction-${r}-${c}`}
                        style={{ 
                            left: `${left}%`,
                            top: `${top}%`,
                            zIndex: 10,
                        }}
                        className={`interaction-cell ${isSelected ? 'selected' : ''} ${isValid ? 'valid' : ''}`}
                        onClick={() => handleCellClick(r, c)}
                    >
                        {/* Render marking for valid move */}
                        {isValid && <div className="move-marker" />}
                        
                        {/* Render Piece if present */}
                        {piece && (
                             <div style={{ 
                                 width: '100%', height: '100%', 
                                 display: 'flex', justifyContent: 'center', alignItems: 'center',
                                 transform: `rotate(${rotation}deg)`,
                                 transition: 'transform 0.3s ease'
                             }}>
                                <Piece 
                                    team={piece.team} 
                                    type={piece.type}
                                    variant={null}
                                    styleVariant={styleVariant}
                                    inverted={invertColor}
                                    rotated={false} 
                                />
                             </div>
                        )}
                    </div>
                );
            })
        ))}
      </div>
    </div>
  );
};

export default Board;
