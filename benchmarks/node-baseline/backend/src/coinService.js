const AI_MATCH_ENTRY_COST = 1;
const MANUAL_RECHARGE_COINS = 10;

class NotEnoughCoinsError extends Error {
  constructor() {
    super('Not enough coins');
    this.name = 'NotEnoughCoinsError';
  }
}

class UserNotFoundError extends Error {
  constructor() {
    super('User not found');
    this.name = 'UserNotFoundError';
  }
}

async function spendCoinsForAiMatch(db, userId, cost = AI_MATCH_ENTRY_COST) {
  const result = await db.query(
    `UPDATE users
     SET coins = coins - $2
     WHERE id = $1
       AND coins >= $2
     RETURNING id, username, nickname, rank, wins, losses, coins, rank_wins, rank_losses`,
    [userId, cost],
  );

  if (result.rows.length === 0) {
    throw new NotEnoughCoinsError();
  }

  return {
    spent: cost,
    user: result.rows[0],
  };
}

async function rechargeCoins(db, userId, amount = MANUAL_RECHARGE_COINS) {
  const result = await db.query(
    `UPDATE users
     SET coins = coins + $2
     WHERE id = $1
     RETURNING id, username, nickname, rank, wins, losses, coins, rank_wins, rank_losses`,
    [userId, amount],
  );

  if (result.rows.length === 0) {
    throw new UserNotFoundError();
  }

  return {
    added: amount,
    user: result.rows[0],
  };
}

module.exports = {
  AI_MATCH_ENTRY_COST,
  MANUAL_RECHARGE_COINS,
  NotEnoughCoinsError,
  UserNotFoundError,
  spendCoinsForAiMatch,
  rechargeCoins,
};
