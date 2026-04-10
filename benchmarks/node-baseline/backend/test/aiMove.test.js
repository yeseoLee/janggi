const test = require('node:test');
const assert = require('node:assert/strict');

const {
  boardToJanggiFen,
  clampDepth,
  isValidBoardState,
  parseEngineMove,
} = require('../src/aiMove');

const createEmptyBoard = () => Array.from({ length: 10 }, () => Array(9).fill(null));

const createStartBoard = () => {
  const board = createEmptyBoard();

  board[0][0] = { team: 'han', type: 'cha' };
  board[0][1] = { team: 'han', type: 'ma' };
  board[0][2] = { team: 'han', type: 'sang' };
  board[0][3] = { team: 'han', type: 'sa' };
  board[0][5] = { team: 'han', type: 'sa' };
  board[0][6] = { team: 'han', type: 'sang' };
  board[0][7] = { team: 'han', type: 'ma' };
  board[0][8] = { team: 'han', type: 'cha' };
  board[1][4] = { team: 'han', type: 'wang' };
  board[2][1] = { team: 'han', type: 'po' };
  board[2][7] = { team: 'han', type: 'po' };
  board[3][0] = { team: 'han', type: 'jol' };
  board[3][2] = { team: 'han', type: 'jol' };
  board[3][4] = { team: 'han', type: 'jol' };
  board[3][6] = { team: 'han', type: 'jol' };
  board[3][8] = { team: 'han', type: 'jol' };

  board[6][0] = { team: 'cho', type: 'jol' };
  board[6][2] = { team: 'cho', type: 'jol' };
  board[6][4] = { team: 'cho', type: 'jol' };
  board[6][6] = { team: 'cho', type: 'jol' };
  board[6][8] = { team: 'cho', type: 'jol' };
  board[7][1] = { team: 'cho', type: 'po' };
  board[7][7] = { team: 'cho', type: 'po' };
  board[8][4] = { team: 'cho', type: 'wang' };
  board[9][0] = { team: 'cho', type: 'cha' };
  board[9][1] = { team: 'cho', type: 'ma' };
  board[9][2] = { team: 'cho', type: 'sang' };
  board[9][3] = { team: 'cho', type: 'sa' };
  board[9][5] = { team: 'cho', type: 'sa' };
  board[9][6] = { team: 'cho', type: 'sang' };
  board[9][7] = { team: 'cho', type: 'ma' };
  board[9][8] = { team: 'cho', type: 'cha' };

  return board;
};

test('boardToJanggiFen serializes current board to Fairy-Stockfish Janggi FEN', () => {
  const board = createStartBoard();
  const fen = boardToJanggiFen(board, 'cho');

  assert.equal(
    fen,
    'rnba1abnr/4k4/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/4K4/RNBA1ABNR w - - 0 1',
  );
});

test('parseEngineMove parses 10-rank coordinate move strings', () => {
  assert.deepEqual(parseEngineMove('a10a9'), {
    from: { r: 0, c: 0 },
    to: { r: 1, c: 0 },
  });

  assert.deepEqual(parseEngineMove('i1g1'), {
    from: { r: 9, c: 8 },
    to: { r: 9, c: 6 },
  });
});

test('parseEngineMove returns null for non-move tokens', () => {
  assert.equal(parseEngineMove('(none)'), null);
  assert.equal(parseEngineMove('0000'), null);
  assert.equal(parseEngineMove('bad-move'), null);
});

test('isValidBoardState validates shape and known pieces', () => {
  const board = createStartBoard();
  assert.equal(isValidBoardState(board), true);

  board[0][0] = { team: 'han', type: 'invalid_piece' };
  assert.equal(isValidBoardState(board), false);
});

test('clampDepth normalizes search depth within allowed range', () => {
  assert.equal(clampDepth(undefined, 8), 8);
  assert.equal(clampDepth('5', 8), 5);
  assert.equal(clampDepth(0, 8), 1);
  assert.equal(clampDepth(45, 8), 30);
});
