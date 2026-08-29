import { describe, expect, it } from 'vitest';
import { buildDailyQueue, buildDiagnosisQueue } from '../domain/queueBuilder';
import {
  createDefaultProgress,
  DEFAULT_SETTINGS,
  type Word,
  type WordProgress,
  type WordState
} from '../domain/types';
import { mulberry32 } from '../utils/random';

const TODAY = '2026-08-20';

function makeWord(n: number): Word {
  return {
    id: `word-${n}`,
    number: n,
    word: `word${n}`,
    meaning: `意味${n}`,
    tags: [],
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z'
  };
}

function makeProgress(
  n: number,
  state: WordState,
  patch: Partial<WordProgress> = {}
): WordProgress {
  return {
    ...createDefaultProgress(`word-${n}`, '2026-08-01T00:00:00.000Z'),
    state,
    ...patch
  };
}

function build(words: Word[], progress: WordProgress[], settings = DEFAULT_SETTINGS) {
  return buildDailyQueue(words, progress, settings, TODAY, { rng: mulberry32(7) });
}

describe('毎日のキュー生成', () => {
  it('同一単語が初回出題として重複しない', () => {
    const words = Array.from({ length: 150 }, (_, i) => makeWord(i + 1));
    const progress = words.map((_, i) =>
      makeProgress(i + 1, 'weak', { dueDate: TODAY })
    );
    const result = build(words, progress);
    expect(new Set(result.queueWordIds).size).toBe(result.queueWordIds.length);
  });

  it('期限超過 weak が優先される', () => {
    const words = Array.from({ length: 120 }, (_, i) => makeWord(i + 1));
    const progress: WordProgress[] = [];
    // 110語の weak（うち10語は期限超過）
    for (let i = 1; i <= 110; i++) {
      progress.push(
        makeProgress(i, 'weak', { dueDate: i <= 10 ? '2026-08-15' : TODAY })
      );
    }
    const result = build(words, progress);
    expect(result.queueWordIds.length).toBe(100);
    for (let i = 1; i <= 10; i++) {
      expect(result.queueWordIds).toContain(`word-${i}`);
    }
  });

  it('weak が100語を超える場合は抜き打ちが入らない', () => {
    const words = Array.from({ length: 150 }, (_, i) => makeWord(i + 1));
    const progress: WordProgress[] = [];
    for (let i = 1; i <= 120; i++) progress.push(makeProgress(i, 'weak', { dueDate: TODAY }));
    for (let i = 121; i <= 150; i++) progress.push(makeProgress(i, 'mastered'));
    const result = build(words, progress);
    expect(result.auditCount).toBe(0);
    expect(result.weakCount).toBe(100);
    expect(result.remainingWeakCount).toBe(20);
  });

  it('weak が少ない場合は mastered で補充される', () => {
    const words = Array.from({ length: 200 }, (_, i) => makeWord(i + 1));
    const progress: WordProgress[] = [];
    for (let i = 1; i <= 30; i++) progress.push(makeProgress(i, 'weak', { dueDate: TODAY }));
    for (let i = 31; i <= 200; i++) progress.push(makeProgress(i, 'mastered'));
    const result = build(words, progress);
    expect(result.weakCount).toBe(30);
    expect(result.auditCount).toBe(70);
    expect(result.queueWordIds.length).toBe(100);
  });

  it('weak が80語以下なら抜き打ちは既定20語 + 不足分の補充', () => {
    const words = Array.from({ length: 200 }, (_, i) => makeWord(i + 1));
    const progress: WordProgress[] = [];
    for (let i = 1; i <= 80; i++) progress.push(makeProgress(i, 'weak', { dueDate: TODAY }));
    for (let i = 81; i <= 200; i++) progress.push(makeProgress(i, 'mastered'));
    const result = build(words, progress);
    expect(result.weakCount).toBe(80);
    expect(result.auditCount).toBe(20);
  });

  it('archived は出題されない', () => {
    const words = [makeWord(1), makeWord(2)];
    const progress = [
      makeProgress(1, 'archived', { dueDate: TODAY }),
      makeProgress(2, 'weak', { dueDate: TODAY })
    ];
    const result = build(words, progress);
    expect(result.queueWordIds).toEqual(['word-2']);
  });

  it('未診断は通常復習へ勝手に入らない', () => {
    const words = [makeWord(1), makeWord(2)];
    const progress = [makeProgress(1, 'unassessed'), makeProgress(2, 'weak', { dueDate: TODAY })];
    const result = build(words, progress);
    expect(result.queueWordIds).toEqual(['word-2']);
  });

  it('期限が未来の weak は出題されない', () => {
    const words = [makeWord(1)];
    const progress = [makeProgress(1, 'weak', { dueDate: '2026-08-25' })];
    const result = build(words, progress);
    expect(result.queueWordIds).toEqual([]);
  });

  it('本文が未入力の単語は出題されない', () => {
    const empty: Word = { ...makeWord(1), word: '' };
    const progress = [makeProgress(1, 'weak', { dueDate: TODAY })];
    const result = build([empty], progress);
    expect(result.queueWordIds).toEqual([]);
  });

  it('抜き打ちは最短間隔が明けていない mastered より明けている語を優先する', () => {
    const words = Array.from({ length: 30 }, (_, i) => makeWord(i + 1));
    const progress: WordProgress[] = [];
    for (let i = 1; i <= 15; i++) {
      progress.push(makeProgress(i, 'mastered', { nextAuditEligibleDate: '2026-08-10' }));
    }
    for (let i = 16; i <= 30; i++) {
      progress.push(makeProgress(i, 'mastered', { nextAuditEligibleDate: '2026-09-10' }));
    }
    const settings = { ...DEFAULT_SETTINGS, dailyTarget: 10, auditTarget: 10 };
    const result = build(words, progress, settings);
    expect(result.queueWordIds.length).toBe(10);
    for (const id of result.queueWordIds) {
      const num = Number(id.replace('word-', ''));
      expect(num).toBeLessThanOrEqual(15);
    }
  });
});

describe('診断キュー生成', () => {
  const words = Array.from({ length: 50 }, (_, i) => makeWord(i + 1));

  it('範囲と語数で絞り込める', () => {
    const queue = buildDiagnosisQueue(words, [], {
      startNumber: 10,
      endNumber: 20,
      count: 5,
      order: 'sequential',
      unassessedOnly: false,
      excludeWeak: false,
      excludeMastered: false
    });
    expect(queue).toEqual(['word-10', 'word-11', 'word-12', 'word-13', 'word-14']);
  });

  it('未診断のみ・状態除外が効く', () => {
    const progress = [
      makeProgress(1, 'weak'),
      makeProgress(2, 'mastered'),
      makeProgress(3, 'unassessed')
    ];
    const queue = buildDiagnosisQueue(words.slice(0, 3), progress, {
      startNumber: 1,
      endNumber: 3,
      count: 10,
      order: 'sequential',
      unassessedOnly: true,
      excludeWeak: false,
      excludeMastered: false
    });
    expect(queue).toEqual(['word-3']);
  });
});
