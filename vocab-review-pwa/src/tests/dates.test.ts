import { describe, expect, it } from 'vitest';
import { addDaysStr, diffDays, isDue, isOverdue, todayStr } from '../utils/dates';

describe('日付ユーティリティ', () => {
  it('todayStr は YYYY-MM-DD 形式', () => {
    expect(todayStr(new Date(2026, 7, 20))).toBe('2026-08-20');
  });

  it('addDaysStr は月またぎを正しく処理する', () => {
    expect(addDaysStr('2026-08-30', 3)).toBe('2026-09-02');
    expect(addDaysStr('2026-12-31', 1)).toBe('2027-01-01');
  });

  it('diffDays', () => {
    expect(diffDays('2026-08-23', '2026-08-20')).toBe(3);
  });

  it('isDue / isOverdue', () => {
    expect(isDue('2026-08-20', '2026-08-20')).toBe(true);
    expect(isDue('2026-08-21', '2026-08-20')).toBe(false);
    expect(isDue(null, '2026-08-20')).toBe(false);
    expect(isOverdue('2026-08-19', '2026-08-20')).toBe(true);
    expect(isOverdue('2026-08-20', '2026-08-20')).toBe(false);
  });
});
