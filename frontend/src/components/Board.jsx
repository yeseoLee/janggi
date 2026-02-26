import { useState, useEffect, useRef, useCallback } from 'react';
import { io } from 'socket.io-client';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import Piece from './Piece';
import { TEAM, PIECE_TYPE, SETUP_TYPES, generateBoard } from '../game/constants';
import { RESULT_METHOD, normalizeResultMethod } from '../game/result';
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
const MATCH_READY_AUTO_CONFIRM_SECONDS = 5;
const MATCH_READY_AUTO_CONFIRM_MS = MATCH_READY_AUTO_CONFIRM_SECONDS * 1000;
const MAIN_THINKING_TIME_MS = 5 * 60 * 1000;
const BYOYOMI_TIME_MS = 30 * 1000;
const BYOYOMI_PERIODS = 3;
const SCORE_AUTO_LOSE_THRESHOLD = 10;
const MOVE_LIMIT_PLY = 200;
const getOpposingTeam = (team) => (team === TEAM.CHO ? TEAM.HAN : TEAM.CHO);

const cloneBoardState = (boardState) =>
  boardState.map((row) => row.map((piece) => (piece ? { ...piece } : null)));

const getSafePositiveMs = (value, fallback = 0) => {
  const parsed = Math.floor(Number(value));
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, parsed);
};

const getSafeNonNegativeInt = (value, fallback = 0) => {
  const parsed = Math.floor(Number(value));
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, parsed);
};

const toSafeTimestampMs = (value, fallback = 0) => {
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) return Math.floor(numeric);

  const parsed = new Date(value).getTime();
  if (Number.isFinite(parsed) && parsed > 0) return parsed;
  return fallback;
};

const normalizeSetupTimerPayload = (payload) => {
  const team = payload?.team === TEAM.HAN ? TEAM.HAN : (payload?.team === TEAM.CHO ? TEAM.CHO : null);
  if (!team) return null;

  const startedAtMs = toSafeTimestampMs(payload?.startedAt, 0);
  const deadlineAtMs = toSafeTimestampMs(payload?.deadlineAt, 0);
  const durationMs = getSafePositiveMs(payload?.durationMs, SETUP_SELECTION_TIMEOUT_SECONDS * 1000);

  if (startedAtMs <= 0 || deadlineAtMs <= 0 || deadlineAtMs < startedAtMs) return null;

  return {
    team,
    startedAtMs,
    deadlineAtMs,
    durationMs,
  };
};

const normalizeClockPayload = (payload) => {
  const baseByoyomiMs = getSafePositiveMs(payload?.timeControl?.byoyomiMs, BYOYOMI_TIME_MS);
  const normalizeTeamClock = (clock = {}) => ({
    mainMs: getSafePositiveMs(clock.mainMs, MAIN_THINKING_TIME_MS),
    byoyomiPeriods: getSafeNonNegativeInt(clock.byoyomiPeriods, BYOYOMI_PERIODS),
    byoyomiRemainingMs:
      clock.byoyomiRemainingMs == null ? null : getSafePositiveMs(clock.byoyomiRemainingMs, baseByoyomiMs),
  });

  return {
    nextTurn: payload?.nextTurn === TEAM.HAN ? TEAM.HAN : TEAM.CHO,
    updatedAt: getSafePositiveMs(payload?.updatedAt, Date.now()),
    timeControl: {
      mainMs: getSafePositiveMs(payload?.timeControl?.mainMs, MAIN_THINKING_TIME_MS),
      byoyomiMs: baseByoyomiMs,
      byoyomiPeriods: getSafeNonNegativeInt(payload?.timeControl?.byoyomiPeriods, BYOYOMI_PERIODS),
    },
    clocks: {
      [TEAM.CHO]: normalizeTeamClock(payload?.clocks?.[TEAM.CHO]),
      [TEAM.HAN]: normalizeTeamClock(payload?.clocks?.[TEAM.HAN]),
    },
  };
};

const projectClockAfterElapsed = (clock, elapsedMs, byoyomiMs) => {
  const safeElapsed = getSafePositiveMs(elapsedMs, 0);
  const projected = {
    mainMs: getSafePositiveMs(clock?.mainMs, 0),
    byoyomiPeriods: getSafeNonNegativeInt(clock?.byoyomiPeriods, 0),
    byoyomiRemainingMs: clock?.byoyomiRemainingMs == null
      ? null
      : getSafePositiveMs(clock.byoyomiRemainingMs, byoyomiMs),
  };

  if (safeElapsed <= 0) {
    if (projected.mainMs <= 0) {
      projected.byoyomiRemainingMs = projected.byoyomiPeriods > 0
        ? (projected.byoyomiRemainingMs ?? byoyomiMs)
        : 0;
    }
    return projected;
  }

  let remain = safeElapsed;
  if (projected.mainMs > 0) {
    if (remain < projected.mainMs) {
      projected.mainMs -= remain;
      remain = 0;
    } else {
      remain -= projected.mainMs;
      projected.mainMs = 0;
    }
  }

  if (projected.mainMs <= 0 && projected.byoyomiPeriods > 0) {
    let byoRemain = projected.byoyomiRemainingMs ?? byoyomiMs;
    while (remain > 0 && projected.byoyomiPeriods > 0) {
      if (remain < byoRemain) {
        byoRemain -= remain;
        remain = 0;
        break;
      }
      remain -= byoRemain;
      projected.byoyomiPeriods -= 1;
      byoRemain = projected.byoyomiPeriods > 0 ? byoyomiMs : 0;
    }
    projected.byoyomiRemainingMs = byoRemain;
  } else if (projected.mainMs <= 0 && projected.byoyomiPeriods <= 0) {
    projected.byoyomiRemainingMs = 0;
  }

  if (projected.mainMs <= 0 && projected.byoyomiPeriods <= 0) {
    projected.mainMs = 0;
    projected.byoyomiRemainingMs = 0;
  }

  return projected;
};

const projectClockPayload = (clockPayload, nowMs = Date.now()) => {
  if (!clockPayload?.clocks) {
    return {
      [TEAM.CHO]: { mainMs: MAIN_THINKING_TIME_MS, byoyomiPeriods: BYOYOMI_PERIODS, byoyomiRemainingMs: null },
      [TEAM.HAN]: { mainMs: MAIN_THINKING_TIME_MS, byoyomiPeriods: BYOYOMI_PERIODS, byoyomiRemainingMs: null },
    };
  }

  const byoyomiMs = getSafePositiveMs(clockPayload?.timeControl?.byoyomiMs, BYOYOMI_TIME_MS);
  const elapsed = Math.max(0, nowMs - getSafePositiveMs(clockPayload.updatedAt, nowMs));
  const nextTurn = clockPayload.nextTurn === TEAM.HAN ? TEAM.HAN : TEAM.CHO;

  const projected = {
    [TEAM.CHO]: { ...clockPayload.clocks[TEAM.CHO] },
    [TEAM.HAN]: { ...clockPayload.clocks[TEAM.HAN] },
  };
  projected[nextTurn] = projectClockAfterElapsed(projected[nextTurn], elapsed, byoyomiMs);

  for (const team of [TEAM.CHO, TEAM.HAN]) {
    if (projected[team].mainMs <= 0 && projected[team].byoyomiRemainingMs == null) {
      projected[team].byoyomiRemainingMs = projected[team].byoyomiPeriods > 0 ? byoyomiMs : 0;
    }
  }

  return projected;
};

const formatClockText = (ms) => {
  const totalSeconds = Math.max(0, Math.ceil(getSafePositiveMs(ms, 0) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
};

const resolveScoreWinner = (scoreMap) => {
  const choScore = Number(scoreMap?.[TEAM.CHO] ?? scoreMap?.cho);
  const hanScore = Number(scoreMap?.[TEAM.HAN] ?? scoreMap?.han);
  if (!Number.isFinite(choScore) || !Number.isFinite(hanScore)) return null;
  if (choScore === hanScore) return TEAM.HAN;
  return choScore > hanScore ? TEAM.CHO : TEAM.HAN;
};

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
    friendlyMatchId,
    replayHistory, // for replay mode
    viewTeam, setViewTeam, 
    invertColor, setInvertColor, 
    useRotatedPieces, setUseRotatedPieces, 
    styleVariant, setStyleVariant 
}) => {
  const { user, token } = useAuth();
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
  const [setupTimerSync, setSetupTimerSync] = useState(null);
  const [setupTimerNowMs, setSetupTimerNowMs] = useState(Date.now());

  // States
  const [history, setHistory] = useState([]);
  const [moveLog, setMoveLog] = useState([]);
  const [gameStartedAt, setGameStartedAt] = useState(null);
  const [winner, setWinner] = useState(null);
  const [gameResultMethod, setGameResultMethod] = useState(null);
  const [checkAlert, setCheckAlert] = useState(null);
  const [checkAlertVisible, setCheckAlertVisible] = useState(false);
  const [scores, setScores] = useState({ cho: 72, han: 73.5 });
  const [aiThinking, setAiThinking] = useState(false);
  const aiThinkingRef = useRef(false);
  const boardRef = useRef(board);
  const turnRef = useRef(turn);
  const moveLogRef = useRef(moveLog);
  const historyRef = useRef(history);
  const onlineFinishRequestedRef = useRef(false);
  const [aiSearchDepth, setAiSearchDepth] = useState(AI_DEFAULT_DEPTH);
  const aiEngineTeam = myTeam ? getOpposingTeam(myTeam) : null;

  // Replay State
  const [replayStep, setReplayStep] = useState(0); 
  const [toastMessage, setToastMessage] = useState('');
  const toastTimerRef = useRef(null);
  const [showResignModal, setShowResignModal] = useState(false);
  const [showMatchCancelledModal, setShowMatchCancelledModal] = useState(false);
  const [showMatchStartModal, setShowMatchStartModal] = useState(false);
  const [isRegisteringVillain, setIsRegisteringVillain] = useState(false);
  const [pendingSetupState, setPendingSetupState] = useState(null);
  const [matchReadyTimeLeftMs, setMatchReadyTimeLeftMs] = useState(MATCH_READY_AUTO_CONFIRM_MS);
  const [onlineClockPayload, setOnlineClockPayload] = useState(null);
  const [clockNowMs, setClockNowMs] = useState(Date.now());
  const aiReplaySavedRef = useRef(false);
  const isNetworkGame = gameMode === 'online' || gameMode === 'friendly';

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

  useEffect(() => {
    boardRef.current = board;
  }, [board]);

  useEffect(() => {
    turnRef.current = turn;
  }, [turn]);

  useEffect(() => {
    moveLogRef.current = moveLog;
  }, [moveLog]);

  useEffect(() => {
    historyRef.current = history;
  }, [history]);

  const resetOnlineMatchState = useCallback(() => {
    setGameState('IDLE');
    setRoom(null);
    setHanSetup(null);
    setChoSetup(null);
    setMyTeam(null);
    myTeamRef.current = null;
    setOpponentInfo(null);
    setSetupTimeLeft(SETUP_SELECTION_TIMEOUT_SECONDS);
    setSetupTimerSync(null);
    setSetupTimerNowMs(Date.now());
    setShowMatchStartModal(false);
    setPendingSetupState(null);
    setGameResultMethod(null);
    setMatchReadyTimeLeftMs(MATCH_READY_AUTO_CONFIRM_MS);
    setOnlineClockPayload(null);
    onlineFinishRequestedRef.current = false;
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
      setMoveLog([]);
      setGameStartedAt(null);
      aiReplaySavedRef.current = false;
      onlineFinishRequestedRef.current = false;
      setOnlineClockPayload(null);
      setSetupTimerSync(null);
      setSetupTimerNowMs(Date.now());
      setWinner(null);
      setGameResultMethod(null);
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
      setMoveLog([]);
      setGameStartedAt(null);
      aiReplaySavedRef.current = false;
      onlineFinishRequestedRef.current = false;
      setOnlineClockPayload(null);
      setSetupTimerSync(null);
      setSetupTimerNowMs(Date.now());
      setWinner(null);
      setGameResultMethod(null);
      setCheckAlert(null);
      setScores({ cho: 72, han: 73.5 });
      setAiThinking(false);
      aiThinkingRef.current = false;
    }
  }, [gameMode, replayHistory]);

  // Initialize Game Logic
  useEffect(() => {
    if (gameMode === 'replay') return;

    if (isNetworkGame) {
        if (!token) {
            navigate('/login');
            return;
        }
        socket.auth = { token };
        if (!socket.connected) socket.connect();
        cancelMatchRef.current = false;
        setGameState('MATCHING');
        setSetupTimeLeft(SETUP_SELECTION_TIMEOUT_SECONDS);
        setSetupTimerSync(null);
        setSetupTimerNowMs(Date.now());
        setShowMatchCancelledModal(false);
        setShowMatchStartModal(false);
        setPendingSetupState(null);
        setMoveLog([]);
        setGameStartedAt(null);
        aiReplaySavedRef.current = false;
        onlineFinishRequestedRef.current = false;
        setOnlineClockPayload(null);
        const friendlyMatchIdValue = gameMode === 'friendly'
          ? (typeof friendlyMatchId === 'string' ? friendlyMatchId.trim() : '')
          : '';
        if (gameMode === 'friendly' && !friendlyMatchIdValue) {
          showToast(tRef.current('social.friendlyInviteFailed'));
          navigate('/social');
          socket.disconnect();
          return;
        }
        
        socket.on('match_found', (data) => {
            // data: { room, team, opponent }
            cancelMatchRef.current = false;
            setRoom(data.room);
            setMyTeam(data.team); 
            myTeamRef.current = data.team; // Update ref
            setOpponentInfo(data.opponent);
            setSetupTimeLeft(SETUP_SELECTION_TIMEOUT_SECONDS);
            setSetupTimerSync(normalizeSetupTimerPayload(data.setupTimer));
            setSetupTimerNowMs(Date.now());
            const initialSetupState = data.team === TEAM.HAN ? 'SETUP_HAN' : 'WAITING_HAN';
            setPendingSetupState(initialSetupState);
            setShowMatchStartModal(true);
            setGameState('MATCH_FOUND');
            setViewTeam(data.team === TEAM.HAN ? TEAM.HAN : TEAM.CHO);
            setOnlineClockPayload(null);
            onlineFinishRequestedRef.current = false;
            
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

        socket.on('pass_turn', (payload = {}) => {
             const currentBoard = cloneBoardState(boardRef.current);
             const currentTurn = turnRef.current;
             const passTurn = payload.team === TEAM.HAN ? TEAM.HAN : (payload.team === TEAM.CHO ? TEAM.CHO : currentTurn);
             showToast(tRef.current('board.alerts.opponentPassed'));
             setHistory(prev => [...prev, { board: currentBoard, turn: currentTurn }]);
             setMoveLog(prev => [...prev, { type: 'pass', turn: passTurn, at: payload.at || new Date().toISOString() }]);
             setTurn(t => t === TEAM.CHO ? TEAM.HAN : TEAM.CHO);
        });

        socket.on('clock_sync', (payload) => {
             setOnlineClockPayload(normalizeClockPayload(payload));
             setClockNowMs(Date.now());
        });

        socket.on('setup_timer_sync', (payload) => {
             setSetupTimerSync(normalizeSetupTimerPayload(payload));
             setSetupTimerNowMs(Date.now());
        });

        socket.on('game_over', (data) => {
             onlineFinishRequestedRef.current = true;
             setWinner(data.winner);
             setGameResultMethod(normalizeResultMethod(data.type));
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

             const normalizedMethod = normalizeResultMethod(data.type);
             let messageKey = 'board.alerts.checkmate';
             if (normalizedMethod === RESULT_METHOD.TIME) {
               messageKey = 'board.alerts.time';
             } else if (normalizedMethod === RESULT_METHOD.SCORE || normalizedMethod === RESULT_METHOD.PIECE) {
               messageKey = 'board.alerts.scoreDecision';
             }
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

        // Request Match
        if (gameMode === 'friendly') {
            socket.emit('join_friendly_match', { matchId: friendlyMatchIdValue }, (response = {}) => {
              if (response.ok) return;

              const error = String(response.error || '');
              if (error === 'MATCH_NOT_FOUND') {
                showToast(tRef.current('social.friendlyInviteFailed'));
              } else if (error === 'NOT_ALLOWED') {
                showToast(tRef.current('social.blockedCannotInvite'));
              } else {
                showToast(tRef.current('social.friendlyInviteFailed'));
              }
              navigate('/social');
            });
        } else if (user) {
            socket.emit('find_match', user);
        } else {
            console.error("User not authenticated in Board");
        }

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
            socket.off('clock_sync');
            socket.off('setup_timer_sync');
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
        setMoveLog([]);
        setGameStartedAt(null);
        aiReplaySavedRef.current = false;
        onlineFinishRequestedRef.current = false;
        setOnlineClockPayload(null);
        setSetupTimerSync(null);
        setSetupTimerNowMs(Date.now());
        setWinner(null);
        setGameResultMethod(null);
        setSelectedPos(null);
        setValidMoves([]);
        setScores({ cho: 72, han: 73.5 });
        setAiThinking(false);
        aiThinkingRef.current = false;
        setAiSearchDepth(AI_DEFAULT_DEPTH);
        setShowMatchCancelledModal(false);
        setShowMatchStartModal(false);
        setPendingSetupState(null);
        setGameResultMethod(null);
        setGameState('SELECT_SIDE');
        setViewTeam?.(TEAM.CHO);
    } else {
        // Local mode fallback (manual two-side play)
        setShowMatchCancelledModal(false);
        setShowMatchStartModal(false);
        setPendingSetupState(null);
        setGameResultMethod(null);
        setMoveLog([]);
        setGameStartedAt(null);
        aiReplaySavedRef.current = false;
        onlineFinishRequestedRef.current = false;
        setOnlineClockPayload(null);
        setSetupTimerSync(null);
        setSetupTimerNowMs(Date.now());
        setGameState('SETUP_HAN');
        setMyTeam(null);
    }
  }, [friendlyMatchId, gameMode, isNetworkGame, navigate, resetOnlineMatchState, showToast, token, user]);

  // Trigger Game Start when setups are ready (Network)
  useEffect(() => {
      if (isNetworkGame && hanSetup && choSetup && gameState !== 'PLAYING') {
          setSetupTimeLeft(SETUP_SELECTION_TIMEOUT_SECONDS);
          startGame(hanSetup, choSetup);
      }
  }, [hanSetup, choSetup, gameState, isNetworkGame]);

  useEffect(() => {
    const isOnlineSetupPhase = isNetworkGame && (
      gameState === 'SETUP_HAN' ||
      gameState === 'SETUP_CHO' ||
      gameState === 'WAITING_HAN' ||
      gameState === 'WAITING_CHO'
    );
    if (!isOnlineSetupPhase) {
      setSetupTimeLeft(SETUP_SELECTION_TIMEOUT_SECONDS);
      return;
    }

    const deadlineAtMs = Number(setupTimerSync?.deadlineAtMs);
    if (!Number.isFinite(deadlineAtMs) || deadlineAtMs <= 0) {
      setSetupTimeLeft(SETUP_SELECTION_TIMEOUT_SECONDS);
      return;
    }

    const updateFromServerDeadline = () => {
      const nowMs = Date.now();
      setSetupTimerNowMs(nowMs);
      const remainingMs = Math.max(deadlineAtMs - nowMs, 0);
      const remainingSeconds = Math.max(0, Math.ceil(remainingMs / 1000));
      setSetupTimeLeft(remainingSeconds);
    };

    updateFromServerDeadline();
    const timer = setInterval(updateFromServerDeadline, 200);
    return () => clearInterval(timer);
  }, [gameState, isNetworkGame, setupTimerSync]);

  useEffect(() => {
    const isMyOnlineSetupTurn =
      isNetworkGame && (gameState === 'SETUP_HAN' || gameState === 'SETUP_CHO');
    if (!isMyOnlineSetupTurn || setupTimeLeft > 0) return;
    cancelOnlineMatch('setup_timeout');
  }, [cancelOnlineMatch, gameState, isNetworkGame, setupTimeLeft]);

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
      if (isNetworkGame) {
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
      setMoveLog([]);
      setGameStartedAt(new Date().toISOString());
      aiReplaySavedRef.current = false;
      onlineFinishRequestedRef.current = false;
      if (isNetworkGame) {
        setOnlineClockPayload(normalizeClockPayload({
          nextTurn: TEAM.CHO,
          updatedAt: Date.now(),
          timeControl: {
            mainMs: MAIN_THINKING_TIME_MS,
            byoyomiMs: BYOYOMI_TIME_MS,
            byoyomiPeriods: BYOYOMI_PERIODS,
          },
          clocks: {
            [TEAM.CHO]: { mainMs: MAIN_THINKING_TIME_MS, byoyomiPeriods: BYOYOMI_PERIODS },
            [TEAM.HAN]: { mainMs: MAIN_THINKING_TIME_MS, byoyomiPeriods: BYOYOMI_PERIODS },
          },
        }));
      } else {
        setOnlineClockPayload(null);
      }
      setSetupTimerSync(null);
      setSetupTimerNowMs(Date.now());
      setWinner(null);
      setGameResultMethod(null);
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
          setMoveLog((prev) => [...prev, { type: 'pass', turn, at: new Date().toISOString() }]);
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
          setGameResultMethod(RESULT_METHOD.CHECKMATE);
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

    if (gameMode === 'replay') {
      setCheckAlert(null);
      return;
    }

    if (isCheck(board, turn)) {
        setCheckAlert(turn); 
        if (isCheckmate(board, turn)) {
            const winnerTeam = turn === TEAM.CHO ? TEAM.HAN : TEAM.CHO;
            setWinner(winnerTeam);
            setGameResultMethod(RESULT_METHOD.CHECKMATE);
            
            if (isNetworkGame && myTeam && turn === myTeam && !onlineFinishRequestedRef.current) {
                 onlineFinishRequestedRef.current = true;
                 socket.emit('checkmate', { room, winner: winnerTeam, history: historyRef.current });
            }
        }
    } else {
        setCheckAlert(null);
    }
  }, [board, turn, gameMode, gameState, myTeam, room]);

  const concludeWithScoreDecision = useCallback((winnerTeam, toastKey) => {
    if (!winnerTeam) return;
    setWinner(winnerTeam);
    setGameResultMethod(RESULT_METHOD.SCORE);
    if (toastKey) {
      showToast(t(toastKey));
    }
    if (isNetworkGame && room && !onlineFinishRequestedRef.current) {
      onlineFinishRequestedRef.current = true;
      socket.emit('finish_by_rule', { room, winner: winnerTeam, type: 'score' });
    }
  }, [isNetworkGame, room, showToast, t]);

  useEffect(() => {
    if (gameState !== 'PLAYING' || gameMode === 'replay' || winner) return;
    if (isCheck(board, turn) && isCheckmate(board, turn)) return;

    const scoreWinner = resolveScoreWinner(scores);
    if (!scoreWinner) return;

    const choLow = scores.cho <= SCORE_AUTO_LOSE_THRESHOLD;
    const hanLow = scores.han <= SCORE_AUTO_LOSE_THRESHOLD;
    if (choLow || hanLow) {
      concludeWithScoreDecision(scoreWinner, 'board.alerts.scoreThresholdEnd');
      return;
    }

    if (moveLog.length >= 2) {
      const lastMove = moveLog[moveLog.length - 1];
      const prevMove = moveLog[moveLog.length - 2];
      if (
        lastMove?.type === 'pass' &&
        prevMove?.type === 'pass' &&
        lastMove.turn &&
        prevMove.turn &&
        lastMove.turn !== prevMove.turn
      ) {
        concludeWithScoreDecision(scoreWinner, 'board.alerts.doublePassEnd');
        return;
      }
    }

    if (moveLog.length >= MOVE_LIMIT_PLY) {
      concludeWithScoreDecision(scoreWinner, 'board.alerts.moveLimitEnd');
    }
  }, [board, concludeWithScoreDecision, gameMode, gameState, moveLog, scores, turn, winner]);

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
    
    if (isNetworkGame && myTeam && turn !== myTeam) return;
    if (gameMode === 'ai' && (!myTeam || turn !== myTeam)) return;

    if (selectedPos) {
      const isMove = validMoves.some(m => m.r === r && m.c === c);
      if (isMove) {
        if (isNetworkGame) {
            socket.emit('move', { room, move: { from: selectedPos, to: { r, c } } });
        }
        applyMove(selectedPos, { r, c }, true);
        return;
      }
    }

    const piece = board[r][c];
    if (piece && piece.team === turn) {
        if (isNetworkGame && myTeam && piece.team !== myTeam) return;
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
    const currentBoard = cloneBoardState(boardRef.current);
    const currentTurn = turnRef.current;
    const moveTimestamp = new Date().toISOString();
    setHistory(prev => [...prev, { board: currentBoard, turn: currentTurn }]);
    setMoveLog(prev => [...prev, {
      type: 'move',
      turn: currentTurn,
      from: { r: from.r, c: from.c },
      to: { r: to.r, c: to.c },
      at: moveTimestamp,
    }]);
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
      if (!isNetworkGame) {
          setBoard(generateBoard(choSetup || SETUP_TYPES.MSMS, hanSetup || SETUP_TYPES.MSMS));
          setTurn(TEAM.CHO);
          setHistory([]);
          setMoveLog([]);
          setGameStartedAt(new Date().toISOString());
          aiReplaySavedRef.current = false;
          onlineFinishRequestedRef.current = false;
          setOnlineClockPayload(null);
          setWinner(null);
          setGameResultMethod(null);
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
      if (isNetworkGame) return;
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
      setMoveLog(moveLog.slice(0, -stepsToUndo));
      onlineFinishRequestedRef.current = false;
      setWinner(null);
      setGameResultMethod(null);
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
       const currentBoard = cloneBoardState(boardRef.current);
       const currentTurn = turnRef.current;
       setHistory(prev => [...prev, { board: currentBoard, turn: currentTurn }]);
       setMoveLog(prev => [...prev, { type: 'pass', turn: currentTurn, at: new Date().toISOString() }]);
       setTurn(prev => prev === TEAM.CHO ? TEAM.HAN : TEAM.CHO);
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
      const currentBoard = cloneBoardState(boardRef.current);
      const currentTurn = turnRef.current;
      setHistory(prev => [...prev, { board: currentBoard, turn: currentTurn }]);
      setMoveLog(prev => [...prev, { type: 'pass', turn: currentTurn, at: new Date().toISOString() }]);
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
      if (isNetworkGame) {
          onlineFinishRequestedRef.current = true;
          socket.emit('resign', { room, team: myTeam, history: historyRef.current });
      } else {
          setGameResultMethod(RESULT_METHOD.RESIGN);
          setWinner(turn === TEAM.CHO ? TEAM.HAN : TEAM.CHO);
      }
  };

  useEffect(() => {
    if (winner) {
      setShowResignModal(false);
    }
  }, [winner]);

  useEffect(() => {
    if (gameMode !== 'ai' || gameState !== 'PLAYING') return;
    if (!winner || !myTeam || !token || !user?.id) return;
    if (aiReplaySavedRef.current) return;

    aiReplaySavedRef.current = true;
    const replayChoSetup = choSetup || SETUP_TYPES.MSMS;
    const replayHanSetup = hanSetup || SETUP_TYPES.MSMS;
    const resultType = gameResultMethod || RESULT_METHOD.CHECKMATE;

    axios.post('/api/games/ai', {
      myTeam,
      winnerTeam: winner,
      choSetup: replayChoSetup,
      hanSetup: replayHanSetup,
      moveLog,
      resultType,
      startedAt: gameStartedAt || new Date().toISOString(),
      endedAt: new Date().toISOString(),
    }).catch((err) => {
      console.error('Failed to save AI replay:', err);
      showToast(tRef.current('board.alerts.aiReplaySaveFailed'));
    });
  }, [choSetup, gameMode, gameResultMethod, gameStartedAt, gameState, hanSetup, moveLog, myTeam, showToast, token, user?.id, winner]);


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

  const modeLabel = gameMode === 'online'
    ? t('board.mode.online')
    : gameMode === 'friendly'
      ? t('board.mode.friendly')
      : gameMode === 'replay'
        ? t('board.mode.replay')
        : t('board.mode.ai');
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
  const [playerPopupInfo, setPlayerPopupInfo] = useState(null); // { userId, name, rank, wins, losses, rating, isAi, isMe }

  const handlePlayerClick = (isMe) => {
    if (isMe) {
      if (!user) return;
      setPlayerPopupInfo({
        userId: user.id,
        name: user.nickname || t('board.me'),
        rank: user.rank || '18급',
        wins: user.wins || 0,
        losses: user.losses || 0,
        rating: user.rating || 1000,
        isAi: false,
        isMe: true,
      });
    } else {
      if (gameMode === 'ai') {
        setPlayerPopupInfo({ userId: null, name: 'AI', rank: '-', wins: 0, losses: 0, rating: null, isAi: true, isMe: false });
        return;
      }
      if (!opponentInfo) return;
      setPlayerPopupInfo({
        userId: opponentInfo.id,
        name: opponentInfo.nickname || t('board.opponent'),
        rank: opponentInfo.rank || '18급',
        wins: opponentInfo.wins || 0,
        losses: opponentInfo.losses || 0,
        rating: opponentInfo.rating || 1000,
        isAi: false,
        isMe: false,
      });
    }
  };

  const handleRegisterVillain = async () => {
    const targetUserId = Number(playerPopupInfo?.userId);
    if (!Number.isInteger(targetUserId) || targetUserId <= 0) return;
    if (isRegisteringVillain) return;

    setIsRegisteringVillain(true);
    try {
      await axios.post('/api/social/villains', { targetUserId });
      showToast(t('board.alerts.villainAdded'));
      setPlayerPopupInfo(null);
    } catch (_err) {
      showToast(t('board.alerts.villainAddFailed'));
    } finally {
      setIsRegisteringVillain(false);
    }
  };

  const preventDrag = (e) => e.preventDefault();
  const handleCancelMatching = () => {
    cancelOnlineMatch('user_cancel');
  };
  const handleSetupClose = () => {
    if (isNetworkGame) {
      cancelOnlineMatch('user_cancel');
      return;
    }
    navigate('/');
  };
  const handleCloseMatchCancelledModal = () => {
    setShowMatchCancelledModal(false);
    navigate(gameMode === 'friendly' ? '/social' : '/');
  };
  const handleConfirmMatchStart = useCallback(() => {
    if (!pendingSetupState) return;
    setShowMatchStartModal(false);
    setGameState(pendingSetupState);

    if (isNetworkGame && (pendingSetupState === 'SETUP_HAN' || pendingSetupState === 'SETUP_CHO')) {
      const selectingTeam = pendingSetupState === 'SETUP_HAN' ? TEAM.HAN : TEAM.CHO;
      const roomId = roomRef.current || room;
      if (roomId && socket.connected) {
        socket.emit('setup_phase_started', { room: roomId, team: selectingTeam });
      }
    }

    setPendingSetupState(null);
  }, [isNetworkGame, pendingSetupState, room]);

  const isMatchReadyModalVisible = showMatchStartModal && gameState === 'MATCH_FOUND';

  useEffect(() => {
    if (!isMatchReadyModalVisible) {
      setMatchReadyTimeLeftMs(MATCH_READY_AUTO_CONFIRM_MS);
      return;
    }

    setMatchReadyTimeLeftMs(MATCH_READY_AUTO_CONFIRM_MS);
    const startedAt = Date.now();

    const intervalId = setInterval(() => {
      const elapsed = Date.now() - startedAt;
      const remainingMs = Math.max(MATCH_READY_AUTO_CONFIRM_MS - elapsed, 0);
      setMatchReadyTimeLeftMs(remainingMs);
    }, 100);

    const timeoutId = setTimeout(() => {
      handleConfirmMatchStart();
    }, MATCH_READY_AUTO_CONFIRM_MS);

    return () => {
      clearInterval(intervalId);
      clearTimeout(timeoutId);
    };
  }, [handleConfirmMatchStart, isMatchReadyModalVisible]);

  useEffect(() => {
    if (!isNetworkGame || gameState !== 'PLAYING' || !onlineClockPayload || winner) return;
    setClockNowMs(Date.now());
    const timer = setInterval(() => {
      setClockNowMs(Date.now());
    }, 200);
    return () => clearInterval(timer);
  }, [gameState, isNetworkGame, onlineClockPayload, winner]);

  const setupDurationMs = Math.max(
    1000,
    Number(setupTimerSync?.durationMs) || (SETUP_SELECTION_TIMEOUT_SECONDS * 1000),
  );
  const hasSetupDeadline = Number.isFinite(Number(setupTimerSync?.deadlineAtMs)) && Number(setupTimerSync?.deadlineAtMs) > 0;
  const setupRemainingMs = hasSetupDeadline
    ? Math.max(Number(setupTimerSync?.deadlineAtMs) - setupTimerNowMs, 0)
    : setupTimeLeft * 1000;
  const setupProgressPercent = Math.max((setupRemainingMs / setupDurationMs) * 100, 0);
  const isOnlineSetupTurn =
    isNetworkGame && (gameState === 'SETUP_HAN' || gameState === 'SETUP_CHO');
  const isOnlineSetupWaiting =
    isNetworkGame && (gameState === 'WAITING_HAN' || gameState === 'WAITING_CHO');
  const waitingSetupMessage = gameState === 'WAITING_HAN'
    ? t('board.waitingHan')
    : gameState === 'WAITING_CHO'
      ? t('board.waitingCho')
      : t('board.waitingSetupSelection');
  const setupTimerLabel = isOnlineSetupTurn
    ? t('board.setupTimeLeft', { seconds: setupTimeLeft })
    : t('board.waitingSetupTimeLeft', { message: waitingSetupMessage, seconds: setupTimeLeft });
  const myWins = Number.isFinite(Number(user?.wins)) ? Math.max(0, Math.floor(Number(user.wins))) : 0;
  const myLosses = Number.isFinite(Number(user?.losses)) ? Math.max(0, Math.floor(Number(user.losses))) : 0;
  const myRating = Number.isFinite(Number(user?.rating)) ? Math.floor(Number(user.rating)) : '-';
  const opponentWins = Number.isFinite(Number(opponentInfo?.wins)) ? Math.max(0, Math.floor(Number(opponentInfo.wins))) : 0;
  const opponentLosses = Number.isFinite(Number(opponentInfo?.losses)) ? Math.max(0, Math.floor(Number(opponentInfo.losses))) : 0;
  const opponentRating = Number.isFinite(Number(opponentInfo?.rating)) ? Math.floor(Number(opponentInfo.rating)) : '-';
  const myRecordSummary = `${myWins}${t('records.winShort')} ${myLosses}${t('records.lossShort')}`;
  const opponentRecordSummary = `${opponentWins}${t('records.winShort')} ${opponentLosses}${t('records.lossShort')}`;
  const matchReadySecondsLeft = Math.max(0, Math.ceil(matchReadyTimeLeftMs / 1000));
  const matchReadyProgressPercent = Math.min(
    100,
    Math.max(0, ((MATCH_READY_AUTO_CONFIRM_MS - matchReadyTimeLeftMs) / MATCH_READY_AUTO_CONFIRM_MS) * 100),
  );
  const perspectiveTeam = myTeam || bottomTeam;
  const didIWin = winner ? winner === perspectiveTeam : false;
  const effectiveResultMethod = gameResultMethod || RESULT_METHOD.CHECKMATE;
  const resultMethodLabel = t(`board.resultMethod.${effectiveResultMethod}`);
  const resultSummaryText = didIWin
    ? t('board.resultWin', { method: resultMethodLabel })
    : t('board.resultLoss', { method: resultMethodLabel });
  const projectedOnlineClocks = isNetworkGame && onlineClockPayload
    ? projectClockPayload(onlineClockPayload, clockNowMs)
    : null;
  const getOnlineClockLabel = (team) => {
    if (!projectedOnlineClocks || !team) return null;
    const teamClock = projectedOnlineClocks[team];
    if (!teamClock) return null;

    if (teamClock.mainMs > 0) {
      return {
        text: formatClockText(teamClock.mainMs),
        critical: teamClock.mainMs <= 30 * 1000,
      };
    }

    const byoyomiRemainingMs = teamClock.byoyomiRemainingMs ?? BYOYOMI_TIME_MS;
    const byoyomiSeconds = Math.max(0, Math.ceil(byoyomiRemainingMs / 1000));
    return {
      text: t('board.byoyomiClock', { seconds: byoyomiSeconds, periods: teamClock.byoyomiPeriods }),
      critical: byoyomiSeconds <= 10 || teamClock.byoyomiPeriods <= 1,
    };
  };
  const topClockLabel = getOnlineClockLabel(topTeam);
  const bottomClockLabel = getOnlineClockLabel(bottomTeam);

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

        {isMatchReadyModalVisible && (
            <div className="game-modal-overlay">
                <div className="game-modal-card match-ready-card">
                    <h2 className="game-modal-title">{t('board.matchReadyTitle')}</h2>
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
                    <div className="match-ready-autostart">
                        <div className="match-ready-autostart-label">
                            {t('board.matchReadyAutoStart', { seconds: matchReadySecondsLeft })}
                        </div>
                        <div className="match-ready-autostart-track" role="progressbar" aria-valuemin={0} aria-valuemax={MATCH_READY_AUTO_CONFIRM_SECONDS} aria-valuenow={matchReadySecondsLeft}>
                            <div className="match-ready-autostart-fill" style={{ width: `${matchReadyProgressPercent}%` }} />
                        </div>
                    </div>
                    <button type="button" className="game-modal-primary-btn" onClick={handleConfirmMatchStart}>
                        {t('board.matchReadyConfirmButton', { seconds: matchReadySecondsLeft })}
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
                        {(isOnlineSetupTurn || isOnlineSetupWaiting) && (
                            <div className="setup-fs-timer">
                                <span className="setup-fs-timer-label">
                                    {setupTimerLabel}
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
                            {isNetworkGame ? (opponentInfo?.nickname || t('board.opponent')) : (gameMode === 'ai' ? 'AI' : t('board.opponent'))}
                        </span>
                        <span className="game-player-score">{topTeam === TEAM.CHO ? scores.cho : scores.han}{t('board.pointUnit')}</span>
                        {isNetworkGame && topClockLabel && (
                          <span className={`game-player-clock ${topClockLabel.critical ? 'critical' : ''}`}>{topClockLabel.text}</span>
                        )}
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
                        {isNetworkGame && bottomClockLabel && (
                          <span className={`game-player-clock ${bottomClockLabel.critical ? 'critical' : ''}`}>{bottomClockLabel.text}</span>
                        )}
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
                                {!playerPopupInfo.isMe && gameMode !== 'replay' && (
                                    <button
                                        type="button"
                                        className="player-popup-villain-btn"
                                        onClick={handleRegisterVillain}
                                        disabled={isRegisteringVillain}
                                    >
                                        {t('board.popup.registerVillain')}
                                    </button>
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
                ) : isNetworkGame ? (
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

        {winner && gameMode !== 'replay' && (
            <div className="game-modal-overlay game-result-overlay">
                <div className="game-result-modal">
                    <div className="game-result-title">{t('board.gameOver')}</div>
                    <div className={`game-result-winner ${didIWin ? 'win' : 'loss'}`}>
                        {resultSummaryText}
                    </div>
                    <div className="game-result-actions">
                        {!isNetworkGame && gameMode !== 'replay' && (
                            <button className="game-result-btn secondary" onClick={() => window.location.reload()}>
                                {t('board.playAgain')}
                            </button>
                        )}
                        <button className="game-result-btn primary" onClick={() => navigate('/')}>
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
