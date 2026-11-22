import Dexie from 'dexie';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { db, VocabDatabase } from '../db/database';
import {
  addAttempt,
  bulkPutWords,
  createBook,
  createEmptyDataset,
  deleteAllData,
  exportBackup,
  getActiveBookId,
  getActiveSession,
  getAllAttempts,
  getAllProgress,
  getAllWords,
  getBooks,
  getSession,
  getWord,
  importBackup,
  isValidBackup,
  putSession,
  putWord,
  renameBook,
  resetAllHistory,
  setActiveBookId,
  wordCount
} from '../db/repositories';
import {
  createDefaultProgress,
  createEmptySummary,
  DEFAULT_BOOK_ID,
  type Attempt,
  type StudySession,
  type Word
} from '../domain/types';

const NOW = '2026-11-22T00:00:00.000Z';

function word(id: string, number = 1): Word {
  return { id, number, word: id, meaning: `意味 ${id}`, tags: [], createdAt: NOW, updatedAt: NOW };
}

function session(id: string, wordId: string): StudySession {
  return {
    id,
    localStudyDate: '2026-11-22',
    mode: 'daily',
    status: 'active',
    plannedFirstAttemptCount: 1,
    completedFirstAttemptCount: 0,
    queueWordIds: [wordId],
    currentQueueIndex: 0,
    presentedCardCount: 0,
    summary: createEmptySummary(),
    startedAt: NOW,
    completedAt: null,
    updatedAt: NOW
  };
}

function attempt(id: string, wordId: string, sessionId: string): Attempt {
  return {
    id, wordId, sessionId, localStudyDate: '2026-11-22', phase: 'daily_first',
    result: 'fast_correct', responseTimeMs: 500, pronunciationUnknown: false,
    answerRevealed: true, attemptNumberSameDay: 1, isFirstAttemptOfDay: true,
    createdAt: NOW
  };
}

beforeEach(async () => { await deleteAllData(); });
afterEach(async () => { await deleteAllData(); });

describe('単語帳ごとのデータ', () => {
  it('既定の単語帳を作成し、名前と選択中の単語帳を保存する', async () => {
    expect(await getActiveBookId()).toBe(DEFAULT_BOOK_ID);
    expect((await getBooks()).map((book) => book.name)).toEqual(['これまでの単語帳']);
    const book = await createBook('  熟語  ');
    await renameBook(book.id, '熟語100');
    await setActiveBookId(book.id);
    expect(await getActiveBookId()).toBe(book.id);
    expect((await getBooks()).find((item) => item.id === book.id)?.name).toBe('熟語100');
    await expect(setActiveBookId('missing')).rejects.toThrow();
    await expect(createBook('   ')).rejects.toThrow();
  });

  it('同じ番号を別の単語帳に登録し、一覧・進捗・履歴を分離する', async () => {
    await putWord(word('old'));
    await putSession(session('old-session', 'old'));
    await addAttempt(attempt('old-attempt', 'old', 'old-session'));
    const book = await createBook('熟語');
    await setActiveBookId(book.id);
    await putWord(word('idiom'));
    await putSession(session('idiom-session', 'idiom'));
    await addAttempt(attempt('idiom-attempt', 'idiom', 'idiom-session'));
    expect((await getAllWords()).map((item) => item.id)).toEqual(['idiom']);
    expect((await getAllProgress()).map((item) => item.wordId)).toEqual(['idiom']);
    expect((await getAllAttempts()).map((item) => item.id)).toEqual(['idiom-attempt']);
    expect(await wordCount()).toBe(1);
    expect(await getWord('old')).toBeUndefined();
    expect(await getSession('old-session')).toBeUndefined();
    expect((await getActiveSession())?.id).toBe('idiom-session');
    expect((await getAllWords(DEFAULT_BOOK_ID)).map((item) => item.id)).toEqual(['old']);
    await setActiveBookId(DEFAULT_BOOK_ID);
    expect((await getActiveSession())?.id).toBe('old-session');
  });

  it('更新では元の単語帳を保ち、遅延した一括登録は取得時の単語帳に追加する', async () => {
    await putWord(word('old'));
    const book = await createBook('熟語');
    await setActiveBookId(book.id);
    await putWord({ ...word('old'), meaning: '更新後' });
    await bulkPutWords([word('delayed')], DEFAULT_BOOK_ID);
    expect(await wordCount()).toBe(0);
    expect((await getAllWords(DEFAULT_BOOK_ID)).map((item) => item.meaning)).toContain('更新後');
    expect((await db.words.get('delayed'))?.bookId).toBe(DEFAULT_BOOK_ID);
    await expect(bulkPutWords([{ ...word('invalid'), bookId: 'missing' }])).rejects.toThrow();
  });

  it('空レコードの番号重複を単語帳ごとに扱う', async () => {
    expect(await createEmptyDataset(2)).toBe(2);
    expect(await createEmptyDataset(2)).toBe(0);
    const book = await createBook('熟語');
    await setActiveBookId(book.id);
    expect(await createEmptyDataset(2)).toBe(2);
    expect(await db.words.count()).toBe(4);
  });

  it('全履歴リセットと全削除はすべての単語帳に適用する', async () => {
    await putWord(word('old'));
    const book = await createBook('熟語');
    await setActiveBookId(book.id);
    await putWord(word('idiom'));
    await db.progress.toCollection().modify({ state: 'mastered' });
    await resetAllHistory();
    expect((await db.progress.toArray()).every((item) => item.state === 'unassessed')).toBe(true);
    expect(await db.words.count()).toBe(2);
    await deleteAllData();
    expect(await db.words.count()).toBe(0);
    expect(await getActiveBookId()).toBe(DEFAULT_BOOK_ID);
    expect(await getBooks()).toHaveLength(1);
  });
});

describe('単語帳を含むバックアップ', () => {
  it('選択外の単語帳・進捗・セッションも含めて復元できる', async () => {
    await putWord(word('old'));
    await putSession(session('old-session', 'old'));
    await addAttempt(attempt('old-attempt', 'old', 'old-session'));
    const book = await createBook('熟語');
    await setActiveBookId(book.id);
    await putWord(word('idiom'));
    await putSession(session('idiom-session', 'idiom'));
    await db.progress.update('old', { state: 'weak', separateDaySuccessStreak: 2 });
    const backup = await exportBackup();
    expect(backup.version).toBe(2);
    expect(backup.words).toHaveLength(2);
    expect(backup.books).toHaveLength(2);
    expect(isValidBackup(backup)).toBe(true);
    await deleteAllData();
    await importBackup(backup);
    expect(await getActiveBookId()).toBe(book.id);
    expect((await getAllWords()).map((item) => item.id)).toEqual(['idiom']);
    expect((await db.progress.get('old'))?.separateDaySuccessStreak).toBe(2);
    expect((await getActiveSession(DEFAULT_BOOK_ID))?.id).toBe('old-session');
  });

  it('v1バックアップを既定の単語帳へ復元し、IDと進捗を保つ', async () => {
    await putWord(word('old'));
    await putSession(session('old-session', 'old'));
    const backup = await exportBackup();
    backup.version = 1;
    delete backup.books;
    delete backup.activeBookId;
    backup.words.forEach((item) => { delete item.bookId; });
    backup.sessions.forEach((item) => { delete item.bookId; });
    expect(isValidBackup(backup)).toBe(true);
    await createBook('置き換え前');
    await importBackup(backup);
    expect(await getBooks()).toHaveLength(1);
    expect((await getWord('old'))?.bookId).toBe(DEFAULT_BOOK_ID);
    expect((await getSession('old-session'))?.bookId).toBe(DEFAULT_BOOK_ID);
    expect((await db.progress.get('old'))?.wordId).toBe('old');
  });

  it('存在しない単語帳の参照を含むバックアップを、現データを消さずに拒否する', async () => {
    await putWord(word('old'));
    const backup = await exportBackup();
    backup.words[0].bookId = 'missing';
    expect(isValidBackup(backup)).toBe(false);
    await expect(importBackup(backup)).rejects.toThrow();
    expect((await getWord('old'))?.word).toBe('old');
    backup.words[0].bookId = DEFAULT_BOOK_ID;
    backup.activeBookId = 'missing';
    expect(isValidBackup(backup)).toBe(false);
  });

  it('セッションから別の単語帳の単語への参照を拒否し、削除済み単語の履歴は許可する', async () => {
    await putWord(word('old'));
    await putSession(session('old-session', 'old'));
    const book = await createBook('熟語');
    await setActiveBookId(book.id);
    await putWord(word('idiom'));
    const backup = await exportBackup();
    backup.sessions[0].queueWordIds = ['idiom'];
    expect(isValidBackup(backup)).toBe(false);
    await expect(importBackup(backup)).rejects.toThrow();
    backup.sessions[0].queueWordIds = ['old'];
    backup.sessions[0].summary.carryOverWordIds = ['idiom'];
    expect(isValidBackup(backup)).toBe(false);
    backup.sessions[0].queueWordIds = ['deleted-word'];
    backup.sessions[0].summary.carryOverWordIds = ['deleted-word'];
    expect(isValidBackup(backup)).toBe(true);
    await importBackup(backup);
    expect((await db.sessions.get('old-session'))?.queueWordIds).toEqual(['deleted-word']);
  });
});

it('v1データベースを更新して単語・進捗・セッションのIDを維持する', async () => {
  const name = `migration-${crypto.randomUUID()}`;
  const legacy = new Dexie(name);
  legacy.version(1).stores({
    words: 'id, number, word',
    progress: 'wordId, state, dueDate, pronunciationState, nextAuditEligibleDate',
    sessions: 'id, status, localStudyDate, startedAt',
    attempts: 'id, sessionId, wordId, localStudyDate, [wordId+localStudyDate], createdAt',
    retestQueue: 'id, sessionId, wordId, completed',
    settings: 'id'
  });
  await legacy.table('words').put(word('legacy-word'));
  await legacy.table('progress').put({ ...createDefaultProgress('legacy-word', NOW), state: 'weak', separateDaySuccessStreak: 2 });
  await legacy.table('sessions').put(session('legacy-session', 'legacy-word'));
  legacy.close();
  const upgraded = new VocabDatabase(name);
  try {
    expect((await upgraded.words.get('legacy-word'))?.bookId).toBe(DEFAULT_BOOK_ID);
    expect((await upgraded.progress.get('legacy-word'))?.separateDaySuccessStreak).toBe(2);
    expect((await upgraded.sessions.get('legacy-session'))?.bookId).toBe(DEFAULT_BOOK_ID);
    expect((await upgraded.preferences.get('activeBookId'))?.value).toBe(DEFAULT_BOOK_ID);
    expect((await upgraded.books.get(DEFAULT_BOOK_ID))?.name).toBe('これまでの単語帳');
  } finally {
    await upgraded.delete();
  }
});
