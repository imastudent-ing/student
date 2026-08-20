import type { AttemptResult, Judgment } from './types';

/**
 * 初回回答（診断・弱点復習・抜き打ち）の判定。
 *
 * | 操作 | 経過時間 | 結果 |
 * | 正解 | 制限時間以内 | fast_correct |
 * | 正解 | 制限時間超過 | slow_correct |
 * | 曖昧 | 問わない | slow_correct |
 * | 不正解 | 問わない | wrong |
 * | 分からない | 問わない | wrong |
 */
export function gradeAttempt(
  judgment: Judgment,
  elapsedMs: number | null,
  fastThresholdMs: number
): AttemptResult {
  if (judgment === 'wrong' || judgment === 'dont_know') return 'wrong';
  if (judgment === 'ambiguous') return 'slow_correct';
  if (elapsedMs !== null && elapsedMs <= fastThresholdMs) return 'fast_correct';
  return 'slow_correct';
}

/** 同日再テストは正解 / 不正解のみ */
export function gradeRetest(judgment: Judgment): AttemptResult {
  return judgment === 'correct' ? 'fast_correct' : 'wrong';
}
