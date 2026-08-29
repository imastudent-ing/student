import { create } from 'zustand';
import { db } from '../db/database';
import {
  attemptsForSession,
  firstAttemptedWordIds,
  getActiveSession,
  getAllProgress,
  getAllWords,
  getProgress,
  hasFirstAttemptOfDay,
  retestItemsForSession,
  sameDayAttemptCount
} from '../db/repositories';
import { gradeAttempt, gradeRetest } from '../domain/grading';
import {
  buildDailyQueue,
  buildDiagnosisQueue,
  type DiagnosisConfig
} from '../domain/queueBuilder';
import { applyRetestAnswer, createRetestItem, findDueRetest, pendingRetests } from '../domain/retest';
import {
  applyDiagnosisResult,
  applyMasteredAudit,
  applyWeakFirstAttempt,
  bumpFirstAttemptCounters,
  bumpRetestCounters
} from '../domain/scheduling';
import {
  createEmptySummary,
  type AppSettings,
  type Attempt,
  type AttemptPhase,
  type AttemptResult,
  type Judgment,
  type RetestQueueItem,
  type StudySession,
  type Word,
  type WordProgress
} from '../domain/types';
import { newId } from '../utils/ids';
import { nowIso, todayStr } from '../utils/dates';
import { useSettingsStore } from './settingsStore';

export interface CurrentCard {
  kind: 'first' | 'retest' | 'pronunciation';
  wordId: string;
  phase: AttemptPhase;
  retestItemId?: string;
  retestCount?: number;
}

interface UndoSnapshot {
  expiresAt: number;
  attemptId: string;
  progressBefore: WordProgress;
  sessionBefore: StudySession;
  retestItemBefore: RetestQueueItem | null;
  retestAddedId: string | null;
  card: CurrentCard;
  elapsedMs: number | null;
  pronunciationUnknown: boolean;
}

interface SessionStore {
  session: StudySession | null;
  retestItems: RetestQueueItem[];
  wordsCache: Map<string, Word>;
  currentCard: CurrentCard | null;
  currentProgress: WordProgress | null;
  revealed: boolean;
  shownAtMs: number | null;
  elapsedMs: number | null;
  judgedResult: AttemptResult | null;
  pronunciationUnknown: boolean;
  carryOverNotice: boolean;
  undoSnapshot: UndoSnapshot | null;
  finishedSessionId: string | null;
  busy: boolean;

  startDailySession: () => Promise<string | null>;
  startExtraSession: () => Promise<string | null>;
  startDiagnosisSession: (config: DiagnosisConfig) => Promise<string | null>;
  startPronunciationSession: () => Promise<string | null>;
  resumeSession: () => Promise<boolean>;
  reveal: () => void;
  togglePronunciationUnknown: () => void;
  judge: (judgment: Judgment) => Promise<void>;
  markPronunciationChecked: (checked: boolean) => Promise<void>;
  next: () => Promise<void>;
  undo: () => Promise<void>;
  completeSession: () => Promise<void>;
  abandonSession: () => Promise<void>;
  clearFinished: () => void;
}

function settings(): AppSettings {
  return useSettingsStore.getState().settings;
}

function computeCard(
  session: StudySession,
  retestItems: RetestQueueItem[]
): CurrentCard | null {
  if (session.customKind === 'pronunciation') {
    if (session.currentQueueIndex < session.queueWordIds.length) {
      return {
        kind: 'pronunciation',
        wordId: session.queueWordIds[session.currentQueueIndex],
        phase: 'pronunciation'
      };
    }
    return null;
  }
  const due = findDueRetest(retestItems, session.presentedCardCount);
  if (due) {
    return {
      kind: 'retest',
      wordId: due.wordId,
      phase: 'same_day_retest',
      retestItemId: due.id,
      retestCount: due.retestCount
    };
  }
  if (session.currentQueueIndex < session.queueWordIds.length) {
    return { kind: 'first', wordId: session.queueWordIds[session.currentQueueIndex], phase: 'daily_first' };
  }
  // 通常出題終了後の「再テスト時間」: 解放位置に達していなくてもまとめて出す
  const pending = pendingRetests(retestItems);
  if (pending.length > 0) {
    const item = pending[0];
    return {
      kind: 'retest',
      wordId: item.wordId,
      phase: 'same_day_retest',
      retestItemId: item.id,
      retestCount: item.retestCount
    };
  }
  return null;
}

async function abandonActive(): Promise<void> {
  const active = await getActiveSession();
  if (active) {
    active.status = 'abandoned';
    active.updatedAt = nowIso();
    await db.sessions.put(active);
  }
}

async function loadWordCache(wordIds: string[]): Promise<Map<string, Word>> {
  const words = await db.words.bulkGet(wordIds);
  const map = new Map<string, Word>();
  words.forEach((w) => {
    if (w) map.set(w.id, w);
  });
  return map;
}

export const useSessionStore = create<SessionStore>((set, get) => {
  async function presentCard(session: StudySession, retestItems: RetestQueueItem[]) {
    const card = computeCard(session, retestItems);
    if (!card) {
      await finishSession('completed');
      return;
    }
    const state = get();
    if (!state.wordsCache.has(card.wordId)) {
      const extra = await loadWordCache([card.wordId]);
      const merged = new Map(state.wordsCache);
      extra.forEach((w, id) => merged.set(id, w));
      set({ wordsCache: merged });
    }
    const progress = await getProgress(card.wordId);
    // 初回カードの実フェーズは提示時点の状態で決める
    if (card.kind === 'first') {
      if (session.mode === 'diagnosis') card.phase = 'diagnosis';
      else card.phase = progress.state === 'mastered' ? 'audit_first' : 'daily_first';
    }
    set({
      session,
      retestItems,
      currentCard: card,
      currentProgress: progress,
      revealed: false,
      shownAtMs: Date.now(),
      elapsedMs: null,
      judgedResult: null,
      pronunciationUnknown: false,
      carryOverNotice: false,
      busy: false
    });
  }

  async function startSession(
    mode: StudySession['mode'],
    queueWordIds: string[],
    customKind?: StudySession['customKind']
  ): Promise<string | null> {
    if (queueWordIds.length === 0) return null;
    await abandonActive();
    const now = nowIso();
    const session: StudySession = {
      id: newId(),
      localStudyDate: todayStr(),
      mode,
      customKind,
      status: 'active',
      plannedFirstAttemptCount: queueWordIds.length,
      completedFirstAttemptCount: 0,
      queueWordIds,
      currentQueueIndex: 0,
      presentedCardCount: 0,
      summary: createEmptySummary(),
      startedAt: now,
      completedAt: null,
      updatedAt: now
    };
    await db.sessions.put(session);
    const wordsCache = await loadWordCache(queueWordIds);
    set({
      wordsCache,
      retestItems: [],
      finishedSessionId: null,
      undoSnapshot: null
    });
    await presentCard(session, []);
    return session.id;
  }

  async function finishSession(status: 'completed' | 'abandoned') {
    const { session } = get();
    if (!session) return;
    const updated: StudySession = {
      ...session,
      status,
      completedAt: nowIso(),
      updatedAt: nowIso()
    };
    await db.sessions.put(updated);
    set({
      session: null,
      currentCard: null,
      currentProgress: null,
      retestItems: [],
      revealed: false,
      judgedResult: null,
      undoSnapshot: null,
      finishedSessionId: status === 'completed' ? updated.id : null,
      busy: false
    });
  }

  return {
    session: null,
    retestItems: [],
    wordsCache: new Map(),
    currentCard: null,
    currentProgress: null,
    revealed: false,
    shownAtMs: null,
    elapsedMs: null,
    judgedResult: null,
    pronunciationUnknown: false,
    carryOverNotice: false,
    undoSnapshot: null,
    finishedSessionId: null,
    busy: false,

    startDailySession: async () => {
      const s = settings();
      const today = todayStr();
      const [words, progressList, attempted] = await Promise.all([
        getAllWords(),
        getAllProgress(),
        firstAttemptedWordIds(today)
      ]);
      const result = buildDailyQueue(words, progressList, s, today, {
        excludeWordIds: attempted
      });
      return startSession('daily', result.queueWordIds);
    },

    startExtraSession: async () => {
      const s = settings();
      const today = todayStr();
      const [words, progressList, attempted] = await Promise.all([
        getAllWords(),
        getAllProgress(),
        firstAttemptedWordIds(today)
      ]);
      const result = buildDailyQueue(words, progressList, s, today, {
        excludeWordIds: attempted
      });
      return startSession('custom', result.queueWordIds, 'extra');
    },

    startDiagnosisSession: async (config) => {
      const [words, progressList] = await Promise.all([getAllWords(), getAllProgress()]);
      const queue = buildDiagnosisQueue(words, progressList, config);
      return startSession('diagnosis', queue);
    },

    startPronunciationSession: async () => {
      const progressList = await getAllProgress();
      const words = await getAllWords();
      const wordMap = new Map(words.map((w) => [w.id, w]));
      const queue = progressList
        .filter((p) => p.pronunciationState === 'needs_review')
        .map((p) => p.wordId)
        .filter((id) => {
          const w = wordMap.get(id);
          return w !== undefined && w.word.trim() !== '';
        });
      return startSession('custom', queue, 'pronunciation');
    },

    resumeSession: async () => {
      const session = await getActiveSession();
      if (!session) return false;
      const retestItems = await retestItemsForSession(session.id);
      const wordIds = [...new Set([...session.queueWordIds, ...retestItems.map((r) => r.wordId)])];
      const wordsCache = await loadWordCache(wordIds);
      set({ wordsCache, finishedSessionId: null, undoSnapshot: null });
      await presentCard(session, retestItems);
      return true;
    },

    reveal: () => {
      const { revealed, shownAtMs, currentCard } = get();
      if (revealed || !currentCard || shownAtMs === null) return;
      set({ revealed: true, elapsedMs: Date.now() - shownAtMs });
    },

    togglePronunciationUnknown: () => {
      set({ pronunciationUnknown: !get().pronunciationUnknown });
    },

    judge: async (judgment: Judgment) => {
      const state = get();
      const { session, currentCard, retestItems } = state;
      if (!session || !currentCard || state.busy || state.judgedResult !== null) return;
      if (currentCard.kind === 'pronunciation') return;
      // 「分からない」は答えを見る前でも押せる
      if (!state.revealed && judgment !== 'dont_know') return;
      set({ busy: true });

      const appSettings = settings();
      const today = session.localStudyDate;
      const now = nowIso();
      const elapsedMs =
        state.elapsedMs ?? (state.shownAtMs !== null ? Date.now() - state.shownAtMs : null);
      const isRetest = currentCard.kind === 'retest';
      const result: AttemptResult = isRetest
        ? gradeRetest(judgment)
        : gradeAttempt(judgment, elapsedMs, appSettings.fastThresholdMs);

      const progressBefore = await getProgress(currentCard.wordId);
      const sessionBefore: StudySession = JSON.parse(JSON.stringify(session));
      const attemptCountToday = await sameDayAttemptCount(currentCard.wordId, today);
      const firstOfDay =
        !isRetest && !(await hasFirstAttemptOfDay(currentCard.wordId, today));

      const attempt: Attempt = {
        id: newId(),
        sessionId: session.id,
        wordId: currentCard.wordId,
        localStudyDate: today,
        phase: isRetest ? 'same_day_retest' : currentCard.phase,
        result,
        responseTimeMs: isRetest ? null : elapsedMs,
        pronunciationUnknown: state.pronunciationUnknown,
        answerRevealed: state.revealed,
        attemptNumberSameDay: attemptCountToday + 1,
        isFirstAttemptOfDay: firstOfDay,
        createdAt: now
      };

      let progress: WordProgress = { ...progressBefore };
      const summary = JSON.parse(JSON.stringify(session.summary)) as StudySession['summary'];
      const newPresented = session.presentedCardCount + 1;
      let retestItemBefore: RetestQueueItem | null = null;
      let retestAddedId: string | null = null;
      let updatedRetestItems = retestItems;
      let carryOverNotice = false;

      const pushUnique = (arr: string[], id: string) => {
        if (!arr.includes(id)) arr.push(id);
      };

      if (isRetest && currentCard.retestItemId) {
        const item = retestItems.find((r) => r.id === currentCard.retestItemId);
        if (item) {
          retestItemBefore = { ...item };
          const correct = result !== 'wrong';
          const updatedItem = applyRetestAnswer(item, correct, newPresented, appSettings);
          updatedRetestItems = retestItems.map((r) => (r.id === item.id ? updatedItem : r));
          progress = bumpRetestCounters(progress, correct);
          if (correct) {
            pushUnique(summary.retestCorrectWordIds, currentCard.wordId);
          } else if (updatedItem.carriedOver) {
            carryOverNotice = true;
          }
          await db.retestQueue.put(updatedItem);
        }
      } else if (firstOfDay) {
        const prevState = progress.state;
        if (currentCard.phase === 'diagnosis') {
          progress = applyDiagnosisResult(progress, result, today, appSettings);
        } else if (currentCard.phase === 'audit_first') {
          progress = applyMasteredAudit(progress, result, today, appSettings);
        } else {
          progress = applyWeakFirstAttempt(progress, result, today, appSettings);
        }
        progress = bumpFirstAttemptCounters(progress, result);
        progress.lastFirstAttemptDate = today;

        if (result === 'fast_correct') summary.firstFast++;
        else if (result === 'slow_correct') summary.firstSlow++;
        else summary.firstWrong++;
        if (progress.state === 'weak' && prevState !== 'weak') {
          pushUnique(summary.newlyWeakWordIds, currentCard.wordId);
        }
        if (progress.state === 'mastered' && prevState === 'weak') {
          pushUnique(summary.graduatedWordIds, currentCard.wordId);
        }
        if (result !== 'fast_correct') {
          pushUnique(summary.carryOverWordIds, currentCard.wordId);
        }

        // 遅答・不正解は同日再テストへ
        if (result !== 'fast_correct') {
          const item = createRetestItem(session.id, currentCard.wordId, newPresented, appSettings);
          retestAddedId = item.id;
          updatedRetestItems = [...retestItems, item];
          pushUnique(summary.retestTargetWordIds, currentCard.wordId);
          await db.retestQueue.put(item);
        }
      }

      if (state.pronunciationUnknown) {
        progress.pronunciationState = 'needs_review';
        pushUnique(summary.pronunciationFlaggedWordIds, currentCard.wordId);
      }
      progress.lastSeenAt = now;
      progress.updatedAt = now;

      const updatedSession: StudySession = {
        ...session,
        presentedCardCount: newPresented,
        currentQueueIndex:
          currentCard.kind === 'first' ? session.currentQueueIndex + 1 : session.currentQueueIndex,
        completedFirstAttemptCount:
          currentCard.kind === 'first'
            ? session.completedFirstAttemptCount + 1
            : session.completedFirstAttemptCount,
        summary,
        updatedAt: now
      };

      await db.transaction('rw', [db.attempts, db.progress, db.sessions], async () => {
        await db.attempts.put(attempt);
        await db.progress.put(progress);
        await db.sessions.put(updatedSession);
      });

      set({
        session: updatedSession,
        retestItems: updatedRetestItems,
        currentProgress: progress,
        judgedResult: result,
        revealed: true,
        carryOverNotice,
        undoSnapshot: {
          expiresAt: Date.now() + 5000,
          attemptId: attempt.id,
          progressBefore,
          sessionBefore,
          retestItemBefore,
          retestAddedId,
          card: currentCard,
          elapsedMs,
          pronunciationUnknown: state.pronunciationUnknown
        },
        busy: false
      });
    },

    markPronunciationChecked: async (checked: boolean) => {
      const { session, currentCard } = get();
      if (!session || !currentCard || currentCard.kind !== 'pronunciation') return;
      const now = nowIso();
      const progress = await getProgress(currentCard.wordId);
      if (checked) {
        progress.pronunciationState = 'ok';
        progress.lastSeenAt = now;
        progress.updatedAt = now;
        await db.progress.put(progress);
        await db.attempts.put({
          id: newId(),
          sessionId: session.id,
          wordId: currentCard.wordId,
          localStudyDate: session.localStudyDate,
          phase: 'pronunciation',
          result: 'fast_correct',
          responseTimeMs: null,
          pronunciationUnknown: false,
          answerRevealed: true,
          attemptNumberSameDay: 1,
          isFirstAttemptOfDay: false,
          createdAt: now
        });
      }
      const updatedSession: StudySession = {
        ...session,
        currentQueueIndex: session.currentQueueIndex + 1,
        presentedCardCount: session.presentedCardCount + 1,
        completedFirstAttemptCount: session.completedFirstAttemptCount + 1,
        updatedAt: now
      };
      await db.sessions.put(updatedSession);
      await presentCard(updatedSession, get().retestItems);
    },

    next: async () => {
      const { session, retestItems, judgedResult } = get();
      if (!session || judgedResult === null) return;
      await presentCard(session, retestItems);
    },

    undo: async () => {
      const snap = get().undoSnapshot;
      if (!snap || Date.now() > snap.expiresAt) return;
      await db.transaction(
        'rw',
        [db.attempts, db.progress, db.sessions, db.retestQueue],
        async () => {
          await db.attempts.delete(snap.attemptId);
          await db.progress.put(snap.progressBefore);
          await db.sessions.put(snap.sessionBefore);
          if (snap.retestAddedId) await db.retestQueue.delete(snap.retestAddedId);
          if (snap.retestItemBefore) await db.retestQueue.put(snap.retestItemBefore);
        }
      );
      const retestItems = await retestItemsForSession(snap.sessionBefore.id);
      set({
        session: snap.sessionBefore,
        retestItems,
        currentCard: snap.card,
        currentProgress: snap.progressBefore,
        revealed: true,
        elapsedMs: snap.elapsedMs,
        shownAtMs: null,
        judgedResult: null,
        pronunciationUnknown: snap.pronunciationUnknown,
        carryOverNotice: false,
        undoSnapshot: null
      });
    },

    completeSession: async () => finishSession('completed'),
    abandonSession: async () => finishSession('abandoned'),
    clearFinished: () => set({ finishedSessionId: null })
  };
});

/** セッション終了画面用の集計 */
export async function loadSessionAttempts(sessionId: string): Promise<Attempt[]> {
  return attemptsForSession(sessionId);
}
