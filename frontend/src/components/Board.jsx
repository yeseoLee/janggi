import { useState, useEffect } from 'react';
import Piece from './Piece';
import { TEAM, PIECE_TYPE, SETUP_TYPES, generateBoard } from '../game/constants';
import { getValidMoves, getSafeMoves, isCheck, isCheckmate, calculateScore } from '../game/rules';
import './Board.css';

const Board = ({ 
    viewTeam, setViewTeam, 
    invertColor, setInvertColor, 
    useRotatedPieces, setUseRotatedPieces, 
    styleVariant, setStyleVariant 
}) => {
  const files = 9;
  const ranks = 10;
  
  // Game States
  const [gameState, setGameState] = useState('SETUP_HAN'); // SETUP_HAN -> SETUP_CHO -> PLAYING
  const [hanSetup, setHanSetup] = useState(null);
  const [choSetup, setChoSetup] = useState(null);

  const [board, setBoard] = useState(Array(10).fill(Array(9).fill(null))); // Start empty
  const [turn, setTurn] = useState(TEAM.CHO); // Cho usually moves first
  const [selectedPos, setSelectedPos] = useState(null);
  const [validMoves, setValidMoves] = useState([]);
  
  // New States
  const [history, setHistory] = useState([]); // Array of { board, turn }
  const [winner, setWinner] = useState(null);
  const [checkAlert, setCheckAlert] = useState(null); // 'CHO' or 'HAN' is in check
  const [scores, setScores] = useState({ cho: 72, han: 73.5 }); // Initial approximate scores

  // Start game when both setups are ready
  const startGame = (hSetup, cSetup) => {
      const initialBoard = generateBoard(cSetup, hSetup);
      setBoard(initialBoard);
      setGameState('PLAYING');
      setTurn(TEAM.CHO);
      setScores(calculateScore(initialBoard)); // Recalculate
  };

  const handleSetupSelect = (type) => {
      if (gameState === 'SETUP_HAN') {
          setHanSetup(type);
          setGameState('SETUP_CHO');
      } else if (gameState === 'SETUP_CHO') {
          setChoSetup(type);
          startGame(hanSetup, type);
      }
  };

  // Check for "Janggun" (Check) on mount/update
  useEffect(() => {
    if (gameState !== 'PLAYING') return;

    // Update Score
    setScores(calculateScore(board));

    if (isCheck(board, turn)) {
        setCheckAlert(turn); 
        if (isCheckmate(board, turn)) {
            setWinner(turn === TEAM.CHO ? TEAM.HAN : TEAM.CHO);
        }
    } else {
        setCheckAlert(null);
    }
  }, [board, turn, gameState]);

  // Handle cell click (logic for selection and movement)
  const handleCellClick = (r, c) => {
    if (gameState !== 'PLAYING' || winner) return;

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
      // Use getSafeMoves to enforce Check rules
      const moves = getSafeMoves(board, r, c);
      setValidMoves(moves);
    } else {
      // Deselect if clicking empty or enemy piece (without move intent)
      setSelectedPos(null);
      setValidMoves([]);
    }
  };

  const movePiece = (from, to) => {
    // Save to history before modifying
    setHistory([...history, { board: board.map(row => [...row]), turn }]);

    const newBoard = board.map(row => [...row]);
    const piece = newBoard[from.r][from.c];
    
    // Capture logic is implicit (overwrite)
    newBoard[to.r][to.c] = piece;
    newBoard[from.r][from.c] = null;
    
    const nextTurn = turn === TEAM.CHO ? TEAM.HAN : TEAM.CHO;
    
    setBoard(newBoard);
    setTurn(nextTurn);
    setSelectedPos(null);
    setValidMoves([]);
    
    // Check detection moved to useEffect to ensure it runs on board update
  };

  // Game Controls
  const handleReset = () => {
      setGameState('SETUP_HAN');
      setHanSetup(null);
      setChoSetup(null);
      setBoard(Array(10).fill(Array(9).fill(null)));
      setTurn(TEAM.CHO);
      setHistory([]);
      setWinner(null);
      setCheckAlert(null);
      setSelectedPos(null);
      setValidMoves([]);
  };

  const handleUndo = () => {
      if (history.length === 0) return;
      const lastState = history[history.length - 1];
      setBoard(lastState.board);
      setTurn(lastState.turn);
      setHistory(history.slice(0, -1));
      setWinner(null);
      setSelectedPos(null);
      setValidMoves([]);
  };

  const handlePass = () => {
      if (winner) return;
      if (checkAlert === turn) {
          alert("Janggun! You cannot pass while in check.");
          return;
      }
      
      setHistory([...history, { board: board.map(row => [...row]), turn }]);
      setTurn(turn === TEAM.CHO ? TEAM.HAN : TEAM.CHO);
      setSelectedPos(null);
      setValidMoves([]);
  };

  return (
        <div className="janggi-board">
          {/* Winner Overlay */}
          {winner && (
              <div className="overlay winner-overlay">
                  <div>Game Over</div>
                  <div style={{ color: winner === TEAM.CHO ? 'blue' : 'red' }}>{winner.toUpperCase()} WINS!</div>
                  <button onClick={handleReset}>Play Again</button>
              </div>
          )}

          {/* Setup Overlay */}
          {(gameState === 'SETUP_HAN' || gameState === 'SETUP_CHO') && (
               <div className="overlay setup-overlay">
                   <h2>{gameState === 'SETUP_HAN' ? "Han (Red)" : "Cho (Blue)"} Setup</h2>
                   <div className="setup-options">
                       {Object.entries(SETUP_TYPES).map(([key, label]) => {
                           const setupTeam = gameState === 'SETUP_HAN' ? TEAM.HAN : TEAM.CHO;
                           const pieces = [];
                           for (const char of key) {
                               if (char === 'M') pieces.push(PIECE_TYPE.HORSE);
                               else if (char === 'S') pieces.push(PIECE_TYPE.ELEPHANT);
                           }
                           
                           return (
                               <button key={key} onClick={() => handleSetupSelect(label)} className="setup-btn">
                                   <div className="setup-label">{label}</div>
                                   <div className="setup-preview">
                                       {pieces.map((pType, idx) => (
                                           <div key={idx} className="setup-piece">
                                               <Piece 
                                                   team={setupTeam} 
                                                   type={pType} 
                                                   styleVariant={styleVariant} 
                                                   inverted={invertColor} 
                                               />
                                           </div>
                                       ))}
                                   </div>
                               </button>
                           );
                       })}
                   </div>
               </div>
          )}
          
          {/* Check Notification */}
          {checkAlert && !winner && (gameState === 'PLAYING') && (
              <div className="check-alert">
                  JANGGUN! ({checkAlert.toUpperCase()})
              </div>
          )}

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

        {/* Score Display */}
        <div className="score-board">
            <div className="score-item cho">
                <span className="team-name">Cho (Blue)</span>: {scores.cho}
            </div>
            <div className="score-item han">
                <span className="team-name">Han (Red)</span>: {scores.han}
            </div>
        </div>
    </div>
  );
};

export default Board;
