import type { AppSettings, Word, WordProgress } from './types';
import { diffDays, isDue } from '../utils/dates';
import { shuffle, weightedSample, type Rng } from '../utils/random';

export interface DailyQueueResult {
  queueWordIds: string[];
  weakCount: number;
  auditCount: number;
  /** 今日の枠に入りきらなかった期限到来 weak の数 */
  remainingWeakCount: number;
}

export interface BuildQueueOptions {
  /** 今日すでに初回回答済みなどで除外する単語 */
  excludeWordIds?: Set<string>;
  rng?: Rng;
}

/** 出題できる単語か（本文が入力済みで archived でない） */
function isQuizzable(word: Word): boolean {
  return word.word.trim() !== '' && word.meaning.trim() !== '';
}

/**
 * 毎日の出題キューを生成する。
 * 1. 期限到来（超過含む）の weak を優先
 * 2. 余った枠に mastered の抜き打ち（最終確認が古い語を優先した重み付き抽出）
 * 3. weak が 1 日の上限を超える場合は抜き打ちを行わない
 */
export function buildDailyQueue(
  words: Word[],
  progressList: WordProgress[],
  settings: AppSettings,
  today: string,
  options: BuildQueueOptions = {}
): DailyQueueResult {
  const rng = options.rng ?? Math.random;
  const exclude = options.excludeWordIds ?? new Set<string>();
  const wordMap = new Map(words.map((w) => [w.id, w]));

  const usable = progressList.filter((p) => {
    const w = wordMap.get(p.wordId);
    return w !== undefined && isQuizzable(w) && !exclude.has(p.wordId) && p.state !== 'archived';
  });

  // 1. 期限到来 weak（期限が古い順 → 失敗回数が多い順 → 最終出題が古い順 → ランダム）
  const dueWeak = usable.filter((p) => p.state === 'weak' && isDue(p.dueDate ?? today, today));
  const shuffledWeak = shuffle(dueWeak, rng);
  shuffledWeak.sort((a, b) => {
    const dueA = a.dueDate ?? '0000-00-00';
    const dueB = b.dueDate ?? '0000-00-00';
    if (dueA !== dueB) return dueA < dueB ? -1 : 1;
    if (a.lapseCount !== b.lapseCount) return b.lapseCount - a.lapseCount;
    const seenA = a.lastSeenAt ?? '';
    const seenB = b.lastSeenAt ?? '';
    if (seenA !== seenB) return seenA < seenB ? -1 : 1;
    return 0;
  });

  const dailyTarget = settings.dailyTarget;
  let weakSelected: WordProgress[];
  let auditSelected: WordProgress[] = [];

  if (shuffledWeak.length > dailyTarget) {
    // weak が上限超: weak のみ、抜き打ちなし
    weakSelected = shuffledWeak.slice(0, dailyTarget);
  } else {
    weakSelected = shuffledWeak;
    const auditSlots = dailyTarget - weakSelected.length;
    if (auditSlots > 0) {
      const masteredAll = usable.filter((p) => p.state === 'mastered');
      const eligible = masteredAll.filter(
        (p) => p.nextAuditEligibleDate === null || p.nextAuditEligibleDate <= today
      );
      const weight = (p: WordProgress) => {
        const lastChecked = p.lastAuditAt ?? p.lastFirstAttemptDate ?? p.createdAt.slice(0, 10);
        const age = Math.max(diffDays(today, lastChecked), 0);
        return age + 1 + p.totalWrong * 2;
      };
      // まず通常の抜き打ち枠（既定20語）を eligible から重み付き抽出
      const normalAuditCount = Math.min(settings.auditTarget, auditSlots, eligible.length);
      auditSelected = weightedSample(eligible, weight, normalAuditCount, rng);
      // 合計が上限に届かない場合は mastered をさらに追加（最終確認が古い順）
      const fillSlots = auditSlots - auditSelected.length;
      if (fillSlots > 0) {
        const selectedIds = new Set(auditSelected.map((p) => p.wordId));
        const rest = masteredAll.filter((p) => !selectedIds.has(p.wordId));
        const restEligible = rest.filter(
          (p) => p.nextAuditEligibleDate === null || p.nextAuditEligibleDate <= today
        );
        const restIneligible = rest.filter(
          (p) => p.nextAuditEligibleDate !== null && p.nextAuditEligibleDate > today
        );
        const byOldest = (list: WordProgress[]) =>
          shuffle(list, rng).sort((a, b) => {
            const aAt = a.lastAuditAt ?? '';
            const bAt = b.lastAuditAt ?? '';
            if (aAt !== bAt) return aAt < bAt ? -1 : 1;
            return b.totalWrong - a.totalWrong;
          });
        auditSelected = auditSelected.concat(
          [...byOldest(restEligible), ...byOldest(restIneligible)].slice(0, fillSlots)
        );
      }
    }
  }

  // 重複除去
  const combined = [...weakSelected, ...auditSelected];
  const seen = new Set<string>();
  const unique = combined.filter((p) => {
    if (seen.has(p.wordId)) return false;
    seen.add(p.wordId);
    return true;
  });

  // 出題順シャッフル（番号連続の分散を含む）
  let ordered = settings.shuffleEnabled ? shuffle(unique, rng) : unique;
  if (settings.shuffleEnabled) {
    ordered = disperseAdjacentNumbers(ordered, wordMap);
  }

  return {
    queueWordIds: ordered.map((p) => p.wordId),
    weakCount: weakSelected.length,
    auditCount: auditSelected.length,
    remainingWeakCount: Math.max(shuffledWeak.length - weakSelected.length, 0)
  };
}

/** 連続した単語番号が隣り合わないよう、可能な範囲で入れ替える */
function disperseAdjacentNumbers(
  list: WordProgress[],
  wordMap: Map<string, Word>
): WordProgress[] {
  const arr = [...list];
  const num = (p: WordProgress) => wordMap.get(p.wordId)?.number ?? 0;
  for (let i = 0; i < arr.length - 1; i++) {
    if (Math.abs(num(arr[i]) - num(arr[i + 1])) === 1) {
      for (let j = i + 2; j < arr.length; j++) {
        if (
          Math.abs(num(arr[i]) - num(arr[j])) !== 1 &&
          (j + 1 >= arr.length || Math.abs(num(arr[j + 1]) - num(arr[i + 1])) !== 1)
        ) {
          [arr[i + 1], arr[j]] = [arr[j], arr[i + 1]];
          break;
        }
      }
    }
  }
  return arr;
}

export interface DiagnosisConfig {
  startNumber: number;
  endNumber: number;
  count: number;
  order: 'sequential' | 'random';
  unassessedOnly: boolean;
  excludeWeak: boolean;
  excludeMastered: boolean;
}

/** 診断モードの出題キューを生成する */
export function buildDiagnosisQueue(
  words: Word[],
  progressList: WordProgress[],
  config: DiagnosisConfig,
  rng: Rng = Math.random
): string[] {
  const progressMap = new Map(progressList.map((p) => [p.wordId, p]));
  let candidates = words.filter(
    (w) => isQuizzable(w) && w.number >= config.startNumber && w.number <= config.endNumber
  );
  candidates = candidates.filter((w) => {
    const p = progressMap.get(w.id);
    const state = p?.state ?? 'unassessed';
    if (state === 'archived') return false;
    if (config.unassessedOnly && state !== 'unassessed') return false;
    if (config.excludeWeak && state === 'weak') return false;
    if (config.excludeMastered && state === 'mastered') return false;
    return true;
  });
  if (config.order === 'random') {
    candidates = shuffle(candidates, rng);
  } else {
    candidates.sort((a, b) => a.number - b.number);
  }
  return candidates.slice(0, config.count).map((w) => w.id);
}
