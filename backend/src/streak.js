const toNumericId = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

/**
 * Calculate user's best (maximum) win streak from chronological game rows.
 * Rows are expected oldest -> newest.
 *
 * @param {Array<{winner_id: number|string|null, loser_id: number|string|null}>} gameRows
 * @param {number|string} userId
 * @returns {number}
 */
function calculateMaxWinStreak(gameRows, userId) {
  const targetId = toNumericId(userId);
  if (targetId == null || !Array.isArray(gameRows) || gameRows.length === 0) return 0;

  let currentStreak = 0;
  let maxStreak = 0;

  for (const row of gameRows) {
    const winnerId = toNumericId(row?.winner_id);
    const loserId = toNumericId(row?.loser_id);

    if (winnerId === targetId) {
      currentStreak += 1;
      if (currentStreak > maxStreak) maxStreak = currentStreak;
      continue;
    }

    if (loserId === targetId) {
      currentStreak = 0;
    }
  }

  return maxStreak;
}

module.exports = {
  calculateMaxWinStreak,
};

