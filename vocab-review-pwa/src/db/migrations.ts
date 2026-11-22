import type Dexie from 'dexie';
import { DEFAULT_BOOK_ID } from '../domain/types';

/**
 * スキーマ定義とマイグレーション。
 * スキーマを変更する場合は version を上げて upgrade を書く。
 */
export function applyMigrations(db: Dexie): void {
  db.version(1).stores({
    words: 'id, number, word',
    progress: 'wordId, state, dueDate, pronunciationState, nextAuditEligibleDate',
    sessions: 'id, status, localStudyDate, startedAt',
    attempts: 'id, sessionId, wordId, localStudyDate, [wordId+localStudyDate], createdAt',
    retestQueue: 'id, sessionId, wordId, completed',
    settings: 'id'
  });
  db.version(2)
    .stores({
      books: 'id, createdAt',
      preferences: 'id',
      words: 'id, number, word, bookId, [bookId+number]',
      sessions: 'id, status, localStudyDate, startedAt, bookId, [bookId+status]'
    })
    .upgrade(async (tx) => {
      const now = new Date().toISOString();
      await tx.table('books').put({
        id: DEFAULT_BOOK_ID,
        name: 'これまでの単語帳',
        createdAt: now,
        updatedAt: now
      });
      await tx.table('preferences').put({ id: 'activeBookId', value: DEFAULT_BOOK_ID });
      await tx.table('words').toCollection().modify({ bookId: DEFAULT_BOOK_ID });
      await tx.table('sessions').toCollection().modify({ bookId: DEFAULT_BOOK_ID });
    });
}
