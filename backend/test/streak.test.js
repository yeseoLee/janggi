const test = require('node:test');
const assert = require('node:assert/strict');

const { calculateMaxWinStreak } = require('../src/streak');

test('returns 0 for empty history', () => {
  assert.equal(calculateMaxWinStreak([], 1), 0);
});

test('tracks maximum streak across wins and losses', () => {
  const userId = 7;
  const rows = [
    { winner_id: 7, loser_id: 2 }, // 1
    { winner_id: 7, loser_id: 3 }, // 2
    { winner_id: 4, loser_id: 7 }, // reset
    { winner_id: 7, loser_id: 1 }, // 1
    { winner_id: 7, loser_id: 2 }, // 2
    { winner_id: 7, loser_id: 5 }, // 3 (max)
    { winner_id: 6, loser_id: 7 }, // reset
    { winner_id: 7, loser_id: 3 }, // 1
  ];

  assert.equal(calculateMaxWinStreak(rows, userId), 3);
});

test('ignores games not involving the user', () => {
  const rows = [
    { winner_id: 1, loser_id: 2 },
    { winner_id: 3, loser_id: 4 },
    { winner_id: 5, loser_id: 6 },
  ];
  assert.equal(calculateMaxWinStreak(rows, 9), 0);
});

test('handles PostgreSQL text ids', () => {
  const rows = [
    { winner_id: '12', loser_id: '2' },
    { winner_id: '12', loser_id: '3' },
    { winner_id: '8', loser_id: '12' },
  ];
  assert.equal(calculateMaxWinStreak(rows, '12'), 2);
});

