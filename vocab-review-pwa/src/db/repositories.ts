import { db } from './database';
import {
  createDefaultProgress,
  DEFAULT_BOOK_ID,
  DEFAULT_SETTINGS,
  type AppSettings,
  type Attempt,
  type Book,
  type RetestQueueItem,
  type StudySession,
  type Word,
  type WordProgress
} from '../domain/types';
import { newId } from '../utils/ids';
import { nowIso } from '../utils/dates';

const ACTIVE_BOOK_KEY = 'activeBookId';

async function ensureDefaultBook(): Promise<void> {
  await db.transaction('rw', db.books, async () => {
    if (!(await db.books.get(DEFAULT_BOOK_ID))) {
      const now = nowIso();
      await db.books.put({
        id: DEFAULT_BOOK_ID,
        name: 'これまでの単語帳',
        createdAt: now,
        updatedAt: now
      });
    }
  });
}

export async function getBooks(): Promise<Book[]> {
  await ensureDefaultBook();
  return db.books.orderBy('createdAt').toArray();
}

function cleanBookName(name: string): string {
  const clean = name.trim();
  if (!clean || clean.length > 100) throw new Error('単語帳名は1〜100文字で入力してください。');
  return clean;
}

export async function createBook(name: string): Promise<Book> {
  const clean = cleanBookName(name);
  await ensureDefaultBook();
  const now = nowIso();
  const book: Book = { id: newId(), name: clean, createdAt: now, updatedAt: now };
  await db.books.add(book);
  return book;
}

export async function renameBook(id: string, name: string): Promise<void> {
  const clean = cleanBookName(name);
  await ensureDefaultBook();
  const updated = await db.books.update(id, { name: clean, updatedAt: nowIso() });
  if (!updated) throw new Error('単語帳が見つかりません。');
}

export async function getActiveBookId(): Promise<string> {
  await ensureDefaultBook();
  const preference = await db.preferences.get(ACTIVE_BOOK_KEY);
  if (preference && (await db.books.get(preference.value))) return preference.value;
  await db.preferences.put({ id: ACTIVE_BOOK_KEY, value: DEFAULT_BOOK_ID });
  return DEFAULT_BOOK_ID;
}

export async function setActiveBookId(id: string): Promise<void> {
  await ensureDefaultBook();
  if (!(await db.books.get(id))) throw new Error('単語帳が見つかりません。');
  await db.preferences.put({ id: ACTIVE_BOOK_KEY, value: id });
}

async function resolveBookId(bookId?: string): Promise<string> {
  if (bookId === undefined) return getActiveBookId();
  await ensureDefaultBook();
  if (!(await db.books.get(bookId))) throw new Error('単語帳が見つかりません。');
  return bookId;
}

// ---------- Words ----------

export async function getAllWords(bookId?: string): Promise<Word[]> {
  const selected = await resolveBookId(bookId);
  return db.words.filter((w) => (w.bookId ?? DEFAULT_BOOK_ID) === selected).sortBy('number');
}

export async function getWord(id: string, bookId?: string): Promise<Word | undefined> {
  const selected = await resolveBookId(bookId);
  const word = await db.words.get(id);
  return word && (word.bookId ?? DEFAULT_BOOK_ID) === selected ? word : undefined;
}

export async function putWord(word: Word, bookId?: string): Promise<void> {
  const selected = await resolveBookId(word.bookId ?? bookId);
  await db.transaction('rw', db.words, db.progress, async () => {
    const stored = await db.words.get(word.id);
    await db.words.put({ ...word, bookId: stored ? stored.bookId ?? DEFAULT_BOOK_ID : selected });
    const existing = await db.progress.get(word.id);
    if (!existing) {
      await db.progress.put(createDefaultProgress(word.id, nowIso()));
    }
  });
}

export async function bulkPutWords(words: Word[], bookId?: string): Promise<void> {
  const selected = await resolveBookId(bookId);
  const knownBooks = new Set((await getBooks()).map((book) => book.id));
  if (words.some((word) => word.bookId !== undefined && !knownBooks.has(word.bookId))) {
    throw new Error('単語帳が見つかりません。');
  }
  await db.transaction('rw', db.words, db.progress, async () => {
    const storedWords = await db.words.bulkGet(words.map((word) => word.id));
    await db.words.bulkPut(words.map((word, i) => ({
      ...word,
      bookId: storedWords[i] ? storedWords[i]!.bookId ?? DEFAULT_BOOK_ID : word.bookId ?? selected
    })));
    const now = nowIso();
    const existingIds = new Set(await db.progress.toCollection().primaryKeys());
    const missing = words
      .filter((w) => !existingIds.has(w.id))
      .map((w) => createDefaultProgress(w.id, now));
    if (missing.length > 0) {
      await db.progress.bulkPut(missing);
    }
  });
}

export async function deleteWord(id: string): Promise<void> {
  if (!(await getWord(id))) return;
  await db.transaction('rw', db.words, db.progress, db.attempts, db.retestQueue, async () => {
    await db.words.delete(id);
    await db.progress.delete(id);
    await db.attempts.where('wordId').equals(id).delete();
    await db.retestQueue.where('wordId').equals(id).delete();
  });
}

export async function wordCount(bookId?: string): Promise<number> {
  return (await getAllWords(bookId)).length;
}

/** 1〜count の空レコードを作成する（単語・意味は後から入力） */
export async function createEmptyDataset(count: number, bookId?: string): Promise<number> {
  const selected = await resolveBookId(bookId);
  const now = nowIso();
  const existing = await getAllWords(selected);
  const existingNumbers = new Set(existing.map((w) => w.number));
  const words: Word[] = [];
  for (let n = 1; n <= count; n++) {
    if (existingNumbers.has(n)) continue;
    words.push({
      id: newId(),
      bookId: selected,
      number: n,
      word: '',
      meaning: '',
      tags: [],
      createdAt: now,
      updatedAt: now
    });
  }
  await bulkPutWords(words, selected);
  return words.length;
}

// ---------- Progress ----------

export async function getAllProgress(bookId?: string): Promise<WordProgress[]> {
  const ids = new Set((await getAllWords(bookId)).map((word) => word.id));
  return db.progress.filter((progress) => ids.has(progress.wordId)).toArray();
}

export async function getProgress(wordId: string): Promise<WordProgress> {
  const existing = await db.progress.get(wordId);
  if (existing) return existing;
  const created = createDefaultProgress(wordId, nowIso());
  await db.progress.put(created);
  return created;
}

export async function putProgress(progress: WordProgress): Promise<void> {
  await db.progress.put(progress);
}

// ---------- Sessions ----------

export async function getActiveSession(bookId?: string): Promise<StudySession | undefined> {
  const selected = await resolveBookId(bookId);
  return db.sessions.where('status').equals('active')
    .filter((session) => (session.bookId ?? DEFAULT_BOOK_ID) === selected).first();
}

export async function getSession(id: string, bookId?: string): Promise<StudySession | undefined> {
  const selected = await resolveBookId(bookId);
  const session = await db.sessions.get(id);
  return session && (session.bookId ?? DEFAULT_BOOK_ID) === selected ? session : undefined;
}

export async function putSession(session: StudySession, bookId?: string): Promise<void> {
  const selected = await resolveBookId(session.bookId ?? bookId);
  await db.transaction('rw', db.sessions, async () => {
    const stored = await db.sessions.get(session.id);
    await db.sessions.put({ ...session, bookId: stored ? stored.bookId ?? DEFAULT_BOOK_ID : selected });
  });
}

// ---------- Attempts ----------

export async function addAttempt(attempt: Attempt): Promise<void> {
  await db.attempts.put(attempt);
}

export async function deleteAttempt(id: string): Promise<void> {
  await db.attempts.delete(id);
}

/** その日にすでに初回回答があるか */
export async function hasFirstAttemptOfDay(
  wordId: string,
  localStudyDate: string
): Promise<boolean> {
  const attempts = await db.attempts
    .where('[wordId+localStudyDate]')
    .equals([wordId, localStudyDate])
    .toArray();
  return attempts.some((a) => a.isFirstAttemptOfDay);
}

/** その日にその単語を何回出題したか */
export async function sameDayAttemptCount(
  wordId: string,
  localStudyDate: string
): Promise<number> {
  return db.attempts.where('[wordId+localStudyDate]').equals([wordId, localStudyDate]).count();
}

export async function attemptsForSession(sessionId: string): Promise<Attempt[]> {
  return db.attempts.where('sessionId').equals(sessionId).sortBy('createdAt');
}

export async function attemptsForWord(wordId: string): Promise<Attempt[]> {
  const list = await db.attempts.where('wordId').equals(wordId).sortBy('createdAt');
  return list.reverse();
}

export async function getAllAttempts(bookId?: string): Promise<Attempt[]> {
  const ids = new Set((await getAllWords(bookId)).map((word) => word.id));
  return db.attempts.filter((attempt) => ids.has(attempt.wordId)).toArray();
}

/** その日に初回回答済みの単語 ID 集合 */
export async function firstAttemptedWordIds(localStudyDate: string): Promise<Set<string>> {
  const attempts = await db.attempts.where('localStudyDate').equals(localStudyDate).toArray();
  return new Set(attempts.filter((a) => a.isFirstAttemptOfDay).map((a) => a.wordId));
}

// ---------- Retest queue ----------

export async function retestItemsForSession(sessionId: string): Promise<RetestQueueItem[]> {
  return db.retestQueue.where('sessionId').equals(sessionId).toArray();
}

export async function putRetestItem(item: RetestQueueItem): Promise<void> {
  await db.retestQueue.put(item);
}

export async function deleteRetestItem(id: string): Promise<void> {
  await db.retestQueue.delete(id);
}

// ---------- Settings ----------

const SETTINGS_KEY = 'app';

export async function loadSettings(): Promise<AppSettings> {
  const row = await db.settings.get(SETTINGS_KEY);
  return { ...DEFAULT_SETTINGS, ...(row?.value ?? {}) };
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  await db.settings.put({ id: SETTINGS_KEY, value: settings });
}

// ---------- Backup / reset ----------

export interface BackupPayload {
  app: 'vocab-review-pwa';
  version: 1 | 2;
  exportedAt: string;
  books?: Book[];
  activeBookId?: string;
  words: Word[];
  progress: WordProgress[];
  sessions: StudySession[];
  attempts: Attempt[];
  retestQueue: RetestQueueItem[];
  settings: AppSettings;
}

export async function exportBackup(): Promise<BackupPayload> {
  const activeBookId = await getActiveBookId();
  return {
    app: 'vocab-review-pwa',
    version: 2,
    exportedAt: nowIso(),
    books: await getBooks(),
    activeBookId,
    words: (await db.words.toArray()).map((word) => ({ ...word, bookId: word.bookId ?? DEFAULT_BOOK_ID })),
    progress: await db.progress.toArray(),
    sessions: (await db.sessions.toArray()).map((session) => ({ ...session, bookId: session.bookId ?? DEFAULT_BOOK_ID })),
    attempts: await db.attempts.toArray(),
    retestQueue: await db.retestQueue.toArray(),
    settings: await loadSettings()
  };
}

export function isValidBackup(data: unknown): data is BackupPayload {
  const record = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value);
  const nonempty = (value: unknown): value is string => typeof value === 'string' && value.trim() !== '';
  const uniqueIds = (items: Array<Record<string, unknown>>, key = 'id') =>
    items.every((item) => nonempty(item[key])) && new Set(items.map((item) => item[key])).size === items.length;
  if (!record(data)) return false;
  if (data.app !== 'vocab-review-pwa' || (data.version !== 1 && data.version !== 2)) return false;
  if (!nonempty(data.exportedAt) || !record(data.settings)) return false;
  if (!Array.isArray(data.words) || !Array.isArray(data.progress)) return false;
  const optionalArrays = [data.sessions, data.attempts, data.retestQueue];
  if (optionalArrays.some((items) => items !== undefined && !Array.isArray(items))) return false;
  const words: unknown[] = data.words;
  const progress: unknown[] = data.progress;
  const sessions: unknown[] = Array.isArray(data.sessions) ? data.sessions : [];
  const attempts: unknown[] = Array.isArray(data.attempts) ? data.attempts : [];
  const retestQueue: unknown[] = Array.isArray(data.retestQueue) ? data.retestQueue : [];
  if (![...words, ...progress, ...sessions, ...attempts, ...retestQueue].every(record)) return false;
  const wordRows = words as Array<Record<string, unknown>>;
  const progressRows = progress as Array<Record<string, unknown>>;
  const sessionRows = sessions as Array<Record<string, unknown>>;
  const attemptRows = attempts as Array<Record<string, unknown>>;
  const retestRows = retestQueue as Array<Record<string, unknown>>;
  if (![wordRows, sessionRows, attemptRows, retestRows].every((rows) => uniqueIds(rows)) || !uniqueIds(progressRows, 'wordId')) return false;
  let bookIds = new Set([DEFAULT_BOOK_ID]);
  if (data.version === 2) {
    if (!Array.isArray(data.books) || data.books.length === 0 || !data.books.every(record)) return false;
    const books = data.books as Array<Record<string, unknown>>;
    if (!uniqueIds(books) || books.some((book) => !nonempty(book.name) || !nonempty(book.createdAt) || !nonempty(book.updatedAt))) return false;
    bookIds = new Set(books.map((book) => book.id as string));
    if (!nonempty(data.activeBookId) || !bookIds.has(data.activeBookId)) return false;
  }
  const bookFor = (row: Record<string, unknown>): string | undefined => {
    if (data.version === 1) return DEFAULT_BOOK_ID;
    return typeof row.bookId === 'string' ? row.bookId : undefined;
  };
  if ([...wordRows, ...sessionRows].some((row) => !bookIds.has(bookFor(row) ?? ''))) return false;
  if (wordRows.some((word) => !Number.isInteger(word.number) || Number(word.number) <= 0 || typeof word.word !== 'string' || typeof word.meaning !== 'string' || !Array.isArray(word.tags) || word.tags.some((tag) => typeof tag !== 'string'))) return false;
  const wordsById = new Map(wordRows.map((word) => [word.id, word]));
  const sessionsById = new Map(sessionRows.map((session) => [session.id, session]));
  if (progressRows.some((row) => !wordsById.has(row.wordId) || !['unassessed', 'weak', 'mastered', 'archived'].includes(String(row.state)))) return false;
  if (sessionRows.some((session) => {
    if (!Array.isArray(session.queueWordIds) || !record(session.summary) || !['active', 'completed', 'abandoned'].includes(String(session.status))) return true;
    const references = [session.queueWordIds, ...Object.values(session.summary).filter(Array.isArray)];
    return references.some((ids) => ids.some((id: unknown) => {
      if (typeof id !== 'string') return true;
      const word = wordsById.get(id);
      // 削除済み単語の履歴参照は残せるが、別の単語帳の単語は読み込ませない。
      return word !== undefined && bookFor(word) !== bookFor(session);
    }));
  })) return false;
  return [...attemptRows, ...retestRows].every((row) => {
    const word = wordsById.get(row.wordId);
    const session = sessionsById.get(row.sessionId);
    return word !== undefined && session !== undefined && bookFor(word) === bookFor(session);
  });
}

export async function importBackup(payload: BackupPayload): Promise<void> {
  if (!isValidBackup(payload)) throw new Error('このアプリのバックアップ形式ではありません。');
  const now = nowIso();
  const books = payload.version === 2 ? payload.books! : [{
    id: DEFAULT_BOOK_ID,
    name: 'これまでの単語帳',
    createdAt: now,
    updatedAt: now
  }];
  const words = payload.words.map((word) => ({ ...word, bookId: payload.version === 1 ? DEFAULT_BOOK_ID : word.bookId! }));
  const sessions = (payload.sessions ?? []).map((session) => ({ ...session, bookId: payload.version === 1 ? DEFAULT_BOOK_ID : session.bookId! }));
  await db.transaction(
    'rw',
    [db.words, db.progress, db.sessions, db.attempts, db.retestQueue, db.settings, db.books, db.preferences],
    async () => {
      await Promise.all([
        db.words.clear(),
        db.progress.clear(),
        db.sessions.clear(),
        db.attempts.clear(),
        db.retestQueue.clear(),
        db.books.clear(),
        db.preferences.clear()
      ]);
      await db.books.bulkPut(books);
      await db.preferences.put({ id: ACTIVE_BOOK_KEY, value: payload.version === 2 ? payload.activeBookId! : DEFAULT_BOOK_ID });
      await db.words.bulkPut(words);
      await db.progress.bulkPut(payload.progress);
      await db.sessions.bulkPut(sessions);
      await db.attempts.bulkPut(payload.attempts ?? []);
      await db.retestQueue.bulkPut(payload.retestQueue ?? []);
      await db.settings.put({
        id: SETTINGS_KEY,
        value: { ...DEFAULT_SETTINGS, ...payload.settings }
      });
    }
  );
}

/** 学習履歴のみリセットする（単語データは保持） */
export async function resetAllHistory(): Promise<void> {
  await db.transaction(
    'rw',
    [db.words, db.progress, db.sessions, db.attempts, db.retestQueue],
    async () => {
      await Promise.all([db.sessions.clear(), db.attempts.clear(), db.retestQueue.clear()]);
      const words = await db.words.toArray();
      const now = nowIso();
      await db.progress.clear();
      await db.progress.bulkPut(words.map((w) => createDefaultProgress(w.id, now)));
    }
  );
}

export async function deleteAllData(): Promise<void> {
  await db.transaction(
    'rw',
    [db.words, db.progress, db.sessions, db.attempts, db.retestQueue, db.settings, db.books, db.preferences],
    async () => {
      await Promise.all([
        db.words.clear(),
        db.progress.clear(),
        db.sessions.clear(),
        db.attempts.clear(),
        db.retestQueue.clear(),
        db.settings.clear(),
        db.books.clear(),
        db.preferences.clear()
      ]);
    }
  );
  await getActiveBookId();
}
