export const RESULT_METHOD = Object.freeze({
  RESIGN: 'resign',
  TIME: 'time',
  PIECE: 'piece',
  CHECKMATE: 'checkmate',
});

const RESIGN_RESULT_TYPES = new Set(['resign', 'resignation']);
const TIME_RESULT_TYPES = new Set([
  'time',
  'timeout',
  'disconnect',
  'disconnected',
  'clock',
  'lose_on_time',
]);
const PIECE_RESULT_TYPES = new Set([
  'piece',
  'pieces',
  'material',
  'material_count',
]);
const CHECKMATE_RESULT_TYPES = new Set([
  'checkmate',
  'mate',
  'janggun',
  'unknown',
  '',
]);

export function normalizeResultMethod(resultType) {
  const key = String(resultType || '').trim().toLowerCase();
  if (RESIGN_RESULT_TYPES.has(key)) return RESULT_METHOD.RESIGN;
  if (TIME_RESULT_TYPES.has(key)) return RESULT_METHOD.TIME;
  if (PIECE_RESULT_TYPES.has(key)) return RESULT_METHOD.PIECE;
  if (CHECKMATE_RESULT_TYPES.has(key)) return RESULT_METHOD.CHECKMATE;
  return RESULT_METHOD.CHECKMATE;
}
