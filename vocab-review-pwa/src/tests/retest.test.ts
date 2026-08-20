import { describe, expect, it } from 'vitest';
import {
  applyRetestAnswer,
  createRetestItem,
  findDueRetest,
  nextRetestReleasePosition
} from '../domain/retest';
import { DEFAULT_SETTINGS } from '../domain/types';
import { mulberry32 } from '../utils/random';

describe('同日再テスト', () => {
  it('再テストは10〜20語後に解放される', () => {
    const rng = mulberry32(42);
    for (let i = 0; i < 200; i++) {
      const pos = nextRetestReleasePosition(100, DEFAULT_SETTINGS, rng);
      expect(pos).toBeGreaterThanOrEqual(110);
      expect(pos).toBeLessThanOrEqual(120);
    }
  });

  it('遅答・不正解後に再テストアイテムが作成される', () => {
    const item = createRetestItem('s1', 'w1', 5, DEFAULT_SETTINGS, mulberry32(1));
    expect(item.wordId).toBe('w1');
    expect(item.completed).toBe(false);
    expect(item.retestCount).toBe(0);
    expect(item.releaseAfterQueuePosition).toBeGreaterThanOrEqual(15);
    expect(item.releaseAfterQueuePosition).toBeLessThanOrEqual(25);
  });

  it('解放位置に達するまで出題されない', () => {
    const item = { ...createRetestItem('s1', 'w1', 0, DEFAULT_SETTINGS, mulberry32(1)) };
    item.releaseAfterQueuePosition = 15;
    expect(findDueRetest([item], 14)).toBeUndefined();
    expect(findDueRetest([item], 15)).toBe(item);
  });

  it('正解で完了し、その日はそれ以上出題されない', () => {
    const item = createRetestItem('s1', 'w1', 0, DEFAULT_SETTINGS, mulberry32(1));
    const updated = applyRetestAnswer(item, true, 20, DEFAULT_SETTINGS, mulberry32(2));
    expect(updated.completed).toBe(true);
    expect(updated.carriedOver).toBeUndefined();
    expect(findDueRetest([updated], 999)).toBeUndefined();
  });

  it('不正解で10〜20語後へ再挿入される', () => {
    const item = createRetestItem('s1', 'w1', 0, DEFAULT_SETTINGS, mulberry32(1));
    const updated = applyRetestAnswer(item, false, 30, DEFAULT_SETTINGS, mulberry32(2));
    expect(updated.completed).toBe(false);
    expect(updated.retestCount).toBe(1);
    expect(updated.releaseAfterQueuePosition).toBeGreaterThanOrEqual(40);
    expect(updated.releaseAfterQueuePosition).toBeLessThanOrEqual(50);
  });

  it('3回失敗すると翌日へ持ち越しになる', () => {
    let item = createRetestItem('s1', 'w1', 0, DEFAULT_SETTINGS, mulberry32(1));
    item = applyRetestAnswer(item, false, 10, DEFAULT_SETTINGS, mulberry32(2));
    item = applyRetestAnswer(item, false, 25, DEFAULT_SETTINGS, mulberry32(3));
    expect(item.completed).toBe(false);
    item = applyRetestAnswer(item, false, 40, DEFAULT_SETTINGS, mulberry32(4));
    expect(item.completed).toBe(true);
    expect(item.carriedOver).toBe(true);
    expect(item.retestCount).toBe(3);
  });
});
