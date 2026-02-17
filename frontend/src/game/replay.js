import { generateBoard, SETUP_TYPES, TEAM } from './constants';

const cloneBoard = (board) => board.map((row) => row.map((piece) => (piece ? { ...piece } : null)));

const isCoord = (pos) =>
  pos &&
  Number.isInteger(pos.r) &&
  Number.isInteger(pos.c) &&
  pos.r >= 0 &&
  pos.r < 10 &&
  pos.c >= 0 &&
  pos.c < 9;

const isLegacyFrameArray = (candidate) =>
  Array.isArray(candidate) &&
  candidate.length > 0 &&
  candidate[0] &&
  Array.isArray(candidate[0].board);

const nextTurn = (turn) => (turn === TEAM.CHO ? TEAM.HAN : TEAM.CHO);

const normalizeSetup = (setup) => (typeof setup === 'string' && setup.length > 0 ? setup : SETUP_TYPES.MSMS);

export const buildReplayFramesFromMoveLog = ({ choSetup, hanSetup, moveLog }) => {
  const initialBoard = generateBoard(normalizeSetup(choSetup), normalizeSetup(hanSetup));
  const frames = [{ board: cloneBoard(initialBoard), turn: TEAM.CHO }];

  if (!Array.isArray(moveLog) || moveLog.length === 0) {
    return frames;
  }

  let board = cloneBoard(initialBoard);
  let turn = TEAM.CHO;

  for (const event of moveLog) {
    if (!event || typeof event !== 'object') {
      continue;
    }

    if (event.turn === TEAM.CHO || event.turn === TEAM.HAN) {
      turn = event.turn;
    }

    if (event.type === 'move' && isCoord(event.from) && isCoord(event.to)) {
      const movingPiece = board[event.from.r][event.from.c];
      if (!movingPiece) {
        continue;
      }

      const nextBoard = cloneBoard(board);
      nextBoard[event.to.r][event.to.c] = movingPiece;
      nextBoard[event.from.r][event.from.c] = null;
      board = nextBoard;
      turn = nextTurn(turn);
      frames.push({ board: cloneBoard(board), turn });
      continue;
    }

    if (event.type === 'pass') {
      turn = nextTurn(turn);
      frames.push({ board: cloneBoard(board), turn });
    }
  }

  return frames;
};

const parseMovesField = (moves) => {
  if (!moves) return null;
  if (typeof moves === 'string') {
    try {
      return JSON.parse(moves);
    } catch {
      return null;
    }
  }
  return moves;
};

export const toReplayFrames = (gameData) => {
  if (!gameData) return [];

  if (Array.isArray(gameData.move_log)) {
    return buildReplayFramesFromMoveLog({
      choSetup: gameData.cho_setup,
      hanSetup: gameData.han_setup,
      moveLog: gameData.move_log,
    });
  }

  const parsedMoves = parseMovesField(gameData.moves);
  if (!parsedMoves) return [];

  if (isLegacyFrameArray(parsedMoves)) {
    return parsedMoves;
  }

  if (Array.isArray(parsedMoves)) {
    // Older experiments may have stored only move events in `moves`.
    return buildReplayFramesFromMoveLog({
      choSetup: gameData.cho_setup,
      hanSetup: gameData.han_setup,
      moveLog: parsedMoves,
    });
  }

  if (parsedMoves.version === 2 && Array.isArray(parsedMoves.moveLog)) {
    return buildReplayFramesFromMoveLog({
      choSetup: parsedMoves.choSetup || gameData.cho_setup,
      hanSetup: parsedMoves.hanSetup || gameData.han_setup,
      moveLog: parsedMoves.moveLog,
    });
  }

  return [];
};
