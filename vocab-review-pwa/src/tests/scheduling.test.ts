import { describe, expect, it } from 'vitest';
import {
  applyDiagnosisResult,
  applyMasteredAudit,
  applyWeakFirstAttempt
} from '../domain/scheduling';
import { createDefaultProgress, DEFAULT_SETTINGS, type WordProgress } from '../domain/types';

const TODAY = '2026-08-20';

function weakProgress(streak = 0): WordProgress {
  return {
    ...createDefaultProgress('w1', '2026-08-01T00:00:00.000Z'),
    state: 'weak',
    separateDaySuccessStreak: streak,
    dueDate: TODAY
  };
}

describe('弱点復習の進捗更新', () => {
  it('遅答で成功数が0に戻り翌日が期限になる', () => {
    const p = applyWeakFirstAttempt(weakProgress(2), 'slow_correct', TODAY, DEFAULT_SETTINGS);
    expect(p.separateDaySuccessStreak).toBe(0);
    expect(p.dueDate).toBe('2026-08-21');
    expect(p.state).toBe('weak');
    expect(p.lapseCount).toBe(1);
  });

  it('不正解で成功数が0に戻り翌日が期限になる', () => {
    const p = applyWeakFirstAttempt(weakProgress(2), 'wrong', TODAY, DEFAULT_SETTINGS);
    expect(p.separateDaySuccessStreak).toBe(0);
    expect(p.dueDate).toBe('2026-08-21');
  });

  it('1回目成功後は3日後になる', () => {
    const p = applyWeakFirstAttempt(weakProgress(0), 'fast_correct', TODAY, DEFAULT_SETTINGS);
    expect(p.separateDaySuccessStreak).toBe(1);
    expect(p.dueDate).toBe('2026-08-23');
    expect(p.state).toBe('weak');
  });

  it('2回目成功後は7日後になる', () => {
    const p = applyWeakFirstAttempt(weakProgress(1), 'fast_correct', TODAY, DEFAULT_SETTINGS);
    expect(p.separateDaySuccessStreak).toBe(2);
    expect(p.dueDate).toBe('2026-08-27');
  });

  it('3回目成功後は mastered になり抜き打ち対象になる', () => {
    const p = applyWeakFirstAttempt(weakProgress(2), 'fast_correct', TODAY, DEFAULT_SETTINGS);
    expect(p.state).toBe('mastered');
    expect(p.dueDate).toBeNull();
    expect(p.nextAuditEligibleDate).toBe('2026-09-03'); // 14日後
  });

  it('設定値（間隔・卒業回数）が固定値でなく反映される', () => {
    const custom = {
      ...DEFAULT_SETTINGS,
      intervalAfterFirstSuccessDays: 5,
      intervalAfterSecondSuccessDays: 10,
      graduationSuccessCount: 2
    };
    const first = applyWeakFirstAttempt(weakProgress(0), 'fast_correct', TODAY, custom);
    expect(first.dueDate).toBe('2026-08-25');
    const graduated = applyWeakFirstAttempt(weakProgress(1), 'fast_correct', TODAY, custom);
    expect(graduated.state).toBe('mastered');
  });
});

describe('mastered の抜き打ち確認', () => {
  function masteredProgress(): WordProgress {
    return {
      ...createDefaultProgress('m1', '2026-08-01T00:00:00.000Z'),
      state: 'mastered',
      separateDaySuccessStreak: 3,
      dueDate: null
    };
  }

  it('抜き打ち即答で mastered を維持する', () => {
    const p = applyMasteredAudit(masteredProgress(), 'fast_correct', TODAY, DEFAULT_SETTINGS);
    expect(p.state).toBe('mastered');
    expect(p.dueDate).toBeNull();
    expect(p.lastAuditAt).toBe(TODAY);
    expect(p.nextAuditEligibleDate).toBe('2026-09-17'); // 28日後
  });

  it('抜き打ち遅答で weak へ戻り翌日が期限になる', () => {
    const p = applyMasteredAudit(masteredProgress(), 'slow_correct', TODAY, DEFAULT_SETTINGS);
    expect(p.state).toBe('weak');
    expect(p.separateDaySuccessStreak).toBe(0);
    expect(p.dueDate).toBe('2026-08-21');
  });

  it('抜き打ち不正解で weak へ戻る', () => {
    const p = applyMasteredAudit(masteredProgress(), 'wrong', TODAY, DEFAULT_SETTINGS);
    expect(p.state).toBe('weak');
    expect(p.dueDate).toBe('2026-08-21');
    expect(p.lapseCount).toBe(1);
  });
});

describe('診断結果', () => {
  it('即答は mastered になる', () => {
    const p = applyDiagnosisResult(
      createDefaultProgress('d1', '2026-08-01T00:00:00.000Z'),
      'fast_correct',
      TODAY,
      DEFAULT_SETTINGS
    );
    expect(p.state).toBe('mastered');
    expect(p.nextAuditEligibleDate).toBe('2026-09-03');
  });

  it('遅答・不正解は weak になり翌日復習へ', () => {
    for (const result of ['slow_correct', 'wrong'] as const) {
      const p = applyDiagnosisResult(
        createDefaultProgress('d1', '2026-08-01T00:00:00.000Z'),
        result,
        TODAY,
        DEFAULT_SETTINGS
      );
      expect(p.state).toBe('weak');
      expect(p.dueDate).toBe('2026-08-21');
    }
  });
});
