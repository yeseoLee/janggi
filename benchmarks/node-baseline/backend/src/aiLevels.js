const GUP_SUFFIX = '\uAE09';
const DAN_SUFFIX = '\uB2E8';

const DEFAULT_AI_TIER = 0;

const GUP_LEVELS = [
  { number: 18, skillLevel: -20, moveTimeMs: 60, depth: 2 },
  { number: 17, skillLevel: -19, moveTimeMs: 80, depth: 2 },
  { number: 16, skillLevel: -18, moveTimeMs: 100, depth: 3 },
  { number: 15, skillLevel: -17, moveTimeMs: 120, depth: 3 },
  { number: 14, skillLevel: -16, moveTimeMs: 150, depth: 3 },
  { number: 13, skillLevel: -15, moveTimeMs: 180, depth: 3 },
  { number: 12, skillLevel: -13, moveTimeMs: 220, depth: 4 },
  { number: 11, skillLevel: -12, moveTimeMs: 260, depth: 4 },
  { number: 10, skillLevel: -11, moveTimeMs: 300, depth: 4 },
  { number: 9, skillLevel: -9, moveTimeMs: 360, depth: 5 },
  { number: 8, skillLevel: -8, moveTimeMs: 430, depth: 5 },
  { number: 7, skillLevel: -7, moveTimeMs: 520, depth: 5 },
  { number: 6, skillLevel: -5, moveTimeMs: 620, depth: 6 },
  { number: 5, skillLevel: -4, moveTimeMs: 750, depth: 6 },
  { number: 4, skillLevel: -2, moveTimeMs: 900, depth: 7 },
  { number: 3, skillLevel: 0, moveTimeMs: 1050, depth: 7 },
  { number: 2, skillLevel: 2, moveTimeMs: 1250, depth: 8 },
  { number: 1, skillLevel: 4, moveTimeMs: 1500, depth: 8 },
];

const DAN_LEVELS = [
  { number: 1, uciElo: 1500, moveTimeMs: 1800, depth: 9 },
  { number: 2, uciElo: 1650, moveTimeMs: 2100, depth: 10 },
  { number: 3, uciElo: 1800, moveTimeMs: 2400, depth: 10 },
  { number: 4, uciElo: 1950, moveTimeMs: 2800, depth: 11 },
  { number: 5, uciElo: 2100, moveTimeMs: 3200, depth: 12 },
  { number: 6, uciElo: 2250, moveTimeMs: 3600, depth: 13 },
  { number: 7, uciElo: 2400, moveTimeMs: 4000, depth: 14 },
  { number: 8, uciElo: 2550, moveTimeMs: 4500, depth: 15 },
  { number: 9, uciElo: 2700, moveTimeMs: 5000, depth: 16 },
];

const AI_LEVELS = [
  ...GUP_LEVELS.map((level, index) => ({
    tier: index,
    label: `${level.number}${GUP_SUFFIX}`,
    skillLevel: level.skillLevel,
    useLimitStrength: false,
    uciElo: null,
    moveTimeMs: level.moveTimeMs,
    depth: level.depth,
  })),
  ...DAN_LEVELS.map((level, index) => ({
    tier: GUP_LEVELS.length + index,
    label: `${level.number}${DAN_SUFFIX}`,
    skillLevel: 20,
    useLimitStrength: true,
    uciElo: level.uciElo,
    moveTimeMs: level.moveTimeMs,
    depth: level.depth,
  })),
];

const MAX_AI_TIER = AI_LEVELS.length - 1;

function clampAiTier(value, fallback = DEFAULT_AI_TIER) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return Math.max(DEFAULT_AI_TIER, Math.min(MAX_AI_TIER, Math.floor(Number(fallback) || DEFAULT_AI_TIER)));
  }
  return Math.max(DEFAULT_AI_TIER, Math.min(MAX_AI_TIER, Math.floor(parsed)));
}

function getAiLevel(tier) {
  return AI_LEVELS[clampAiTier(tier)];
}

function resolveAiUnlockAfterWin(unlockedTier, wonTier) {
  const previousUnlockedTier = clampAiTier(unlockedTier, DEFAULT_AI_TIER);
  const selectedTier = clampAiTier(wonTier, DEFAULT_AI_TIER);

  if (selectedTier !== previousUnlockedTier || previousUnlockedTier >= MAX_AI_TIER) {
    return {
      previousUnlockedTier,
      unlockedTier: previousUnlockedTier,
      unlocked: false,
      justUnlockedTier: null,
    };
  }

  const nextUnlockedTier = previousUnlockedTier + 1;
  return {
    previousUnlockedTier,
    unlockedTier: nextUnlockedTier,
    unlocked: true,
    justUnlockedTier: nextUnlockedTier,
  };
}

module.exports = {
  AI_LEVELS,
  DEFAULT_AI_TIER,
  MAX_AI_TIER,
  clampAiTier,
  getAiLevel,
  resolveAiUnlockAfterWin,
};
