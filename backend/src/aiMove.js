const BOARD_ROWS = 10;
const BOARD_COLS = 9;

const VALID_TEAMS = new Set(['cho', 'han']);
const VALID_PIECE_TYPES = new Set(['cha', 'ma', 'sang', 'sa', 'wang', 'po', 'jol']);

const PIECE_TYPE_TO_FEN = {
  cha: 'r',
  ma: 'n',
  sang: 'b',
  sa: 'a',
  wang: 'k',
  po: 'c',
  jol: 'p',
};

const FILES = 'abcdefghi';

const isValidPiece = (piece) =>
  piece &&
  typeof piece === 'object' &&
  VALID_TEAMS.has(piece.team) &&
  VALID_PIECE_TYPES.has(piece.type);

const isValidBoardState = (board) => {
  if (!Array.isArray(board) || board.length !== BOARD_ROWS) return false;

  for (const row of board) {
    if (!Array.isArray(row) || row.length !== BOARD_COLS) return false;
    for (const piece of row) {
      if (piece == null) continue;
      if (!isValidPiece(piece)) return false;
    }
  }

  return true;
};

const boardToJanggiFen = (board, turn) => {
  if (!isValidBoardState(board)) {
    throw new Error('invalid board shape');
  }
  if (!VALID_TEAMS.has(turn)) {
    throw new Error('invalid turn');
  }

  const rows = board.map((row) => {
    let emptyCount = 0;
    let fenRow = '';

    for (const piece of row) {
      if (!piece) {
        emptyCount += 1;
        continue;
      }

      if (emptyCount > 0) {
        fenRow += String(emptyCount);
        emptyCount = 0;
      }

      const baseChar = PIECE_TYPE_TO_FEN[piece.type];
      if (!baseChar) {
        throw new Error(`unsupported piece type: ${piece.type}`);
      }
      fenRow += piece.team === 'cho' ? baseChar.toUpperCase() : baseChar;
    }

    if (emptyCount > 0) fenRow += String(emptyCount);
    return fenRow;
  });

  const activeColor = turn === 'cho' ? 'w' : 'b';
  return `${rows.join('/')} ${activeColor} - - 0 1`;
};

const parseEngineMove = (bestmove) => {
  if (typeof bestmove !== 'string') return null;

  const move = bestmove.trim();
  if (!move || move === '(none)' || move === 'none' || move === '0000') return null;

  const match = move.match(/^([a-i])(10|[1-9])([a-i])(10|[1-9])/i);
  if (!match) return null;

  const fromFile = FILES.indexOf(match[1].toLowerCase());
  const fromRank = Number(match[2]);
  const toFile = FILES.indexOf(match[3].toLowerCase());
  const toRank = Number(match[4]);

  if (fromFile < 0 || toFile < 0) return null;
  if (fromRank < 1 || fromRank > BOARD_ROWS || toRank < 1 || toRank > BOARD_ROWS) return null;

  return {
    from: { r: BOARD_ROWS - fromRank, c: fromFile },
    to: { r: BOARD_ROWS - toRank, c: toFile },
  };
};

const clampMoveTime = (value, fallback = 700) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(100, Math.min(5000, Math.floor(parsed)));
};

module.exports = {
  boardToJanggiFen,
  clampMoveTime,
  isValidBoardState,
  parseEngineMove,
};
