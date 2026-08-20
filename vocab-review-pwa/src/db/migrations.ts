import type Dexie from 'dexie';

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
}
