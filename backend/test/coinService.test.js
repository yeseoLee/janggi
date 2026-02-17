const test = require('node:test');
const assert = require('node:assert/strict');

const {
  AI_MATCH_ENTRY_COST,
  MANUAL_RECHARGE_COINS,
  NotEnoughCoinsError,
  UserNotFoundError,
  spendCoinsForAiMatch,
  rechargeCoins,
} = require('../src/coinService');

function createMockDb(rows) {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql, params });
      return { rows };
    },
  };
}

test('spendCoinsForAiMatch deducts 1 coin and returns updated user payload', async () => {
  const mockUser = { id: 1, coins: 4 };
  const db = createMockDb([mockUser]);

  const result = await spendCoinsForAiMatch(db, 1);

  assert.equal(result.spent, AI_MATCH_ENTRY_COST);
  assert.deepEqual(result.user, mockUser);
  assert.match(db.calls[0].sql, /SET coins = coins -/);
  assert.deepEqual(db.calls[0].params, [1, AI_MATCH_ENTRY_COST]);
});

test('spendCoinsForAiMatch throws NotEnoughCoinsError when no row is updated', async () => {
  const db = createMockDb([]);

  await assert.rejects(() => spendCoinsForAiMatch(db, 7), NotEnoughCoinsError);
});

test('rechargeCoins adds 10 coins and returns updated user payload', async () => {
  const mockUser = { id: 9, coins: 22 };
  const db = createMockDb([mockUser]);

  const result = await rechargeCoins(db, 9);

  assert.equal(result.added, MANUAL_RECHARGE_COINS);
  assert.deepEqual(result.user, mockUser);
  assert.match(db.calls[0].sql, /SET coins = coins \+/);
  assert.deepEqual(db.calls[0].params, [9, MANUAL_RECHARGE_COINS]);
});

test('rechargeCoins throws UserNotFoundError when user does not exist', async () => {
  const db = createMockDb([]);

  await assert.rejects(() => rechargeCoins(db, 99), UserNotFoundError);
});
