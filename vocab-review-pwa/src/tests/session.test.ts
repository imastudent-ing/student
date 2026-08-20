import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../db/database';
import { useSessionStore } from '../stores/sessionStore';
import { useSettingsStore } from '../stores/settingsStore';
import {
  createDefaultProgress,
  DEFAULT_SETTINGS,
  type Word,
  type WordProgress,
  type WordState
} from '../domain/types';
import { exportBackup, importBackup } from '../db/repositories';

const DAY1 = new Date(2026, 7, 20, 9, 0, 0); // 2026-08-20
const DAY2 = new Date(2026, 7, 21, 9, 0, 0);

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

async function seedWord(
  n: number,
  state: WordState,
  patch: Partial<WordProgress> = {}
): Promise<void> {
  await db.words.put(makeWord(n));
  await db.progress.put({
    ...createDefaultProgress(`word-${n}`, '2026-08-01T00:00:00.000Z'),
    state,
    ...patch
  });
}

function resetStore(): void {
  useSessionStore.setState({
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
    busy: false
  });
}

/** 現在のカードに回答して次へ進む */
async function answer(
  judgment: 'correct' | 'ambiguous' | 'wrong' | 'dont_know',
  elapsedMs = 1000
): Promise<void> {
  const store = useSessionStore.getState();
  store.reveal();
  useSessionStore.setState({ elapsedMs });
  await useSessionStore.getState().judge(judgment);
  await useSessionStore.getState().next();
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(DAY1);
  await Promise.all([
    db.words.clear(),
    db.progress.clear(),
    db.sessions.clear(),
    db.attempts.clear(),
    db.retestQueue.clear(),
    db.settings.clear()
  ]);
  resetStore();
  useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS }, loaded: true });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('学習セッション', () => {
  it('弱点単語の即答で別日連続成功数が増え、3日後が期限になる', async () => {
    await seedWord(1, 'weak', { dueDate: '2026-08-20' });
    const id = await useSessionStore.getState().startDailySession();
    expect(id).not.toBeNull();
    await answer('correct', 1000);
    const p = await db.progress.get('word-1');
    expect(p?.separateDaySuccessStreak).toBe(1);
    expect(p?.dueDate).toBe('2026-08-23');
    // 1語だけなのでセッション完了
    expect(useSessionStore.getState().finishedSessionId).not.toBeNull();
  });

  it('遅答で再テストへ追加され、再テスト正解でも成功数・期限・初回統計が変わらない', async () => {
    await seedWord(1, 'weak', { dueDate: '2026-08-20', separateDaySuccessStreak: 2 });
    const sessionId = await useSessionStore.getState().startDailySession();
    await answer('ambiguous'); // 遅答

    let p = await db.progress.get('word-1');
    expect(p?.separateDaySuccessStreak).toBe(0);
    expect(p?.dueDate).toBe('2026-08-21');

    // キューは尽きたので「再テスト時間」として同じ単語が出る
    const card = useSessionStore.getState().currentCard;
    expect(card?.kind).toBe('retest');
    expect(card?.wordId).toBe('word-1');
    await answer('correct');

    p = await db.progress.get('word-1');
    expect(p?.separateDaySuccessStreak).toBe(0); // 再テストでは増えない
    expect(p?.dueDate).toBe('2026-08-21'); // 翌日復習は取り消されない
    expect(p?.totalRetestCorrect).toBe(1);

    const session = await db.sessions.get(sessionId!);
    expect(session?.summary.firstFast).toBe(0);
    expect(session?.summary.firstSlow).toBe(1); // 初回統計は遅答のまま
    expect(session?.summary.retestCorrectWordIds).toEqual(['word-1']);
    expect(session?.status).toBe('completed');
  });

  it('同じ日に2回正解しても成功数は1回しか増えない', async () => {
    await seedWord(1, 'weak', { dueDate: '2026-08-20' });
    await useSessionStore.getState().startDailySession();
    await answer('correct');
    expect((await db.progress.get('word-1'))?.separateDaySuccessStreak).toBe(1);

    // 同日に診断モードで同じ単語へもう一度正解
    resetStore();
    await useSessionStore.getState().startDiagnosisSession({
      startNumber: 1,
      endNumber: 10,
      count: 10,
      order: 'sequential',
      unassessedOnly: false,
      excludeWeak: false,
      excludeMastered: false
    });
    expect(useSessionStore.getState().currentCard?.wordId).toBe('word-1');
    await answer('correct');

    const p = await db.progress.get('word-1');
    expect(p?.separateDaySuccessStreak).toBe(1); // 増えない
    const attempts = await db.attempts.where('wordId').equals('word-1').toArray();
    expect(attempts.filter((a) => a.isFirstAttemptOfDay).length).toBe(1);
  });

  it('翌日の初回即答では成功数が増える', async () => {
    await seedWord(1, 'weak', { dueDate: '2026-08-20' });
    await useSessionStore.getState().startDailySession();
    await answer('ambiguous'); // 遅答 → streak 0, 翌日期限
    const retestCard = useSessionStore.getState().currentCard;
    expect(retestCard?.kind).toBe('retest');
    await answer('correct');

    vi.setSystemTime(DAY2);
    resetStore();
    await useSessionStore.getState().startDailySession();
    expect(useSessionStore.getState().currentCard?.wordId).toBe('word-1');
    await answer('correct');
    const p = await db.progress.get('word-1');
    expect(p?.separateDaySuccessStreak).toBe(1);
  });

  it('セッション途中で日付をまたいでも開始日の学習として扱う', async () => {
    await seedWord(1, 'weak', { dueDate: '2026-08-20' });
    await seedWord(2, 'weak', { dueDate: '2026-08-20' });
    await useSessionStore.getState().startDailySession();
    await answer('correct');
    vi.setSystemTime(DAY2); // 日付をまたぐ
    await answer('correct');
    const attempts = await db.attempts.toArray();
    expect(attempts.length).toBe(2);
    for (const a of attempts) {
      expect(a.localStudyDate).toBe('2026-08-20');
    }
  });

  it('抜き打ちで遅答すると weak へ戻り翌日期限になる', async () => {
    await seedWord(1, 'mastered', { nextAuditEligibleDate: '2026-08-15' });
    await useSessionStore.getState().startDailySession();
    const card = useSessionStore.getState().currentCard;
    expect(card?.phase).toBe('audit_first');
    await answer('ambiguous');
    const p = await db.progress.get('word-1');
    expect(p?.state).toBe('weak');
    expect(p?.dueDate).toBe('2026-08-21');
    expect(p?.separateDaySuccessStreak).toBe(0);
  });

  it('リロード後にセッションと再テストキューを再開できる', async () => {
    for (let i = 1; i <= 3; i++) await seedWord(i, 'weak', { dueDate: '2026-08-20' });
    const sessionId = await useSessionStore.getState().startDailySession();
    const firstWordId = useSessionStore.getState().currentCard?.wordId;
    await answer('wrong'); // 再テストへ

    // リロードを模擬
    resetStore();
    const resumed = await useSessionStore.getState().resumeSession();
    expect(resumed).toBe(true);
    const state = useSessionStore.getState();
    expect(state.session?.id).toBe(sessionId);
    expect(state.session?.completedFirstAttemptCount).toBe(1);
    expect(state.retestItems.length).toBe(1);
    expect(state.retestItems[0].wordId).toBe(firstWordId);
    // 回答済みカードは再び出ない
    expect(state.currentCard?.wordId).not.toBe(firstWordId);
  });

  it('直前の回答を元に戻せる', async () => {
    await seedWord(1, 'weak', { dueDate: '2026-08-20', separateDaySuccessStreak: 1 });
    await seedWord(2, 'weak', { dueDate: '2026-08-20' });
    await useSessionStore.getState().startDailySession();
    const wordId = useSessionStore.getState().currentCard!.wordId;
    useSessionStore.getState().reveal();
    useSessionStore.setState({ elapsedMs: 1000 });
    await useSessionStore.getState().judge('wrong');
    expect((await db.attempts.toArray()).length).toBe(1);
    expect((await db.retestQueue.toArray()).length).toBe(1);

    await useSessionStore.getState().undo();
    expect((await db.attempts.toArray()).length).toBe(0);
    expect((await db.retestQueue.toArray()).length).toBe(0);
    const p = await db.progress.get(wordId);
    expect(p?.lapseCount).toBe(0);
    expect(useSessionStore.getState().currentCard?.wordId).toBe(wordId);
    expect(useSessionStore.getState().session?.presentedCardCount).toBe(0);
  });

  it('発音不明フラグで発音状態が needs_review になる', async () => {
    await seedWord(1, 'weak', { dueDate: '2026-08-20' });
    await useSessionStore.getState().startDailySession();
    useSessionStore.getState().togglePronunciationUnknown();
    await answer('correct');
    const p = await db.progress.get('word-1');
    expect(p?.pronunciationState).toBe('needs_review');
    expect(p?.separateDaySuccessStreak).toBe(1); // 意味の判定とは独立
  });
});

describe('JSONバックアップ', () => {
  it('バックアップから復元できる', async () => {
    await seedWord(1, 'weak', { dueDate: '2026-08-20', separateDaySuccessStreak: 2 });
    const backup = await exportBackup();
    await Promise.all([db.words.clear(), db.progress.clear()]);
    expect(await db.words.count()).toBe(0);
    await importBackup(backup);
    expect(await db.words.count()).toBe(1);
    const p = await db.progress.get('word-1');
    expect(p?.separateDaySuccessStreak).toBe(2);
    expect(p?.state).toBe('weak');
  });
});
