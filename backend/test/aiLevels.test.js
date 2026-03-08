const test = require('node:test');
const assert = require('node:assert/strict');

const { AI_LEVELS, MAX_AI_TIER, clampAiTier, getAiLevel, resolveAiUnlockAfterWin } = require('../src/aiLevels');

test('AI level catalog spans 18? through 9?', () => {
  assert.equal(AI_LEVELS.length, 27);
  assert.equal(AI_LEVELS[0].label, '18\uAE09');
  assert.equal(AI_LEVELS[MAX_AI_TIER].label, '9\uB2E8');
});

test('AI presets switch from skill-based to elo-limited tiers', () => {
  assert.equal(getAiLevel(0).skillLevel, -20);
  assert.equal(getAiLevel(0).useLimitStrength, false);
  assert.equal(getAiLevel(18).useLimitStrength, true);
  assert.equal(getAiLevel(18).uciElo, 1500);
});

test('clampAiTier keeps values within the full ladder range', () => {
  assert.equal(clampAiTier(-4), 0);
  assert.equal(clampAiTier(999), MAX_AI_TIER);
  assert.equal(clampAiTier(undefined, 3), 3);
});

test('winning on the current highest unlocked tier unlocks exactly one next tier', () => {
  const next = resolveAiUnlockAfterWin(4, 4);
  assert.equal(next.previousUnlockedTier, 4);
  assert.equal(next.unlockedTier, 5);
  assert.equal(next.unlocked, true);
  assert.equal(next.justUnlockedTier, 5);
});

test('winning below the frontier does not unlock a new tier', () => {
  const next = resolveAiUnlockAfterWin(7, 5);
  assert.equal(next.unlockedTier, 7);
  assert.equal(next.unlocked, false);
  assert.equal(next.justUnlockedTier, null);
});

test('9? remains the ceiling', () => {
  const next = resolveAiUnlockAfterWin(MAX_AI_TIER, MAX_AI_TIER);
  assert.equal(next.unlockedTier, MAX_AI_TIER);
  assert.equal(next.unlocked, false);
});
