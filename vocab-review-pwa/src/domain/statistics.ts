import type { Attempt, Word, WordProgress } from './types';

export interface DailyStat {
  date: string;
  fast: number;
  slow: number;
  wrong: number;
  total: number;
  /** 初回即答率（%） */
  fastRate: number;
}

/** 日別の初回回答統計（同日再テストは含めない） */
export function dailyFirstAttemptStats(attempts: Attempt[]): DailyStat[] {
  const byDate = new Map<string, { fast: number; slow: number; wrong: number }>();
  for (const a of attempts) {
    if (!a.isFirstAttemptOfDay || a.phase === 'same_day_retest' || a.phase === 'pronunciation') {
      continue;
    }
    const entry = byDate.get(a.localStudyDate) ?? { fast: 0, slow: 0, wrong: 0 };
    if (a.result === 'fast_correct') entry.fast++;
    else if (a.result === 'slow_correct') entry.slow++;
    else entry.wrong++;
    byDate.set(a.localStudyDate, entry);
  }
  return [...byDate.entries()]
    .map(([date, e]) => {
      const total = e.fast + e.slow + e.wrong;
      return {
        date,
        ...e,
        total,
        fastRate: total > 0 ? Math.round((e.fast / total) * 100) : 0
      };
    })
    .sort((a, b) => (a.date < b.date ? -1 : 1));
}

export interface WrongRankEntry {
  word: Word;
  progress: WordProgress;
  wrongTotal: number;
}

/** 頻繁に間違える単語ランキング */
export function frequentlyWrongWords(
  words: Word[],
  progressList: WordProgress[],
  limit: number
): WrongRankEntry[] {
  const wordMap = new Map(words.map((w) => [w.id, w]));
  return progressList
    .map((p) => ({
      word: wordMap.get(p.wordId),
      progress: p,
      wrongTotal: p.totalWrong + p.totalSlowCorrect
    }))
    .filter((e): e is WrongRankEntry => e.word !== undefined && e.wrongTotal > 0)
    .sort((a, b) => b.wrongTotal - a.wrongTotal)
    .slice(0, limit);
}

export interface RangeStat {
  label: string;
  start: number;
  end: number;
  total: number;
  mastered: number;
  weak: number;
  unassessed: number;
  masteredRate: number;
}

/** 範囲別の定着率 */
export function rangeMasteryStats(
  words: Word[],
  progressList: WordProgress[],
  ranges: Array<{ start: number; end: number }>
): RangeStat[] {
  const progressMap = new Map(progressList.map((p) => [p.wordId, p]));
  return ranges.map(({ start, end }) => {
    const inRange = words.filter((w) => w.number >= start && w.number <= end);
    let mastered = 0;
    let weak = 0;
    let unassessed = 0;
    for (const w of inRange) {
      const state = progressMap.get(w.id)?.state ?? 'unassessed';
      if (state === 'mastered') mastered++;
      else if (state === 'weak') weak++;
      else if (state === 'unassessed') unassessed++;
    }
    return {
      label: `${start}〜${end}`,
      start,
      end,
      total: inRange.length,
      mastered,
      weak,
      unassessed,
      masteredRate: inRange.length > 0 ? Math.round((mastered / inRange.length) * 100) : 0
    };
  });
}
