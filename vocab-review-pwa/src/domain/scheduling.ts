import type { AppSettings, AttemptResult, WordProgress } from './types';
import { addDaysStr, nowIso } from '../utils/dates';

/**
 * weak 単語のその日の初回回答を進捗へ反映する。
 * - 即答: 別日連続成功数 +1。設定回数に到達したら mastered へ卒業。
 * - 遅答・不正解: 成功数 0 リセット、翌日を期限にする。
 */
export function applyWeakFirstAttempt(
  progress: WordProgress,
  result: AttemptResult,
  today: string,
  settings: AppSettings
): WordProgress {
  const updatedAt = nowIso();
  if (result === 'fast_correct') {
    const nextStreak = progress.separateDaySuccessStreak + 1;
    if (nextStreak >= settings.graduationSuccessCount) {
      return {
        ...progress,
        state: 'mastered',
        separateDaySuccessStreak: settings.graduationSuccessCount,
        dueDate: null,
        nextAuditEligibleDate: addDaysStr(today, settings.masteredAuditMinimumDays),
        lastResult: result,
        updatedAt
      };
    }
    const intervalDays =
      nextStreak === 1
        ? settings.intervalAfterFirstSuccessDays
        : settings.intervalAfterSecondSuccessDays;
    return {
      ...progress,
      state: 'weak',
      separateDaySuccessStreak: nextStreak,
      dueDate: addDaysStr(today, intervalDays),
      lastResult: result,
      updatedAt
    };
  }
  return {
    ...progress,
    state: 'weak',
    separateDaySuccessStreak: 0,
    dueDate: addDaysStr(today, 1),
    lapseCount: progress.lapseCount + 1,
    lastResult: result,
    updatedAt
  };
}

/**
 * mastered 単語の抜き打ち確認を進捗へ反映する。
 * - 即答: mastered 維持。次回抜き打ちは最短間隔の2倍後。
 * - 遅答・不正解: weak へ戻し、成功数 0、翌日を期限にする。
 */
export function applyMasteredAudit(
  progress: WordProgress,
  result: AttemptResult,
  today: string,
  settings: AppSettings
): WordProgress {
  const updatedAt = nowIso();
  if (result === 'fast_correct') {
    return {
      ...progress,
      state: 'mastered',
      dueDate: null,
      lastAuditAt: today,
      nextAuditEligibleDate: addDaysStr(today, settings.masteredAuditMinimumDays * 2),
      lastResult: result,
      updatedAt
    };
  }
  return {
    ...progress,
    state: 'weak',
    separateDaySuccessStreak: 0,
    dueDate: addDaysStr(today, 1),
    nextAuditEligibleDate: null,
    lastAuditAt: today,
    lapseCount: progress.lapseCount + 1,
    lastResult: result,
    updatedAt
  };
}

/**
 * 診断モードの結果を進捗へ反映する。
 * - 即答: いったん mastered として扱い、以後は抜き打ちで検証する。
 * - 遅答・不正解: weak、翌日復習。
 */
export function applyDiagnosisResult(
  progress: WordProgress,
  result: AttemptResult,
  today: string,
  settings: AppSettings
): WordProgress {
  const updatedAt = nowIso();
  if (result === 'fast_correct') {
    return {
      ...progress,
      state: 'mastered',
      separateDaySuccessStreak: 0,
      dueDate: null,
      nextAuditEligibleDate: addDaysStr(today, settings.masteredAuditMinimumDays),
      lastResult: result,
      updatedAt
    };
  }
  return {
    ...progress,
    state: 'weak',
    separateDaySuccessStreak: 0,
    dueDate: addDaysStr(today, 1),
    nextAuditEligibleDate: null,
    lastResult: result,
    updatedAt
  };
}

/** 回答種別ごとの通算カウンタを加算する（初回回答用） */
export function bumpFirstAttemptCounters(
  progress: WordProgress,
  result: AttemptResult
): WordProgress {
  return {
    ...progress,
    totalFastCorrect: progress.totalFastCorrect + (result === 'fast_correct' ? 1 : 0),
    totalSlowCorrect: progress.totalSlowCorrect + (result === 'slow_correct' ? 1 : 0),
    totalWrong: progress.totalWrong + (result === 'wrong' ? 1 : 0)
  };
}

/** 同日再テストのカウンタを加算する（進捗・期限は変更しない） */
export function bumpRetestCounters(
  progress: WordProgress,
  correct: boolean
): WordProgress {
  return {
    ...progress,
    totalRetestCorrect: progress.totalRetestCorrect + (correct ? 1 : 0),
    totalRetestWrong: progress.totalRetestWrong + (correct ? 0 : 1),
    updatedAt: nowIso()
  };
}
