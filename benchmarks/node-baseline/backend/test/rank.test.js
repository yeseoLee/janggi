const test = require('node:test');
const assert = require('node:assert/strict');

const {
  getRankThreshold,
  parseRank,
  resolveRankAfterResult,
} = require('../src/rank');

test('parseRank parses gup and dan correctly', () => {
  assert.deepEqual(parseRank('18급'), { type: 'gup', value: 18 });
  assert.deepEqual(parseRank('1급'), { type: 'gup', value: 1 });
  assert.deepEqual(parseRank('1단'), { type: 'dan', value: 1 });
  assert.deepEqual(parseRank('9단'), { type: 'dan', value: 9 });
  assert.equal(parseRank('invalid'), null);
});

test('rank threshold matches spec (3/5/7)', () => {
  assert.equal(getRankThreshold('18급'), 3);
  assert.equal(getRankThreshold('10급'), 3);
  assert.equal(getRankThreshold('9급'), 5);
  assert.equal(getRankThreshold('1급'), 5);
  assert.equal(getRankThreshold('1단'), 7);
  assert.equal(getRankThreshold('9단'), 7);
});

test('18급 promotes to 17급 at 3 wins and resets counters', () => {
  const next = resolveRankAfterResult('18급', 2, 0, 'win');

  assert.equal(next.rank, '17급');
  assert.equal(next.rankWins, 0);
  assert.equal(next.rankLosses, 0);
});

test('18급 cannot demote below floor and loss counter is bounded', () => {
  const next = resolveRankAfterResult('18급', 0, 2, 'loss');

  assert.equal(next.rank, '18급');
  assert.equal(next.rankWins, 0);
  assert.equal(next.rankLosses, 3);
});

test('9급 promotes to 8급 at 5 wins', () => {
  const next = resolveRankAfterResult('9급', 4, 0, 'win');

  assert.equal(next.rank, '8급');
  assert.equal(next.rankWins, 0);
  assert.equal(next.rankLosses, 0);
});

test('1단 demotes to 1급 at 7 losses', () => {
  const next = resolveRankAfterResult('1단', 0, 6, 'loss');

  assert.equal(next.rank, '1급');
  assert.equal(next.rankWins, 0);
  assert.equal(next.rankLosses, 0);
});

test('9단 cannot promote above cap and win counter is bounded', () => {
  const next = resolveRankAfterResult('9단', 7, 2, 'win');

  assert.equal(next.rank, '9단');
  assert.equal(next.rankWins, 7);
  assert.equal(next.rankLosses, 2);
});

test('invalid rank falls back to 18급 progression', () => {
  const next = resolveRankAfterResult('broken-rank', 2, 0, 'win');

  assert.equal(next.rank, '17급');
  assert.equal(next.rankWins, 0);
  assert.equal(next.rankLosses, 0);
});
