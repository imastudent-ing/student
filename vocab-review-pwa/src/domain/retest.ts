import type { AppSettings, RetestQueueItem } from './types';
import { randomInteger, type Rng } from '../utils/random';
import { newId } from '../utils/ids';
import { nowIso } from '../utils/dates';

/** 再テストの解放位置（現在位置から 10〜20 枚後） */
export function nextRetestReleasePosition(
  currentPresentedCount: number,
  settings: AppSettings,
  rng: Rng = Math.random
): number {
  const gap = randomInteger(settings.retestGapMin, settings.retestGapMax, rng);
  return currentPresentedCount + gap;
}

/** 遅答・不正解の発生時に再テストカードを作成する */
export function createRetestItem(
  sessionId: string,
  wordId: string,
  currentPresentedCount: number,
  settings: AppSettings,
  rng: Rng = Math.random
): RetestQueueItem {
  const now = nowIso();
  return {
    id: newId(),
    sessionId,
    wordId,
    releaseAfterQueuePosition: nextRetestReleasePosition(currentPresentedCount, settings, rng),
    retestCount: 0,
    completed: false,
    createdAt: now,
    updatedAt: now
  };
}

/** 未完了の再テストのうち、現在位置で解放済みのものを返す */
export function findDueRetest(
  items: RetestQueueItem[],
  presentedCount: number
): RetestQueueItem | undefined {
  return pendingRetests(items).find((r) => r.releaseAfterQueuePosition <= presentedCount);
}

export function pendingRetests(items: RetestQueueItem[]): RetestQueueItem[] {
  return items
    .filter((r) => !r.completed)
    .sort((a, b) => {
      if (a.releaseAfterQueuePosition !== b.releaseAfterQueuePosition) {
        return a.releaseAfterQueuePosition - b.releaseAfterQueuePosition;
      }
      return a.createdAt < b.createdAt ? -1 : 1;
    });
}

/**
 * 再テストの回答結果を反映した新しいアイテムを返す。
 * - 正解: 完了（その日はそれ以上出さない）
 * - 不正解: 回数を増やし、最大回数未満なら 10〜20 枚後へ再挿入。
 *   最大回数に達したら完了扱い + 翌日持ち越しフラグ。
 */
export function applyRetestAnswer(
  item: RetestQueueItem,
  correct: boolean,
  currentPresentedCount: number,
  settings: AppSettings,
  rng: Rng = Math.random
): RetestQueueItem {
  const now = nowIso();
  if (correct) {
    return { ...item, completed: true, retestCount: item.retestCount + 1, updatedAt: now };
  }
  const nextCount = item.retestCount + 1;
  if (nextCount >= settings.maxSameDayRetests) {
    return {
      ...item,
      retestCount: nextCount,
      completed: true,
      carriedOver: true,
      updatedAt: now
    };
  }
  return {
    ...item,
    retestCount: nextCount,
    releaseAfterQueuePosition: nextRetestReleasePosition(currentPresentedCount, settings, rng),
    updatedAt: now
  };
}
