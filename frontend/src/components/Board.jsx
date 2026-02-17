import { useState, useEffect, useRef } from 'react';
import { io } from 'socket.io-client';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import Piece from './Piece';
import { TEAM, PIECE_TYPE, SETUP_TYPES, generateBoard } from '../game/constants';
import { getValidMoves, getSafeMoves, isCheck, isCheckmate, calculateScore } from '../game/rules';
import './Board.css';

const socket = io('/', { autoConnect: false }); // Connect manually
const createEmptyBoard = () => Array.from({ length: 10 }, () => Array(9).fill(null));
const AI_THINK_DELAY_MS = 220;
const AI_MOVE_TIME_MS = 700;
const getOpposingTeam = (team) => (team === TEAM.CHO ? TEAM.HAN : TEAM.CHO);

const cloneBoardState = (boardState) =>
  boardState.map((row) => row.map((piece) => (piece ? { ...piece } : null)));

const pickFallbackAiMove = (boardState, team) => {
  for (let r = 0; r < 10; r += 1) {
    for (let c = 0; c < 9; c += 1) {
      const piece = boardState[r][c];
      if (!piece || piece.team !== team) continue;
      const safeMoves = getSafeMoves(boardState, r, c);
      if (safeMoves.length === 0) continue;
      return {
        from: { r, c },
        to: safeMoves[Math.floor(Math.random() * safeMoves.length)],
      };
    }
  }
  return null;
};

const Board = ({ 
    gameMode, // 'ai', 'online', 'replay'
    replayHistory, // for replay mode
    viewTeam, setViewTeam, 
    invertColor, setInvertColor, 
    useRotatedPieces, setUseRotatedPieces, 
    styleVariant, setStyleVariant 
}) => {
  const { user } = useAuth();
  const { t } = useLanguage();
  const navigate = useNavigate();
  const tRef = useRef(t);
  useEffect(() => {
    tRef.current = t;
  }, [t]);
  const files = 9;
  const ranks = 10;
  
  // Game States
  // IDLE -> MATCHING -> (AI) SELECT_SIDE -> SETUP_HAN/SETUP_CHO -> SETUP_HAN/SETUP_CHO -> PLAYING
  // IDLE -> MATCHING -> (Online) SETUP_HAN / WAITING_HAN -> SETUP_CHO / WAITING_CHO -> PLAYING
  const [gameState, setGameState] = useState('IDLE'); 
  const [hanSetup, setHanSetup] = useState(null);
  const [choSetup, setChoSetup] = useState(null);

  const [board, setBoard] = useState(createEmptyBoard);
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
  const [aiThinking, setAiThinking] = useState(false);
  const aiThinkingRef = useRef(false);
  const aiEngineTeam = myTeam ? getOpposingTeam(myTeam) : null;

  // Replay State
  const [replayStep, setReplayStep] = useState(0); 

  // Initialize Replay Board (re-run when replay payload changes)
  useEffect(() => {
    if (gameMode !== 'replay') return;

    if (replayHistory && replayHistory.length > 0) {
      const firstFrame = replayHistory[0];
      setGameState('PLAYING');
      setBoard(firstFrame.board);
      setTurn(firstFrame.turn);
      setReplayStep(0);
      setSelectedPos(null);
      setValidMoves([]);
      setHistory([]);
      setWinner(null);
      setCheckAlert(null);
      setScores(calculateScore(firstFrame.board));
      setAiThinking(false);
      aiThinkingRef.current = false;
    } else {
      setGameState('IDLE');
      setBoard(createEmptyBoard());
      setReplayStep(0);
      setSelectedPos(null);
      setValidMoves([]);
      setHistory([]);
      setWinner(null);
      setCheckAlert(null);
      setScores({ cho: 72, han: 73.5 });
      setAiThinking(false);
      aiThinkingRef.current = false;
    }
  }, [gameMode, replayHistory]);

  // Initialize Game Logic
  useEffect(() => {
    if (gameMode === 'replay') return;

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
             alert(tRef.current('board.alerts.opponentPassed'));
             setHistory(prev => [...prev, { board: cloneBoardState(board), turn }]);
             setTurn(t => t === TEAM.CHO ? TEAM.HAN : TEAM.CHO);
        });

        socket.on('game_over', (data) => {
             setWinner(data.winner);
             if (data.type === 'resign') {
               const myTeamCurrent = myTeamRef.current;
               const opponentResigned =
                 myTeamCurrent &&
                 ((data.resignedTeam && data.resignedTeam !== myTeamCurrent) ||
                   (!data.resignedTeam && data.winner === myTeamCurrent));
               if (opponentResigned) {
                 alert(tRef.current('board.alerts.opponentResigned'));
               }
               return;
             }

             const messageKey = data.type === 'disconnect'
               ? 'board.alerts.disconnect'
               : 'board.alerts.checkmate';
             alert(tRef.current(messageKey));
        });

        return () => {
            socket.off('match_found');
            socket.off('opponent_setup');
            socket.off('move');
            socket.off('pass_turn');
            socket.off('game_over');
            socket.disconnect();
        };
    } else if (gameMode === 'ai') {
        setRoom(null);
        setOpponentInfo(null);
        setMyTeam(null);
        myTeamRef.current = null;
        setHanSetup(null);
        setChoSetup(null);
        setBoard(createEmptyBoard());
        setTurn(TEAM.CHO);
        setHistory([]);
        setWinner(null);
        setSelectedPos(null);
        setValidMoves([]);
        setScores({ cho: 72, han: 73.5 });
        setAiThinking(false);
        aiThinkingRef.current = false;
        setGameState('SELECT_SIDE');
        setViewTeam?.(TEAM.CHO);
    } else {
        // Local mode fallback (manual two-side play)
        setGameState('SETUP_HAN');
        setMyTeam(null);
    }
  }, [gameMode]);

  // Trigger Game Start when setups are ready (Online)
  useEffect(() => {
      if (gameMode === 'online' && hanSetup && choSetup && gameState !== 'PLAYING') {
          startGame(hanSetup, choSetup);
      }
  }, [hanSetup, choSetup, gameMode, gameState]);

  const handleAiSideSelect = (team) => {
      if (gameMode !== 'ai' || gameState !== 'SELECT_SIDE') return;
      if (team !== TEAM.CHO && team !== TEAM.HAN) return;

      setMyTeam(team);
      myTeamRef.current = team;
      setViewTeam?.(team);
      setHanSetup(null);
      setChoSetup(null);
      setGameState(team === TEAM.HAN ? 'SETUP_HAN' : 'SETUP_CHO');
  };


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

      if (gameMode === 'ai') {
          const nextHanSetup = gameState === 'SETUP_HAN' ? type : hanSetup;
          const nextChoSetup = gameState === 'SETUP_CHO' ? type : choSetup;

          if (gameState === 'SETUP_HAN') setHanSetup(type);
          if (gameState === 'SETUP_CHO') setChoSetup(type);

          if (!nextHanSetup || !nextChoSetup) {
              setGameState(nextHanSetup ? 'SETUP_CHO' : 'SETUP_HAN');
              return;
          }

          startGame(nextHanSetup, nextChoSetup);
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
      setHistory([]);
      setWinner(null);
      setSelectedPos(null);
      setValidMoves([]);
      setCheckAlert(null);
      setScores(calculateScore(initialBoard));
      setAiThinking(false);
      aiThinkingRef.current = false;
  };

  useEffect(() => {
    if (gameMode !== 'ai') return;
    if (gameState !== 'PLAYING' || winner) return;
    if (!myTeam || !aiEngineTeam) return;
    if (turn !== aiEngineTeam) return;
    if (isCheck(board, turn) && isCheckmate(board, turn)) return;
    if (aiThinkingRef.current) return;

    let cancelled = false;

    const requestAiMove = async () => {
      aiThinkingRef.current = true;
      setAiThinking(true);

      try {
        const response = await axios.post('/api/ai/move', {
          board,
          turn,
          movetime: AI_MOVE_TIME_MS,
        });
        if (cancelled) return;

        if (response.data?.pass) {
          setHistory((prev) => [...prev, { board: cloneBoardState(board), turn }]);
          setTurn((prev) => (prev === TEAM.CHO ? TEAM.HAN : TEAM.CHO));
          setSelectedPos(null);
          setValidMoves([]);
          return;
        }

        const aiMove = response.data?.move;
        const movingPiece = board[aiMove?.from?.r]?.[aiMove?.from?.c];
        const legalTargets = movingPiece ? getSafeMoves(board, aiMove.from.r, aiMove.from.c) : [];
        const isLegal = legalTargets.some((move) => move.r === aiMove?.to?.r && move.c === aiMove?.to?.c);

        if (!movingPiece || movingPiece.team !== aiEngineTeam || !isLegal) {
          throw new Error('AI returned an invalid move.');
        }

        applyMove(aiMove.from, aiMove.to, false);
      } catch (err) {
        console.error('AI move failed. Falling back to local move picker.', err);
        if (cancelled) return;

        const fallback = pickFallbackAiMove(board, aiEngineTeam);
        if (fallback) {
          applyMove(fallback.from, fallback.to, false);
          return;
        }

        if (isCheck(board, aiEngineTeam)) {
          setWinner(myTeam);
        }
      } finally {
        aiThinkingRef.current = false;
        if (!cancelled) setAiThinking(false);
      }
    };

    const timer = setTimeout(() => {
      requestAiMove();
    }, AI_THINK_DELAY_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      aiThinkingRef.current = false;
      setAiThinking(false);
    };
  }, [aiEngineTeam, board, gameMode, gameState, myTeam, turn, winner]);

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
    if (gameMode === 'replay') return;
    if (gameState !== 'PLAYING' || winner) return;
    
    if (gameMode === 'online' && myTeam && turn !== myTeam) return;
    if (gameMode === 'ai' && (!myTeam || turn !== myTeam)) return;

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
        if (gameMode === 'ai' && (!myTeam || piece.team !== myTeam)) return;

      setSelectedPos({ r, c });
      const moves = getSafeMoves(board, r, c);
      setValidMoves(moves);
    } else {
      setSelectedPos(null);
      setValidMoves([]);
    }
  };

  const applyMove = (from, to, isLocal) => {
    setHistory(prev => [...prev, { board: cloneBoardState(board), turn }]);
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
          setBoard(generateBoard(choSetup || SETUP_TYPES.MSMS, hanSetup || SETUP_TYPES.MSMS));
          setTurn(TEAM.CHO);
          setHistory([]);
          setWinner(null);
          setSelectedPos(null);
          setValidMoves([]);
          setCheckAlert(null);
          setScores({ cho: 72, han: 73.5 });
          setAiThinking(false);
          aiThinkingRef.current = false;
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
      setCheckAlert(null);
      setAiThinking(false);
      aiThinkingRef.current = false;
  };

  const handlePass = () => {
       if (winner) return;
       if (gameMode === 'ai' && (!myTeam || turn !== myTeam)) return;
       // Check if passing is allowed (e.g. valid moves exist? optional rule)
       // For now allow pass
       setHistory(prev => [...prev, { board: cloneBoardState(board), turn }]);
       setTurn(turn === TEAM.CHO ? TEAM.HAN : TEAM.CHO);
       setSelectedPos(null);
       setValidMoves([]);
  };

  const handleOnlinePass = () => {
      if (turn !== myTeam) return;
      if (checkAlert === turn) { alert(t('board.alerts.cannotPassInCheck')); return; }
      socket.emit('pass', { room, team: myTeam });
      setHistory(prev => [...prev, { board: cloneBoardState(board), turn }]);
      setTurn(t => t === TEAM.CHO ? TEAM.HAN : TEAM.CHO);
  };
  
  const handleResign = () => {
      if (confirm(t('board.alerts.confirmResign'))) {
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

  const modeLabel = gameMode === 'online' ? t('board.mode.online') : gameMode === 'replay' ? t('board.mode.replay') : t('board.mode.ai');
  const displayMoveCount = gameMode === 'replay' ? Math.max((replayHistory?.length || 1) - 1, 0) : history.length;
  const CAPTURE_DISPLAY_ORDER = [
    PIECE_TYPE.CHARIOT,
    PIECE_TYPE.CANNON,
    PIECE_TYPE.HORSE,
    PIECE_TYPE.ELEPHANT,
    PIECE_TYPE.GUARD,
    PIECE_TYPE.SOLDIER,
    PIECE_TYPE.GENERAL,
  ];
  const BASE_TEAM_PIECE_COUNTS = {
    [PIECE_TYPE.CHARIOT]: 2,
    [PIECE_TYPE.CANNON]: 2,
    [PIECE_TYPE.HORSE]: 2,
    [PIECE_TYPE.ELEPHANT]: 2,
    [PIECE_TYPE.GUARD]: 2,
    [PIECE_TYPE.SOLDIER]: 5,
    [PIECE_TYPE.GENERAL]: 1,
  };
  const getSetupPieces = (setupTypeOrLabel) => {
    if (!setupTypeOrLabel) return [];
    const setupKey = Object.prototype.hasOwnProperty.call(SETUP_TYPES, setupTypeOrLabel)
      ? setupTypeOrLabel
      : Object.entries(SETUP_TYPES).find(([, value]) => value === setupTypeOrLabel)?.[0];
    if (!setupKey) return [];
    return [...setupKey]
      .map((char) => {
        if (char === 'M') return PIECE_TYPE.HORSE;
        if (char === 'S') return PIECE_TYPE.ELEPHANT;
        return null;
      })
      .filter(Boolean);
  };
  const getCapturedPieceList = (team) => {
    if (gameState !== 'PLAYING') return [];

    const aliveCounts = {};
    for (const row of board) {
      for (const piece of row) {
        if (!piece || piece.team !== team) continue;
        aliveCounts[piece.type] = (aliveCounts[piece.type] || 0) + 1;
      }
    }

    const captured = [];
    for (const type of CAPTURE_DISPLAY_ORDER) {
      const baseCount = BASE_TEAM_PIECE_COUNTS[type] || 0;
      const aliveCount = aliveCounts[type] || 0;
      const deadCount = Math.max(baseCount - aliveCount, 0);
      for (let idx = 0; idx < deadCount; idx += 1) {
        captured.push(type);
      }
    }

    return captured;
  };
  const choDeadPieces = getCapturedPieceList(TEAM.CHO);
  const hanDeadPieces = getCapturedPieceList(TEAM.HAN);
  const setupTeam = gameState === 'SETUP_HAN' ? TEAM.HAN : TEAM.CHO;
  const opponentSetupTeam = setupTeam === TEAM.HAN ? TEAM.CHO : TEAM.HAN;
  const opponentSetupPieces = getSetupPieces(opponentSetupTeam === TEAM.HAN ? hanSetup : choSetup);
  const isAiSetupPhase = gameMode === 'ai' && gameState !== 'SELECT_SIDE';
  const isSelectingAiSetup = isAiSetupPhase && myTeam && setupTeam !== myTeam;

  return (
    <div className="janggi-game-container">
        {/* MATCHING OVERLAY */}
        {gameState === 'MATCHING' && (
            <div className="overlay matching-overlay">
                <div className="spinner"></div>
                <h2>{t('board.matchingTitle')}</h2>
                <p>{t('board.matchingSubtitle')}</p>
            </div>
        )}
        
        {/* WAITING OVERLAY (SETUP) */}
        {(gameState === 'WAITING_HAN' || gameState === 'WAITING_CHO') && (
            <div className="overlay waiting-overlay" style={{ background: 'rgba(0,0,0,0.85)', zIndex: 50 }}>
                <h2>{gameState === 'WAITING_HAN' ? t('board.waitingHan') : t('board.waitingCho')}</h2>
                <div className="spinner"></div>
            </div>
        )}

        <div className="janggi-board-area">
            <div className="match-header">
                <span className="match-title">{modeLabel}</span>
                <span className="move-count">{displayMoveCount} {t('board.movesUnit')}</span>
            </div>

            <div className="janggi-board">
              {/* Winner Overlay */}
              {winner && (
                  <div className="overlay winner-overlay">
                      <div>{t('board.gameOver')}</div>
                      <div style={{ color: winner === TEAM.CHO ? 'blue' : 'red' }}>
                        {t('board.wins', { team: t(`board.team.${winner}`) })}
                      </div>
                      {gameMode !== 'online' && gameMode !== 'replay' && <button onClick={() => window.location.reload()}>{t('board.playAgain')}</button>}
                      <button onClick={() => navigate('/')}>{t('board.exitToMenu')}</button>
                  </div>
              )}

              {/* Setup Overlay */}
              {(gameState === 'SELECT_SIDE' || gameState === 'SETUP_HAN' || gameState === 'SETUP_CHO') && (
                   <div className="overlay setup-overlay">
                       {gameState === 'SELECT_SIDE' ? (
                           <>
                               <h2>{t('board.selectSideTitle')}</h2>
                               <p>{t('board.selectSideSubtitle')}</p>
                               <div className="side-select-options">
                                   <button
                                       type="button"
                                       className="side-select-btn cho"
                                       onClick={() => handleAiSideSelect(TEAM.CHO)}
                                   >
                                       <span className="side-select-team">{t('board.team.cho')}</span>
                                       <span className="side-select-desc">{t('board.selectSideCho')}</span>
                                   </button>
                                   <button
                                       type="button"
                                       className="side-select-btn han"
                                       onClick={() => handleAiSideSelect(TEAM.HAN)}
                                   >
                                       <span className="side-select-team">{t('board.team.han')}</span>
                                       <span className="side-select-desc">{t('board.selectSideHan')}</span>
                                   </button>
                               </div>
                           </>
                       ) : (
                           <>
                               <h2>{gameState === 'SETUP_HAN' ? t('board.setupHanTitle') : t('board.setupChoTitle')}</h2>
                               {isAiSetupPhase && (
                                   <p>{isSelectingAiSetup ? t('board.setupAiSubtitle') : t('board.setupMySubtitle')}</p>
                               )}

                               {opponentSetupPieces.length > 0 && (
                                   <div className="opponent-setup-display">
                                       <div className="opponent-setup-preview">
                                           {opponentSetupPieces.map((pType, idx) => (
                                               <div key={`opponent-setup-${idx}`} className="setup-piece opponent-setup-piece">
                                                   <Piece
                                                       team={opponentSetupTeam}
                                                       type={pType}
                                                       styleVariant={styleVariant}
                                                       inverted={invertColor}
                                                   />
                                               </div>
                                           ))}
                                       </div>
                                   </div>
                               )}

                               <div className="setup-options">
                                   {Object.entries(SETUP_TYPES).map(([key, label]) => {
                                       const setupLabelKey = `board.setupTypes.${key}`;
                                       const setupLabel = t(setupLabelKey) === setupLabelKey ? label : t(setupLabelKey);
                                       const pieces = getSetupPieces(key);
                                      
                                       return (
                                           <button
                                               key={key}
                                               onClick={() => handleSetupSelect(label)}
                                               className="setup-btn"
                                               aria-label={setupLabel}
                                               title={setupLabel}
                                           >
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
                           </>
                       )}
                   </div>
              )}
              
              {/* Check Notification */}
              {checkAlert && !winner && (gameState === 'PLAYING') && (
                  <div className="check-alert">
                      {t('board.checkAlert', { team: t(`board.team.${checkAlert}`) })}
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
            <div className="sidebar-top-row">
                <button className="home-btn" onClick={() => navigate('/')}>{t('board.home')}</button>
                <span className="mode-chip">{modeLabel}</span>
            </div>

            <div className="score-board">
                <div className="score-item cho">{t('board.scoreCho', { score: scores.cho })}</div>
                <div className="score-item han">{t('board.scoreHan', { score: scores.han })}</div>
            </div>

            <div className="captured-piece-board">
                <div className="captured-row">
                    <div className="captured-label cho">{t('board.capturedCho')}</div>
                    <div className="captured-pieces">
                        {choDeadPieces.length === 0 ? (
                            <span className="captured-empty">{t('board.noCapturedPieces')}</span>
                        ) : (
                            choDeadPieces.map((pieceType, idx) => (
                                <div key={`captured-cho-${pieceType}-${idx}`} className="captured-piece-item">
                                    <Piece
                                        team={TEAM.CHO}
                                        type={pieceType}
                                        styleVariant={styleVariant}
                                        inverted={invertColor}
                                    />
                                </div>
                            ))
                        )}
                    </div>
                </div>
                <div className="captured-row">
                    <div className="captured-label han">{t('board.capturedHan')}</div>
                    <div className="captured-pieces">
                        {hanDeadPieces.length === 0 ? (
                            <span className="captured-empty">{t('board.noCapturedPieces')}</span>
                        ) : (
                            hanDeadPieces.map((pieceType, idx) => (
                                <div key={`captured-han-${pieceType}-${idx}`} className="captured-piece-item">
                                    <Piece
                                        team={TEAM.HAN}
                                        type={pieceType}
                                        styleVariant={styleVariant}
                                        inverted={invertColor}
                                    />
                                </div>
                            ))
                        )}
                    </div>
                </div>
            </div>

            <div className="game-status-bar">
                 <div className="turn-indicator">
                     {t('board.turnLabel')}: <span className={turn === TEAM.CHO ? 'turn-team cho' : 'turn-team han'}>{t(`board.team.${turn}`)}</span>
                 </div>

                 {gameMode === 'replay' && (
                    <div className="replay-step">{t('board.step', { current: replayStep + 1, total: replayHistory?.length })}</div>
                 )}
                 {gameMode === 'ai' && aiThinking && (
                    <div className="replay-step">{t('board.aiThinking')}</div>
                 )}
                 
                 <div className="game-controls">
                     {gameMode === 'replay' ? (
                         <>
                            <button onClick={handleReplayPrev} disabled={replayStep === 0}>{t('board.prev')}</button>
                            <button onClick={handleReplayNext} disabled={!replayHistory || replayStep === replayHistory.length - 1}>{t('board.next')}</button>
                         </>
                     ) : gameMode === 'online' ? (
                         <>
                            <button onClick={handleOnlinePass} disabled={turn !== myTeam}>{t('board.pass')}</button>
                            <button onClick={handleResign} className="resign-btn">{t('board.resign')}</button>
                         </>
                     ) : (
                         <>
                            <button onClick={handleReset} disabled={gameMode === 'ai' && aiThinking}>{t('board.reset')}</button>
                            <button onClick={handleUndo} disabled={gameMode === 'ai' && aiThinking}>{t('board.undo')}</button>
                            <button onClick={handlePass} disabled={gameMode === 'ai' && (aiThinking || !myTeam || turn !== myTeam)}>{t('board.pass')}</button>
                         </>
                     )}
                 </div>
            </div>
            
            <div className="settings-controls">
                <div className="control-row select-row">
                   <span className="control-label">{t('board.view')}</span>
                   <select value={viewTeam} onChange={(e) => setViewTeam(e.target.value)}>
                      <option value={TEAM.CHO}>{t('board.team.cho')}</option>
                      <option value={TEAM.HAN}>{t('board.team.han')}</option>
                    </select>
                </div>
                <label className="control-row toggle-row"><input type="checkbox" checked={invertColor} onChange={(e) => setInvertColor(e.target.checked)} /> {t('board.invertPieceColor')}</label>
                <label className="control-row toggle-row"><input type="checkbox" checked={useRotatedPieces} onChange={(e) => setUseRotatedPieces(e.target.checked)} /> {t('board.rotateOpponentPieces')}</label>
            </div>
        </div>
    </div>
  );
};

export default Board;
