const GUP_SUFFIX = '\uAE09';
const DAN_SUFFIX = '\uB2E8';

export const DEFAULT_AI_TIER = 0;

export const AI_LEVELS = [
  ...Array.from({ length: 18 }, (_, index) => ({
    tier: index,
    label: `${18 - index}${GUP_SUFFIX}`,
  })),
  ...Array.from({ length: 9 }, (_, index) => ({
    tier: 18 + index,
    label: `${index + 1}${DAN_SUFFIX}`,
  })),
];

export const MAX_AI_TIER = AI_LEVELS.length - 1;

export function clampAiTier(value, fallback = DEFAULT_AI_TIER) {
  const parsed = Number(value);
  const normalized = Number.isFinite(parsed) ? Math.floor(parsed) : Math.floor(Number(fallback) || DEFAULT_AI_TIER);
  return Math.max(DEFAULT_AI_TIER, Math.min(MAX_AI_TIER, normalized));
}

export function getAiLevel(tier) {
  return AI_LEVELS[clampAiTier(tier)];
}
