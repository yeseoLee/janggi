function parseRank(rankStr) {
  if (typeof rankStr !== 'string') return null;

  const gupMatch = rankStr.match(/^([1-9]|1[0-8])급$/);
  if (gupMatch) {
    return { type: 'gup', value: Number(gupMatch[1]) };
  }

  const danMatch = rankStr.match(/^([1-9])단$/);
  if (danMatch) {
    return { type: 'dan', value: Number(danMatch[1]) };
  }

  return null;
}

function rankToTier(rankStr) {
  const parsed = parseRank(rankStr);
  if (!parsed) return 0;

  if (parsed.type === 'gup') {
    // 18급 -> 0, 1급 -> 17
    return 18 - parsed.value;
  }

  // 1단 -> 18, 9단 -> 26
  return 17 + parsed.value;
}

function tierToRank(tier) {
  const normalized = Math.max(0, Math.min(26, tier));
  if (normalized <= 17) {
    return `${18 - normalized}급`;
  }
  return `${normalized - 17}단`;
}

function getRankThreshold(rankStr) {
  const parsed = parseRank(rankStr) || { type: 'gup', value: 18 };
  if (parsed.type === 'dan') return 7;
  // 18급 ~ 10급
  if (parsed.value >= 10) return 3;
  // 9급 ~ 1급
  return 5;
}

function canPromote(rankStr) {
  return rankToTier(rankStr) < 26;
}

function canDemote(rankStr) {
  return rankToTier(rankStr) > 0;
}

function promoteRank(rankStr) {
  return tierToRank(rankToTier(rankStr) + 1);
}

function demoteRank(rankStr) {
  return tierToRank(rankToTier(rankStr) - 1);
}

function normalizeCounter(value) {
  return Math.max(0, Number.isFinite(Number(value)) ? Number(value) : 0);
}

function resolveRankAfterResult(rankStr, rankWins, rankLosses, result) {
  let nextRank = parseRank(rankStr) ? rankStr : '18급';
  let wins = normalizeCounter(rankWins);
  let losses = normalizeCounter(rankLosses);

  if (result === 'win') wins += 1;
  if (result === 'loss') losses += 1;

  // At most one rank change per game.
  const threshold = getRankThreshold(nextRank);
  if (wins >= threshold && canPromote(nextRank)) {
    nextRank = promoteRank(nextRank);
    wins = 0;
    losses = 0;
  } else if (losses >= threshold && canDemote(nextRank)) {
    nextRank = demoteRank(nextRank);
    wins = 0;
    losses = 0;
  } else {
    // Bound counters when rank cannot move in that direction.
    if (!canPromote(nextRank)) wins = Math.min(wins, threshold);
    if (!canDemote(nextRank)) losses = Math.min(losses, threshold);
  }

  return {
    rank: nextRank,
    rankWins: wins,
    rankLosses: losses,
  };
}

module.exports = {
  parseRank,
  rankToTier,
  tierToRank,
  getRankThreshold,
  canPromote,
  canDemote,
  promoteRank,
  demoteRank,
  normalizeCounter,
  resolveRankAfterResult,
};
