import { db } from './database';
import {
  createDefaultProgress,
  DEFAULT_SETTINGS,
  type AppSettings,
  type Attempt,
  type RetestQueueItem,
  type StudySession,
  type Word,
  type WordProgress
} from '../domain/types';
import { newId } from '../utils/ids';
import { nowIso } from '../utils/dates';

// ---------- Words ----------

export async function getAllWords(): Promise<Word[]> {
  return db.words.orderBy('number').toArray();
}

export async function getWord(id: string): Promise<Word | undefined> {
  return db.words.get(id);
}

export async function putWord(word: Word): Promise<void> {
  await db.transaction('rw', db.words, db.progress, async () => {
    await db.words.put(word);
    const existing = await db.progress.get(word.id);
    if (!existing) {
      await db.progress.put(createDefaultProgress(word.id, nowIso()));
    }
  });
}

export async function bulkPutWords(words: Word[]): Promise<void> {
  await db.transaction('rw', db.words, db.progress, async () => {
    await db.words.bulkPut(words);
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
  await db.transaction('rw', db.words, db.progress, db.attempts, db.retestQueue, async () => {
    await db.words.delete(id);
    await db.progress.delete(id);
    await db.attempts.where('wordId').equals(id).delete();
    await db.retestQueue.where('wordId').equals(id).delete();
  });
}

export async function wordCount(): Promise<number> {
  return db.words.count();
}

/** 1〜count の空レコードを作成する（単語・意味は後から入力） */
export async function createEmptyDataset(count: number): Promise<number> {
  const now = nowIso();
  const existing = await getAllWords();
  const existingNumbers = new Set(existing.map((w) => w.number));
  const words: Word[] = [];
  for (let n = 1; n <= count; n++) {
    if (existingNumbers.has(n)) continue;
    words.push({
      id: newId(),
      number: n,
      word: '',
      meaning: '',
      tags: [],
      createdAt: now,
      updatedAt: now
    });
  }
  await bulkPutWords(words);
  return words.length;
}

// ---------- Progress ----------

export async function getAllProgress(): Promise<WordProgress[]> {
  return db.progress.toArray();
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

export async function getActiveSession(): Promise<StudySession | undefined> {
  return db.sessions.where('status').equals('active').first();
}

export async function getSession(id: string): Promise<StudySession | undefined> {
  return db.sessions.get(id);
}

export async function putSession(session: StudySession): Promise<void> {
  await db.sessions.put(session);
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

export async function getAllAttempts(): Promise<Attempt[]> {
  return db.attempts.toArray();
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
  version: 1;
  exportedAt: string;
  words: Word[];
  progress: WordProgress[];
  sessions: StudySession[];
  attempts: Attempt[];
  retestQueue: RetestQueueItem[];
  settings: AppSettings;
}

export async function exportBackup(): Promise<BackupPayload> {
  return {
    app: 'vocab-review-pwa',
    version: 1,
    exportedAt: nowIso(),
    words: await db.words.toArray(),
    progress: await db.progress.toArray(),
    sessions: await db.sessions.toArray(),
    attempts: await db.attempts.toArray(),
    retestQueue: await db.retestQueue.toArray(),
    settings: await loadSettings()
  };
}

export function isValidBackup(data: unknown): data is BackupPayload {
  if (typeof data !== 'object' || data === null) return false;
  const d = data as Record<string, unknown>;
  return (
    d.app === 'vocab-review-pwa' &&
    Array.isArray(d.words) &&
    Array.isArray(d.progress) &&
    typeof d.settings === 'object'
  );
}

export async function importBackup(payload: BackupPayload): Promise<void> {
  await db.transaction(
    'rw',
    [db.words, db.progress, db.sessions, db.attempts, db.retestQueue, db.settings],
    async () => {
      await Promise.all([
        db.words.clear(),
        db.progress.clear(),
        db.sessions.clear(),
        db.attempts.clear(),
        db.retestQueue.clear()
      ]);
      await db.words.bulkPut(payload.words);
      await db.progress.bulkPut(payload.progress);
      await db.sessions.bulkPut(payload.sessions ?? []);
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
    [db.words, db.progress, db.sessions, db.attempts, db.retestQueue, db.settings],
    async () => {
      await Promise.all([
        db.words.clear(),
        db.progress.clear(),
        db.sessions.clear(),
        db.attempts.clear(),
        db.retestQueue.clear(),
        db.settings.clear()
      ]);
    }
  );
}
