import { useState, useEffect, useRef } from 'react';
import { io } from 'socket.io-client';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import Piece from './Piece';
import { TEAM, PIECE_TYPE, SETUP_TYPES, generateBoard } from '../game/constants';
import { getValidMoves, getSafeMoves, isCheck, isCheckmate, calculateScore } from '../game/rules';
import './Board.css';

const socket = io('/', { autoConnect: false }); // Connect manually

const Board = ({ 
    gameMode, // 'ai', 'online', 'replay'
    replayHistory, // for replay mode
    viewTeam, setViewTeam, 
    invertColor, setInvertColor, 
    useRotatedPieces, setUseRotatedPieces, 
    styleVariant, setStyleVariant 
}) => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const files = 9;
  const ranks = 10;
  
  // Game States
  // IDLE -> MATCHING -> (Online) SETUP_HAN / WAITING_HAN -> SETUP_CHO / WAITING_CHO -> PLAYING
  const [gameState, setGameState] = useState('IDLE'); 
  const [hanSetup, setHanSetup] = useState(null);
  const [choSetup, setChoSetup] = useState(null);

  const [board, setBoard] = useState(Array(10).fill(Array(9).fill(null)));
  const [turn, setTurn] = useState(TEAM.CHO);
  const [selectedPos, setSelectedPos] = useState(null);
  const [validMoves, setValidMoves] = useState([]);
  
  // Online Specific
  const [room, setRoom] = useState(null);
  const [myTeam, setMyTeam] = useState(null); 
  const myTeamRef = useRef(null); // Ref to access current team in socket listeners
  const [opponentInfo, setOpponentInfo] = useState(null);

  // States
  const [history, setHistory] = useState([]); 
  const [winner, setWinner] = useState(null);
  const [checkAlert, setCheckAlert] = useState(null); 
  const [scores, setScores] = useState({ cho: 72, han: 73.5 }); 

  // Replay State
  const [replayStep, setReplayStep] = useState(0); 

  // Initialize Game Logic & Replay
  useEffect(() => {
    if (gameMode === 'replay' && replayHistory && replayHistory.length > 0) {
        setGameState('PLAYING');
        // Load first step
        setBoard(replayHistory[0].board);
        setTurn(replayHistory[0].turn);
        setReplayStep(0);
        return;
    }

    if (gameMode === 'online') {
        if (!socket.connected) socket.connect();
        setGameState('MATCHING');
        
        // Request Match
        if (user) {
            socket.emit('find_match', user);
        } else {
            console.error("User not authenticated in Board");
        }

        socket.on('match_found', (data) => {
            // data: { room, team, opponent }
            setRoom(data.room);
            setMyTeam(data.team); 
            myTeamRef.current = data.team; // Update ref
            setOpponentInfo(data.opponent);
            
            // Determine Initial Local State for Setup Phase
            // Han goes first
            if (data.team === TEAM.HAN) {
                setGameState('SETUP_HAN'); // I select
                setViewTeam(TEAM.HAN);
            } else {
                setGameState('WAITING_HAN'); // I wait
                setViewTeam(TEAM.CHO);
            }
        });

        // Setup Sync
        socket.on('opponent_setup', (data) => {
             // data: { team, setupType }
             if (data.team === 'han') {
                 setHanSetup(data.setupType);
                 // Using ref to get the current assigned team without re-binding listeners
                 if (myTeamRef.current === TEAM.CHO) {
                     setGameState('SETUP_CHO'); // My turn to setup
                 } else {
                     setGameState('WAITING_CHO'); // I am Han, now waiting for Cho
                 }
             } else if (data.team === 'cho') {
                 setChoSetup(data.setupType);
             }
        });

        socket.on('move', (moveData) => {
             applyMove(moveData.from, moveData.to, false); 
        });

        socket.on('pass_turn', () => {
             alert(`Opponent Passed.`);
             setHistory(prev => [...prev, { board: board.map(row => [...row]), turn }]);
             setTurn(t => t === TEAM.CHO ? TEAM.HAN : TEAM.CHO);
        });

        socket.on('game_over', (data) => {
             setWinner(data.winner);
             alert(data.type === 'resign' ? 'Opponent Resigned!' : 'Checkmate!');
        });

        return () => {
            socket.off('match_found');
            socket.off('opponent_setup');
            socket.off('move');
            socket.off('pass_turn');
            socket.off('game_over');
            socket.disconnect();
        };
    } else {
        // AI / Local Mode
        setGameState('SETUP_HAN');
        setMyTeam(null); // Control both
    }
  }, [gameMode]);

  // Trigger Game Start when setups are ready (Online)
  useEffect(() => {
      if (gameMode === 'online' && hanSetup && choSetup && gameState !== 'PLAYING') {
          startGame(hanSetup, choSetup);
      }
  }, [hanSetup, choSetup, gameMode, gameState]);


  const handleSetupSelect = (type) => {
      if (gameMode === 'online') {
          if (gameState === 'SETUP_HAN') {
              // I am Han
              setHanSetup(type);
              socket.emit('submit_setup', { room, team: 'han', setupType: type });
              setGameState('WAITING_CHO'); // Wait for Cho
          } else if (gameState === 'SETUP_CHO') {
              // I am Cho
              setChoSetup(type);
              socket.emit('submit_setup', { room, team: 'cho', setupType: type });
              // Start Game happens via Effect
          }
          return;
      }

      // Local Logic
      if (gameState === 'SETUP_HAN') {
          setHanSetup(type);
          setGameState('SETUP_CHO');
      } else if (gameState === 'SETUP_CHO') {
          setChoSetup(type);
          startGame(hanSetup, type);
      }
  };

  const startGame = (hSetup, cSetup) => {
      const initialBoard = generateBoard(cSetup, hSetup);
      setBoard(initialBoard);
      setGameState('PLAYING');
      setTurn(TEAM.CHO);
      setScores(calculateScore(initialBoard)); 
  };
    // ... useEffect for Check ...
  useEffect(() => {
    if (gameState !== 'PLAYING') return;

    setScores(calculateScore(board));

    if (isCheck(board, turn)) {
        setCheckAlert(turn); 
        if (isCheckmate(board, turn)) {
            const winnerTeam = turn === TEAM.CHO ? TEAM.HAN : TEAM.CHO;
            setWinner(winnerTeam);
            
            if (gameMode === 'online' && myTeam && turn === myTeam) {
                 socket.emit('checkmate', { room, winner: winnerTeam, history });
            }
        }
    } else {
        setCheckAlert(null);
    }
  }, [board, turn, gameState]);

  // Handle cell click
  const handleCellClick = (r, c) => {
    if (gameState !== 'PLAYING' || winner) return;
    
    if (gameMode === 'online' && myTeam && turn !== myTeam) return;

    if (selectedPos) {
      const isMove = validMoves.some(m => m.r === r && m.c === c);
      if (isMove) {
        if (gameMode === 'online') {
            socket.emit('move', { room, move: { from: selectedPos, to: { r, c } } });
        }
        applyMove(selectedPos, { r, c }, true);
        return;
      }
    }

    const piece = board[r][c];
    if (piece && piece.team === turn) {
        if (gameMode === 'online' && myTeam && piece.team !== myTeam) return;

      setSelectedPos({ r, c });
      const moves = getSafeMoves(board, r, c);
      setValidMoves(moves);
    } else {
      setSelectedPos(null);
      setValidMoves([]);
    }
  };

  const applyMove = (from, to, isLocal) => {
    setHistory(prev => [...prev, { board: board.map(row => [...row]), turn }]);
    setBoard(prevBoard => {
        const newBoard = prevBoard.map(row => [...row]);
        const piece = newBoard[from.r][from.c];
        newBoard[to.r][to.c] = piece;
        newBoard[from.r][from.c] = null;
        return newBoard;
    });
    setTurn(prev => prev === TEAM.CHO ? TEAM.HAN : TEAM.CHO);
    setSelectedPos(null);
    setValidMoves([]);
  };

  const handleReset = () => {
      if (gameMode !== 'online') {
          setBoard(generateBoard(choSetup || 'MASANG', hanSetup || 'MASANG'));
          setTurn(TEAM.CHO);
          setHistory([]);
          setWinner(null);
          setSelectedPos(null);
          setValidMoves([]);
          setScores({ cho: 72, han: 73.5 });
      }
  };

  const handleUndo = () => {
      // ... (keep handling undo)
      if (gameMode === 'online') return;
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
       // Check if passing is allowed (e.g. valid moves exist? optional rule)
       // For now allow pass
       setHistory(prev => [...prev, { board: board.map(row => [...row]), turn }]);
       setTurn(turn === TEAM.CHO ? TEAM.HAN : TEAM.CHO);
       setSelectedPos(null);
       setValidMoves([]);
  };

  const handleOnlinePass = () => {
      if (turn !== myTeam) return;
      if (checkAlert === turn) { alert("Cannot pass in check!"); return; }
      socket.emit('pass', { room, team: myTeam });
      setHistory(prev => [...prev, { board: board.map(row => [...row]), turn }]);
      setTurn(t => t === TEAM.CHO ? TEAM.HAN : TEAM.CHO);
  };
  
  const handleResign = () => {
      if (confirm("Are you sure you want to resign?")) {
          if (gameMode === 'online') {
              socket.emit('resign', { room, team: myTeam, history });
          } else {
              setWinner(turn === TEAM.CHO ? TEAM.HAN : TEAM.CHO);
          }
      }
  };


  // Replay Controls
  const handleReplayPrev = () => {
      if (replayStep > 0) {
          const newStep = replayStep - 1;
          setReplayStep(newStep);
          setBoard(replayHistory[newStep].board);
          setTurn(replayHistory[newStep].turn);
      }
  };

  const handleReplayNext = () => {
      if (replayHistory && replayStep < replayHistory.length - 1) {
          const newStep = replayStep + 1;
          setReplayStep(newStep);
          setBoard(replayHistory[newStep].board);
          setTurn(replayHistory[newStep].turn);
      }
  };

  return (
    <div className="janggi-game-container">
        {/* MATCHING OVERLAY */}
        {gameState === 'MATCHING' && (
            <div className="overlay matching-overlay">
                <div className="spinner"></div>
                <h2>Matching...</h2>
                <p>Waiting for an opponent</p>
            </div>
        )}
        
        {/* WAITING OVERLAY (SETUP) */}
        {(gameState === 'WAITING_HAN' || gameState === 'WAITING_CHO') && (
            <div className="overlay waiting-overlay" style={{ background: 'rgba(0,0,0,0.85)', zIndex: 50 }}>
                <h2>{gameState === 'WAITING_HAN' ? "Opponent (Han) is setting up..." : "Opponent (Cho) is setting up..."}</h2>
                <div className="spinner"></div>
            </div>
        )}

        <div className="janggi-board-area">
            <div className="janggi-board">
              {/* Winner Overlay */}
              {winner && (
                  <div className="overlay winner-overlay">
                      <div>Game Over</div>
                      <div style={{ color: winner === TEAM.CHO ? 'blue' : 'red' }}>{winner.toUpperCase()} WINS!</div>
                      {gameMode !== 'online' && gameMode !== 'replay' && <button onClick={() => window.location.reload()}>Play Again</button>}
                      <button onClick={() => navigate('/')}>Exit to Menu</button>
                  </div>
              )}

              {/* Setup Overlay */}
              {(gameState === 'SETUP_HAN' || gameState === 'SETUP_CHO') && (
                   <div className="overlay setup-overlay">
                       <h2>{gameState === 'SETUP_HAN' ? "Han (Red) Setup - You" : "Cho (Blue) Setup - You"}</h2>
                       
                       {/* Display Opponent's Choice if available */}
                       {gameState === 'SETUP_CHO' && hanSetup && (
                           <div className="opponent-setup-display" style={{ marginBottom: '10px', color: '#f25050' }}>
                               Opponent (Han) selected: <strong>{hanSetup}</strong>
                           </div>
                       )}

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
                {/* Render grid lines */}
                {Array.from({ length: 10 - 1 }).map((_, r) => (
                  <div key={`row-${r}`} className="grid-row">
                    {Array.from({ length: 9 - 1 }).map((_, c) => (
                      <div key={`cell-${r}-${c}`} className="grid-cell"></div>
                    ))}
                  </div>
                ))}
                
                <div className="palace palace-top"><div className="palace-cross"></div></div>
                <div className="palace palace-bottom"><div className="palace-cross"></div></div>
              </div>
              
              <div className="piece-layer">
                {/* Render Interaction Overlay */}
                {Array.from({ length: 10 }).map((_, r) => (
                    Array.from({ length: 9 }).map((_, c) => {
                        const isSelected = selectedPos && selectedPos.r === r && selectedPos.c === c;
                        const isValid = validMoves.some(m => m.r === r && m.c === c);
                        const piece = board[r][c];
                        
                        const renderR = viewTeam === TEAM.HAN ? (10 - 1) - r : r;
                        const renderC = viewTeam === TEAM.HAN ? (9 - 1) - c : c;

                        const left = (renderC / (9 - 1)) * 100;
                        const top = (renderR / (10 - 1)) * 100;

                        const isOpponent = piece && (piece.team !== viewTeam);
                        let rotation = 0;
                        if (useRotatedPieces && isOpponent) rotation = 180;
                        
                        return (
                            <div 
                                key={`cell-interaction-${r}-${c}`}
                                style={{ left: `${left}%`, top: `${top}%`, zIndex: 10 }}
                                className={`interaction-cell ${isSelected ? 'selected' : ''} ${isValid ? 'valid' : ''}`}
                                onClick={() => handleCellClick(r, c)}
                            >
                                {isValid && <div className="move-marker" />}
                                {piece && (
                                     <div style={{ width: '100%', height: '100%', display: 'flex', justifyContent: 'center', alignItems: 'center', transform: `rotate(${rotation}deg)`, transition: 'transform 0.3s ease' }}>
                                        <Piece team={piece.team} type={piece.type} styleVariant={styleVariant} inverted={invertColor} />
                                     </div>
                                )}
                            </div>
                        );
                    })
                ))}
              </div>
            </div>
        </div>

        <div className="janggi-sidebar">
            <button className="home-btn" onClick={() => navigate('/')}>🏠 Home</button>

            <div className="score-board">
                <div className="score-item cho">Cho: {scores.cho}</div>
                <div className="score-item han">Han: {scores.han}</div>
            </div>

            <div className="game-status-bar">
                 <div className="turn-indicator">
                     Turn: <span style={{ color: turn === TEAM.CHO ? 'blue' : 'red' }}>{turn.toUpperCase()}</span>
                 </div>
                 
                 <div className="game-controls">
                     {gameMode === 'replay' ? (
                         <>
                            <button onClick={handleReplayPrev} disabled={replayStep === 0}>Prev</button>
                            <span style={{color:'white'}}>Step: {replayStep + 1} / {replayHistory?.length}</span>
                            <button onClick={handleReplayNext} disabled={!replayHistory || replayStep === replayHistory.length - 1}>Next</button>
                         </>
                     ) : gameMode === 'online' ? (
                         <>
                            <button onClick={handleOnlinePass} disabled={turn !== myTeam}>Pass</button>
                            <button onClick={handleResign} className="resign-btn">Resign</button>
                         </>
                     ) : (
                         <>
                            <button onClick={handleReset}>Reset</button>
                            <button onClick={handleUndo}>Undo</button>
                            <button onClick={handlePass}>Pass</button>
                         </>
                     )}
                 </div>
            </div>
            
            <div className="settings-controls">
                <div className="control-row">
                   <select value={viewTeam} onChange={(e) => setViewTeam(e.target.value)}>
                      <option value={TEAM.CHO}>View: Cho</option>
                      <option value={TEAM.HAN}>View: Han</option>
                    </select>
                </div>
                <div className="control-row">
                    <label style={{color:'white'}}><input type="checkbox" checked={invertColor} onChange={(e) => setInvertColor(e.target.checked)} /> Invert Piece Color</label>
                </div>
                <div className="control-row">
                    <label style={{color:'white'}}><input type="checkbox" checked={useRotatedPieces} onChange={(e) => setUseRotatedPieces(e.target.checked)} /> Rotate Opponent Pieces</label>
                </div>
            </div>
        </div>
    </div>
  );
};

export default Board;
