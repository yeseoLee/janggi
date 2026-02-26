import { useState, useEffect, useRef, useCallback } from 'react';
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
const AI_DEFAULT_DEPTH = 8;
const AI_MIN_DEPTH = 2;
const AI_MAX_DEPTH = 20;
const AI_DEPTH_PRESETS = [4, 8, 12, 16];
const SETUP_SELECTION_TIMEOUT_SECONDS = 20;
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
  // IDLE -> MATCHING -> (Online) MATCH_FOUND -> SETUP_HAN / WAITING_HAN -> SETUP_CHO / WAITING_CHO -> PLAYING
  const [gameState, setGameState] = useState('IDLE'); 
  const [hanSetup, setHanSetup] = useState(null);
  const [choSetup, setChoSetup] = useState(null);

  const [board, setBoard] = useState(createEmptyBoard);
  const [turn, setTurn] = useState(TEAM.CHO);
  const [selectedPos, setSelectedPos] = useState(null);
  const [validMoves, setValidMoves] = useState([]);
  
  // Online Specific
  const [room, setRoom] = useState(null);
  const roomRef = useRef(null);
  const [myTeam, setMyTeam] = useState(null); 
  const myTeamRef = useRef(null); // Ref to access current team in socket listeners
  const [opponentInfo, setOpponentInfo] = useState(null);
  const gameStateRef = useRef(gameState);
  const cancelMatchRef = useRef(false);
  const [setupTimeLeft, setSetupTimeLeft] = useState(SETUP_SELECTION_TIMEOUT_SECONDS);

  // States
  const [history, setHistory] = useState([]);
  const [winner, setWinner] = useState(null);
  const [checkAlert, setCheckAlert] = useState(null);
  const [checkAlertVisible, setCheckAlertVisible] = useState(false);
  const [scores, setScores] = useState({ cho: 72, han: 73.5 });
  const [aiThinking, setAiThinking] = useState(false);
  const aiThinkingRef = useRef(false);
  const [aiSearchDepth, setAiSearchDepth] = useState(AI_DEFAULT_DEPTH);
  const aiEngineTeam = myTeam ? getOpposingTeam(myTeam) : null;

  // Replay State
  const [replayStep, setReplayStep] = useState(0); 
  const [toastMessage, setToastMessage] = useState('');
  const toastTimerRef = useRef(null);
  const [showResignModal, setShowResignModal] = useState(false);
  const [showMatchCancelledModal, setShowMatchCancelledModal] = useState(false);
  const [showMatchStartModal, setShowMatchStartModal] = useState(false);
  const [pendingSetupState, setPendingSetupState] = useState(null);

  const showToast = useCallback((message) => {
    if (!message) return;
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToastMessage(message);
    toastTimerRef.current = setTimeout(() => setToastMessage(''), 2200);
  }, []);

  useEffect(() => () => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
  }, []);

  useEffect(() => {
    roomRef.current = room;
  }, [room]);

  useEffect(() => {
    gameStateRef.current = gameState;
  }, [gameState]);

  const resetOnlineMatchState = useCallback(() => {
    setGameState('IDLE');
    setRoom(null);
    setHanSetup(null);
    setChoSetup(null);
    setMyTeam(null);
    myTeamRef.current = null;
    setOpponentInfo(null);
    setSetupTimeLeft(SETUP_SELECTION_TIMEOUT_SECONDS);
    setShowMatchStartModal(false);
    setPendingSetupState(null);
  }, []);

  const cancelOnlineMatch = useCallback((reason = 'user_cancel') => {
    if (cancelMatchRef.current) return;
    cancelMatchRef.current = true;

    if (socket.connected) {
      socket.emit('cancel_match', { room: roomRef.current, reason });
    }

    resetOnlineMatchState();
    setShowMatchCancelledModal(true);
  }, [resetOnlineMatchState]);

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
        cancelMatchRef.current = false;
        setGameState('MATCHING');
        setSetupTimeLeft(SETUP_SELECTION_TIMEOUT_SECONDS);
        setShowMatchCancelledModal(false);
        setShowMatchStartModal(false);
        setPendingSetupState(null);
        
        // Request Match
        if (user) {
            socket.emit('find_match', user);
        } else {
            console.error("User not authenticated in Board");
        }

        socket.on('match_found', (data) => {
            // data: { room, team, opponent }
            cancelMatchRef.current = false;
            setRoom(data.room);
            setMyTeam(data.team); 
            myTeamRef.current = data.team; // Update ref
            setOpponentInfo(data.opponent);
            setSetupTimeLeft(SETUP_SELECTION_TIMEOUT_SECONDS);
            const initialSetupState = data.team === TEAM.HAN ? 'SETUP_HAN' : 'WAITING_HAN';
            setPendingSetupState(initialSetupState);
            setShowMatchStartModal(true);
            setGameState('MATCH_FOUND');
            setViewTeam(data.team === TEAM.HAN ? TEAM.HAN : TEAM.CHO);
            
        });

        // Setup Sync
        socket.on('opponent_setup', (data) => {
             // data: { team, setupType }
             if (data.team === 'han') {
                 setHanSetup(data.setupType);
                 const isWaitingMatchStartConfirm = gameStateRef.current === 'MATCH_FOUND';
                 // Using ref to get the current assigned team without re-binding listeners
                 if (myTeamRef.current === TEAM.CHO) {
                     if (isWaitingMatchStartConfirm) {
                       setPendingSetupState('SETUP_CHO');
                     } else {
                       setGameState('SETUP_CHO'); // My turn to setup
                     }
                 } else {
                     if (isWaitingMatchStartConfirm) {
                       setPendingSetupState('WAITING_CHO');
                     } else {
                       setGameState('WAITING_CHO'); // I am Han, now waiting for Cho
                     }
                 }
             } else if (data.team === 'cho') {
                 setChoSetup(data.setupType);
             }
        });

        socket.on('move', (moveData) => {
             applyMove(moveData.from, moveData.to, false); 
        });

        socket.on('pass_turn', () => {
             showToast(tRef.current('board.alerts.opponentPassed'));
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
                 showToast(tRef.current('board.alerts.opponentResigned'));
               }
               return;
             }

             const messageKey = data.type === 'disconnect'
               ? 'board.alerts.disconnect'
               : 'board.alerts.checkmate';
             showToast(tRef.current(messageKey));
        });

        socket.on('match_cancelled', (data = {}) => {
             cancelMatchRef.current = true;
             resetOnlineMatchState();

             const cancelledBySelf = data.cancelledBy && data.cancelledBy === socket.id;
             if (!cancelledBySelf) {
               setShowMatchCancelledModal(true);
             }
        });

        return () => {
            const preGameStates = ['MATCHING', 'MATCH_FOUND', 'SETUP_HAN', 'SETUP_CHO', 'WAITING_HAN', 'WAITING_CHO'];
            if (
              socket.connected &&
              !cancelMatchRef.current &&
              preGameStates.includes(gameStateRef.current)
            ) {
              socket.emit('cancel_match', { room: roomRef.current, reason: 'leave_before_start' });
            }
            socket.off('match_found');
            socket.off('opponent_setup');
            socket.off('move');
            socket.off('pass_turn');
            socket.off('game_over');
            socket.off('match_cancelled');
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
        setAiSearchDepth(AI_DEFAULT_DEPTH);
        setShowMatchCancelledModal(false);
        setShowMatchStartModal(false);
        setPendingSetupState(null);
        setGameState('SELECT_SIDE');
        setViewTeam?.(TEAM.CHO);
    } else {
        // Local mode fallback (manual two-side play)
        setShowMatchCancelledModal(false);
        setShowMatchStartModal(false);
        setPendingSetupState(null);
        setGameState('SETUP_HAN');
        setMyTeam(null);
    }
  }, [gameMode, resetOnlineMatchState]);

  // Trigger Game Start when setups are ready (Online)
  useEffect(() => {
      if (gameMode === 'online' && hanSetup && choSetup && gameState !== 'PLAYING') {
          setSetupTimeLeft(SETUP_SELECTION_TIMEOUT_SECONDS);
          startGame(hanSetup, choSetup);
      }
  }, [hanSetup, choSetup, gameMode, gameState]);

  useEffect(() => {
    const isMyOnlineSetupTurn =
      gameMode === 'online' && (gameState === 'SETUP_HAN' || gameState === 'SETUP_CHO');
    if (!isMyOnlineSetupTurn) {
      setSetupTimeLeft(SETUP_SELECTION_TIMEOUT_SECONDS);
      return;
    }

    setSetupTimeLeft(SETUP_SELECTION_TIMEOUT_SECONDS);
    const timer = setInterval(() => {
      setSetupTimeLeft((prev) => Math.max(prev - 1, 0));
    }, 1000);

    return () => clearInterval(timer);
  }, [gameMode, gameState]);

  useEffect(() => {
    const isMyOnlineSetupTurn =
      gameMode === 'online' && (gameState === 'SETUP_HAN' || gameState === 'SETUP_CHO');
    if (!isMyOnlineSetupTurn || setupTimeLeft > 0) return;
    cancelOnlineMatch('setup_timeout');
  }, [cancelOnlineMatch, gameMode, gameState, setupTimeLeft]);

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

  const handleAiDepthChange = (value) => {
      const parsed = Number(value);
      if (!Number.isFinite(parsed)) return;
      const clamped = Math.max(AI_MIN_DEPTH, Math.min(AI_MAX_DEPTH, Math.floor(parsed)));
      setAiSearchDepth(clamped);
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
          depth: aiSearchDepth,
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
  }, [aiEngineTeam, aiSearchDepth, board, gameMode, gameState, myTeam, turn, winner]);

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

  // Auto-hide check alert after 1 second
  useEffect(() => {
    if (checkAlert) {
      setCheckAlertVisible(true);
      const timer = setTimeout(() => setCheckAlertVisible(false), 1000);
      return () => clearTimeout(timer);
    }
    setCheckAlertVisible(false);
  }, [checkAlert]);

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
      let stepsToUndo = 1;
      if (gameMode === 'ai' && myTeam && turn === myTeam && history.length >= 2) {
          // AI의 응수까지 끝난 시점(내 차례)에서는 2수를 함께 무른다.
          stepsToUndo = 2;
      }
      if (history.length < stepsToUndo) return;

      const targetState = history[history.length - stepsToUndo];
      setBoard(targetState.board);
      setTurn(targetState.turn);
      setHistory(history.slice(0, -stepsToUndo));
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
      if (checkAlert === turn) {
        showToast(t('board.alerts.cannotPassInCheck'));
        return;
      }
      socket.emit('pass', { room, team: myTeam });
      setHistory(prev => [...prev, { board: cloneBoardState(board), turn }]);
      setTurn(t => t === TEAM.CHO ? TEAM.HAN : TEAM.CHO);
  };
  
  const handleResign = () => {
      if (winner || gameState !== 'PLAYING') return;
      setShowResignModal(true);
  };

  const handleCancelResign = () => {
      setShowResignModal(false);
  };

  const handleConfirmResign = () => {
      setShowResignModal(false);
      if (gameMode === 'online') {
          socket.emit('resign', { room, team: myTeam, history });
      } else {
          setWinner(turn === TEAM.CHO ? TEAM.HAN : TEAM.CHO);
      }
  };

  useEffect(() => {
    if (winner) {
      setShowResignModal(false);
    }
  }, [winner]);


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
  const setupTeam = gameState === 'SETUP_HAN' || gameState === 'WAITING_HAN' ? TEAM.HAN : TEAM.CHO;
  const opponentSetupTeam = setupTeam === TEAM.HAN ? TEAM.CHO : TEAM.HAN;
  const opponentSetupPieces = getSetupPieces(opponentSetupTeam === TEAM.HAN ? hanSetup : choSetup);
  const isAiSetupPhase = gameMode === 'ai' && gameState !== 'SELECT_SIDE';
  const isSelectingAiSetup = isAiSetupPhase && myTeam && setupTeam !== myTeam;

  // Determine which captured pieces go top vs bottom based on viewTeam
  const topCaptured = viewTeam === TEAM.HAN ? choDeadPieces : hanDeadPieces;
  const bottomCaptured = viewTeam === TEAM.HAN ? hanDeadPieces : choDeadPieces;
  const topTeam = viewTeam === TEAM.HAN ? TEAM.CHO : TEAM.HAN;
  const bottomTeam = viewTeam === TEAM.HAN ? TEAM.HAN : TEAM.CHO;

  const [showSettings, setShowSettings] = useState(false);
  const [playerPopupInfo, setPlayerPopupInfo] = useState(null); // { name, rank, wins, losses, rating, isAi }

  const handlePlayerClick = (isMe) => {
    if (isMe) {
      if (!user) return;
      setPlayerPopupInfo({
        name: user.nickname || t('board.me'),
        rank: user.rank || '18급',
        wins: user.wins || 0,
        losses: user.losses || 0,
        rating: user.rating || 1000,
        isAi: false,
      });
    } else {
      if (gameMode === 'ai') {
        setPlayerPopupInfo({ name: 'AI', rank: '-', wins: 0, losses: 0, rating: null, isAi: true });
        return;
      }
      if (!opponentInfo) return;
      setPlayerPopupInfo({
        name: opponentInfo.nickname || t('board.opponent'),
        rank: opponentInfo.rank || '18급',
        wins: opponentInfo.wins || 0,
        losses: opponentInfo.losses || 0,
        rating: opponentInfo.rating || 1000,
        isAi: false,
      });
    }
  };

  const preventDrag = (e) => e.preventDefault();
  const handleCancelMatching = () => {
    cancelOnlineMatch('user_cancel');
  };
  const handleSetupClose = () => {
    if (gameMode === 'online') {
      cancelOnlineMatch('user_cancel');
      return;
    }
    navigate('/');
  };
  const handleCloseMatchCancelledModal = () => {
    setShowMatchCancelledModal(false);
    navigate('/');
  };
  const handleConfirmMatchStart = () => {
    if (!pendingSetupState) return;
    setShowMatchStartModal(false);
    setGameState(pendingSetupState);
    setPendingSetupState(null);
  };
  const setupProgressPercent = Math.max((setupTimeLeft / SETUP_SELECTION_TIMEOUT_SECONDS) * 100, 0);
  const isOnlineSetupTurn =
    gameMode === 'online' && (gameState === 'SETUP_HAN' || gameState === 'SETUP_CHO');
  const isOnlineSetupWaiting =
    gameMode === 'online' && (gameState === 'WAITING_HAN' || gameState === 'WAITING_CHO');
  const waitingSetupMessage = gameState === 'WAITING_HAN'
    ? t('board.waitingHan')
    : gameState === 'WAITING_CHO'
      ? t('board.waitingCho')
      : t('board.waitingSetupSelection');
  const myWins = Number.isFinite(Number(user?.wins)) ? Math.max(0, Math.floor(Number(user.wins))) : 0;
  const myLosses = Number.isFinite(Number(user?.losses)) ? Math.max(0, Math.floor(Number(user.losses))) : 0;
  const myRating = Number.isFinite(Number(user?.rating)) ? Math.floor(Number(user.rating)) : '-';
  const opponentWins = Number.isFinite(Number(opponentInfo?.wins)) ? Math.max(0, Math.floor(Number(opponentInfo.wins))) : 0;
  const opponentLosses = Number.isFinite(Number(opponentInfo?.losses)) ? Math.max(0, Math.floor(Number(opponentInfo.losses))) : 0;
  const opponentRating = Number.isFinite(Number(opponentInfo?.rating)) ? Math.floor(Number(opponentInfo.rating)) : '-';
  const myRecordSummary = `${myWins}${t('records.winShort')} ${myLosses}${t('records.lossShort')}`;
  const opponentRecordSummary = `${opponentWins}${t('records.winShort')} ${opponentLosses}${t('records.lossShort')}`;

  return (
    <div className="game-screen" onDragStart={preventDrag}>
        {/* MATCHING OVERLAY */}
        {gameState === 'MATCHING' && (
            <div className="game-modal-overlay">
                <div className="game-modal-card">
                    <div className="spinner"></div>
                    <h2 className="game-modal-title">{t('board.matchingTitle')}</h2>
                    <p className="game-modal-subtitle">{t('board.matchingSubtitle')}</p>
                    <div className="matching-progress-track" role="progressbar" aria-valuetext={t('board.matchingTitle')}>
                        <div className="matching-progress-fill" />
                    </div>
                    <button type="button" className="game-modal-cancel-btn" onClick={handleCancelMatching}>
                        {t('board.cancelMatch')}
                    </button>
                </div>
            </div>
        )}

        {showMatchStartModal && gameState === 'MATCH_FOUND' && (
            <div className="game-modal-overlay">
                <div className="game-modal-card match-ready-card">
                    <h2 className="game-modal-title">{t('board.matchReadyTitle')}</h2>
                    <p className="game-modal-subtitle">{t('board.matchReadySubtitle')}</p>
                    <div className="match-ready-summary">
                        <div className="match-ready-player">
                            <div className="match-ready-label">{t('board.matchReadyMe')}</div>
                            <div className="match-ready-name">{user?.nickname || t('board.me')}</div>
                            <div className="match-ready-meta">
                                <span>{t('records.rating')}</span>
                                <strong>{myRating}</strong>
                            </div>
                            <div className="match-ready-meta">
                                <span>{t('menu.recordLabel')}</span>
                                <strong>{myRecordSummary}</strong>
                            </div>
                        </div>
                        <div className="match-ready-player">
                            <div className="match-ready-label">{t('board.matchReadyOpponent')}</div>
                            <div className="match-ready-name">{opponentInfo?.nickname || t('board.opponent')}</div>
                            <div className="match-ready-meta">
                                <span>{t('records.rating')}</span>
                                <strong>{opponentRating}</strong>
                            </div>
                            <div className="match-ready-meta">
                                <span>{t('menu.recordLabel')}</span>
                                <strong>{opponentRecordSummary}</strong>
                            </div>
                        </div>
                    </div>
                    <button type="button" className="game-modal-primary-btn" onClick={handleConfirmMatchStart}>
                        {t('common.ok')}
                    </button>
                </div>
            </div>
        )}

        {/* SETUP OVERLAY (fullscreen, light theme) */}
        {(gameState === 'SELECT_SIDE' || gameState === 'SETUP_HAN' || gameState === 'SETUP_CHO' || gameState === 'WAITING_HAN' || gameState === 'WAITING_CHO') && (
            <div className="setup-fullscreen">
                <div className="setup-fs-dialog">
                    <header className="setup-fs-header">
                        <button className="setup-fs-back" onClick={handleSetupClose}>
                            <span className="material-icons-round">arrow_back</span>
                        </button>
                        <h1 className="setup-fs-title">
                            {gameState === 'SELECT_SIDE' ? t('board.selectSideTitle') : (setupTeam === TEAM.HAN ? t('board.setupHanTitle') : t('board.setupChoTitle'))}
                        </h1>
                        <div style={{ width: 40 }} />
                    </header>

                    <div className="setup-fs-content">
                        {isOnlineSetupTurn && (
                            <div className="setup-fs-timer">
                                <span className="setup-fs-timer-label">
                                    {t('board.setupTimeLeft', { seconds: setupTimeLeft })}
                                </span>
                                <div className="setup-fs-timer-track" role="progressbar" aria-valuenow={setupTimeLeft} aria-valuemin={0} aria-valuemax={SETUP_SELECTION_TIMEOUT_SECONDS}>
                                    <div className="setup-fs-timer-fill" style={{ width: `${setupProgressPercent}%` }} />
                                </div>
                            </div>
                        )}
                        {gameState === 'SELECT_SIDE' ? (
                            <>
                                <p className="setup-fs-subtitle">{t('board.selectSideSubtitle')}</p>
                                <div className="setup-fs-card">
                                    <div className="setup-fs-card-header">
                                        <span className="material-icons-round">smart_toy</span>
                                        <span>{t('board.aiLevelLabel')}</span>
                                    </div>
                                    <div className="setup-fs-slider-row">
                                        <input
                                            className="setup-fs-slider"
                                            type="range"
                                            min={AI_MIN_DEPTH}
                                            max={AI_MAX_DEPTH}
                                            step={1}
                                            value={aiSearchDepth}
                                            onChange={(e) => handleAiDepthChange(e.target.value)}
                                        />
                                        <span className="setup-fs-depth-value">{t('board.aiLevelDepthValue', { depth: aiSearchDepth })}</span>
                                    </div>
                                    <div className="setup-fs-presets">
                                        {AI_DEPTH_PRESETS.map((depth) => (
                                            <button
                                                key={`ai-depth-${depth}`}
                                                type="button"
                                                className={`setup-fs-preset-btn ${aiSearchDepth === depth ? 'active' : ''}`}
                                                onClick={() => handleAiDepthChange(depth)}
                                            >
                                                {t('board.aiLevelPreset', { depth })}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                                <div className="setup-fs-sides">
                                    <button type="button" className="setup-fs-side-btn cho" onClick={() => handleAiSideSelect(TEAM.CHO)}>
                                        <span className="setup-fs-side-icon cho">楚</span>
                                        <span className="setup-fs-side-team">{t('board.team.cho')}</span>
                                        <span className="setup-fs-side-desc">{t('board.selectSideCho')}</span>
                                    </button>
                                    <button type="button" className="setup-fs-side-btn han" onClick={() => handleAiSideSelect(TEAM.HAN)}>
                                        <span className="setup-fs-side-icon han">漢</span>
                                        <span className="setup-fs-side-team">{t('board.team.han')}</span>
                                        <span className="setup-fs-side-desc">{t('board.selectSideHan')}</span>
                                    </button>
                                </div>
                            </>
                        ) : (
                            <>
                                {isOnlineSetupWaiting && (
                                    <>
                                        <p className="setup-fs-subtitle">{waitingSetupMessage}</p>
                                        <div className="spinner setup-fs-waiting-spinner" />
                                    </>
                                )}
                                {isAiSetupPhase && (
                                    <p className="setup-fs-subtitle">{isSelectingAiSetup ? t('board.setupAiSubtitle') : t('board.setupMySubtitle')}</p>
                                )}
                                {opponentSetupPieces.length > 0 && (
                                    <div className="setup-fs-opponent-preview">
                                        <div className="setup-fs-opponent-pieces">
                                            {opponentSetupPieces.map((pType, idx) => (
                                                <div key={`opponent-setup-${idx}`} className="setup-fs-piece">
                                                    <Piece team={opponentSetupTeam} type={pType} styleVariant={styleVariant} inverted={invertColor} />
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}
                                <div className="setup-fs-options">
                                    {Object.entries(SETUP_TYPES).map(([key, label]) => {
                                        const setupLabelKey = `board.setupTypes.${key}`;
                                        const setupLabel = t(setupLabelKey) === setupLabelKey ? label : t(setupLabelKey);
                                        const pieces = getSetupPieces(key);
                                        return (
                                            <button
                                                key={key}
                                                onClick={() => handleSetupSelect(label)}
                                                className="setup-fs-option-btn"
                                                aria-label={setupLabel}
                                                title={setupLabel}
                                                disabled={isOnlineSetupWaiting}
                                            >
                                                <div className="setup-fs-option-pieces">
                                                    {pieces.map((pType, idx) => (
                                                        <div key={idx} className="setup-fs-piece">
                                                            <Piece team={setupTeam} type={pType} styleVariant={styleVariant} inverted={invertColor} />
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
                </div>
            </div>
        )}

        {showMatchCancelledModal && (
            <div className="game-modal-overlay">
                <div className="game-modal-card game-match-cancel-card">
                    <h2 className="game-modal-title">{t('board.alerts.matchCancelled')}</h2>
                    <button type="button" className="game-modal-primary-btn" onClick={handleCloseMatchCancelledModal}>
                        {t('common.ok')}
                    </button>
                </div>
            </div>
        )}

        {/* Header */}
        <header className="game-header">
            <button className="game-header-btn" onClick={() => navigate('/')}>
                <span className="material-icons-round">arrow_back</span>
            </button>
            <div className="game-header-center">
                <h1 className="game-header-title">{modeLabel}</h1>
                <span className="game-header-moves">{displayMoveCount}{t('board.movesUnit')} {t('board.inProgress')}</span>
            </div>
            <button className="game-header-btn" onClick={() => setShowSettings(!showSettings)}>
                <span className="material-icons-round">settings</span>
            </button>
        </header>

        {/* Settings Panel (collapsible) */}
        {showSettings && (
            <div className="game-settings-panel">
                <div className="game-setting-row">
                    <span>{t('board.view')}</span>
                    <select value={viewTeam} onChange={(e) => setViewTeam(e.target.value)}>
                        <option value={TEAM.CHO}>{t('board.team.cho')}</option>
                        <option value={TEAM.HAN}>{t('board.team.han')}</option>
                    </select>
                </div>
                <label className="game-setting-row">
                    <input type="checkbox" checked={invertColor} onChange={(e) => setInvertColor(e.target.checked)} />
                    {t('board.invertPieceColor')}
                </label>
                <label className="game-setting-row">
                    <input type="checkbox" checked={useRotatedPieces} onChange={(e) => setUseRotatedPieces(e.target.checked)} />
                    {t('board.rotateOpponentPieces')}
                </label>
            </div>
        )}

        {/* Main game area */}
        <main className="game-main">
            {/* Top captured pieces bar */}
            <div className="captured-bar">
                {topCaptured.map((pieceType, idx) => (
                    <div key={`cap-top-${pieceType}-${idx}`} className="captured-bar-piece">
                        <Piece team={topTeam} type={pieceType} styleVariant={styleVariant} inverted={invertColor} />
                    </div>
                ))}
            </div>

            {/* Board */}
            <div className="game-board-wrap">
                <div className="janggi-board">
                    {/* Check Notification */}
                    {checkAlertVisible && !winner && (gameState === 'PLAYING') && (
                        <div className="check-popup">
                            <h2>{t('board.checkAlert', { team: t(`board.team.${checkAlert}`) })}</h2>
                        </div>
                    )}

                    <div className="grid-container">
                        {Array.from({ length: 10 - 1 }).map((_, r) => (
                            <div key={`row-${r}`} className={`grid-row${r === 8 ? ' grid-row-last' : ''}`}>
                                {Array.from({ length: 9 - 1 }).map((_, c) => (
                                    <div key={`cell-${r}-${c}`} className="grid-cell"></div>
                                ))}
                            </div>
                        ))}
                        <div className="palace palace-top"><div className="palace-cross"></div></div>
                        <div className="palace palace-bottom"><div className="palace-cross"></div></div>
                    </div>

                    <div className="piece-layer">
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

            {/* Bottom captured pieces bar */}
            <div className="captured-bar">
                {bottomCaptured.map((pieceType, idx) => (
                    <div key={`cap-bot-${pieceType}-${idx}`} className="captured-bar-piece">
                        <Piece team={bottomTeam} type={pieceType} styleVariant={styleVariant} inverted={invertColor} />
                    </div>
                ))}
            </div>
        </main>

        {/* Bottom Panel */}
        <div className="game-bottom-panel">
            <div className="game-bottom-handle" />

            {/* Player info row */}
            <div className="game-player-row">
                <div className="game-player-info left" onClick={() => handlePlayerClick(false)} role="button" tabIndex={0}>
                    <div className="game-player-avatar opponent">
                        <span className="material-icons-round">person</span>
                        <div className={`game-player-team-badge ${topTeam}`}>
                            {topTeam === TEAM.CHO ? '楚' : '漢'}
                        </div>
                    </div>
                    <div className="game-player-text">
                        <span className="game-player-name">
                            {gameMode === 'online' ? (opponentInfo?.nickname || t('board.opponent')) : (gameMode === 'ai' ? 'AI' : t('board.opponent'))}
                        </span>
                        <span className="game-player-score">{topTeam === TEAM.CHO ? scores.cho : scores.han}{t('board.pointUnit')}</span>
                    </div>
                </div>

                <div className="game-turn-center">
                    <div className={`game-turn-indicator ${turn}`}>
                        <span className="game-turn-label">{t(`board.team.${turn}`)}</span>
                        <span className="game-turn-sub">{t('board.turnLabel')}</span>
                    </div>
                    {gameMode === 'ai' && aiThinking && (
                        <div className="game-ai-thinking">{t('board.aiThinking')}</div>
                    )}
                    {gameMode === 'replay' && (
                        <div className="game-replay-step">{replayStep + 1} / {replayHistory?.length}</div>
                    )}
                </div>

                <div className="game-player-info right" onClick={() => handlePlayerClick(true)} role="button" tabIndex={0}>
                    <div className="game-player-text right">
                        <span className="game-player-name">
                            {user?.nickname || t('board.me')}
                        </span>
                        <span className="game-player-score">{bottomTeam === TEAM.CHO ? scores.cho : scores.han}{t('board.pointUnit')}</span>
                    </div>
                    <div className={`game-player-avatar me ${turn === bottomTeam ? 'active-turn' : ''}`}>
                        <span className="material-icons-round">person</span>
                        <div className={`game-player-team-badge ${bottomTeam}`}>
                            {bottomTeam === TEAM.CHO ? '楚' : '漢'}
                        </div>
                    </div>
                </div>
            </div>

            {/* Player Profile Popup */}
            {playerPopupInfo && (
                <div className="player-popup-overlay" onClick={() => setPlayerPopupInfo(null)}>
                    <div className="player-popup-card" onClick={e => e.stopPropagation()}>
                        <div className="player-popup-handle" />
                        <div className="player-popup-header">
                            <div className="player-popup-avatar">
                                <span className="material-icons-round">{playerPopupInfo.isAi ? 'smart_toy' : 'person'}</span>
                            </div>
                            <div>
                                <p className="player-popup-name">{playerPopupInfo.name}</p>
                                <p className="player-popup-rank">{playerPopupInfo.isAi ? 'AI Engine' : playerPopupInfo.rank}</p>
                            </div>
                        </div>
                        {!playerPopupInfo.isAi && (
                            <>
                                <div className="player-popup-stats">
                                    <div className="player-popup-stat">
                                        <div className="player-popup-stat-value">{playerPopupInfo.wins + playerPopupInfo.losses}</div>
                                        <div className="player-popup-stat-label">{t('board.popup.totalGames')}</div>
                                    </div>
                                    <div className="player-popup-stat">
                                        <div className="player-popup-stat-value">{playerPopupInfo.wins}</div>
                                        <div className="player-popup-stat-label">{t('board.popup.wins')}</div>
                                    </div>
                                    <div className="player-popup-stat">
                                        <div className="player-popup-stat-value">
                                            {(playerPopupInfo.wins + playerPopupInfo.losses) > 0
                                                ? Math.round(playerPopupInfo.wins / (playerPopupInfo.wins + playerPopupInfo.losses) * 100)
                                                : 0}%
                                        </div>
                                        <div className="player-popup-stat-label">{t('board.popup.winRate')}</div>
                                    </div>
                                </div>
                                {playerPopupInfo.rating != null && (
                                    <div className="player-popup-rating">
                                        <span className="player-popup-rating-label">{t('board.popup.rating')}</span>
                                        <span className="player-popup-rating-value">{playerPopupInfo.rating}</span>
                                    </div>
                                )}
                            </>
                        )}
                    </div>
                </div>
            )}

            {/* Action Buttons */}
            <div className="game-action-grid">
                {gameMode === 'replay' ? (
                    <>
                        <button className="game-action-btn" onClick={handleReplayPrev} disabled={replayStep === 0}>
                            <span className="material-icons-round">skip_previous</span>
                            <span>{t('board.prev')}</span>
                        </button>
                        <button className="game-action-btn" onClick={handleReplayNext} disabled={!replayHistory || replayStep === replayHistory.length - 1}>
                            <span className="material-icons-round">skip_next</span>
                            <span>{t('board.next')}</span>
                        </button>
                    </>
                ) : gameMode === 'online' ? (
                    <>
                        <button className="game-action-btn" onClick={handleOnlinePass} disabled={turn !== myTeam}>
                            <span className="material-icons-round">skip_next</span>
                            <span>{t('board.pass')}</span>
                        </button>
                        <button className="game-action-btn danger" onClick={handleResign}>
                            <span className="material-icons-round">flag</span>
                            <span>{t('board.resign')}</span>
                        </button>
                    </>
                ) : (
                    <>
                        <button className="game-action-btn" onClick={handlePass} disabled={gameMode === 'ai' && (aiThinking || !myTeam || turn !== myTeam)}>
                            <span className="material-icons-round">skip_next</span>
                            <span>{t('board.pass')}</span>
                        </button>
                        <button className="game-action-btn danger" onClick={handleResign}>
                            <span className="material-icons-round">flag</span>
                            <span>{t('board.resign')}</span>
                        </button>
                        <button className="game-action-btn dark" onClick={handleUndo} disabled={gameMode === 'ai' && aiThinking}>
                            <span className="material-icons-round">undo</span>
                            <span>{t('board.undo')}</span>
                        </button>
                        <button className="game-action-btn dark" onClick={handleReset} disabled={gameMode === 'ai' && aiThinking}>
                            <span className="material-icons-round">refresh</span>
                            <span>{t('board.reset')}</span>
                        </button>
                    </>
                )}
            </div>
        </div>

        {winner && (
            <div className="game-modal-overlay game-result-overlay">
                <div className="game-result-modal">
                    <div className="game-result-title">{t('board.gameOver')}</div>
                    <div className={`game-result-winner ${winner}`}>
                        {t('board.wins', { team: t(`board.team.${winner}`) })}
                    </div>
                    <div className="game-result-actions">
                        {gameMode !== 'online' && gameMode !== 'replay' && (
                            <button className="winner-btn" onClick={() => window.location.reload()}>
                                {t('board.playAgain')}
                            </button>
                        )}
                        <button className="winner-btn secondary" onClick={() => navigate('/')}>
                            {t('board.exitToMenu')}
                        </button>
                    </div>
                </div>
            </div>
        )}

        {showResignModal && (
            <div className="game-modal-overlay game-confirm-overlay" onClick={handleCancelResign}>
                <div className="game-confirm-card" onClick={(e) => e.stopPropagation()}>
                    <div className="game-confirm-title">{t('board.alerts.confirmResign')}</div>
                    <div className="game-confirm-actions">
                        <button className="game-confirm-btn secondary" onClick={handleCancelResign}>
                            {t('common.no')}
                        </button>
                        <button className="game-confirm-btn primary" onClick={handleConfirmResign}>
                            {t('common.yes')}
                        </button>
                    </div>
                </div>
            </div>
        )}

        {toastMessage && <div className="toast-notification">{toastMessage}</div>}
    </div>
  );
};

export default Board;
