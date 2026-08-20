import Dexie, { type Table } from 'dexie';
import type {
  AppSettings,
  Attempt,
  RetestQueueItem,
  StudySession,
  Word,
  WordProgress
} from '../domain/types';
import { applyMigrations } from './migrations';

export interface SettingsRow {
  id: string;
  value: AppSettings;
}

export class VocabDatabase extends Dexie {
  words!: Table<Word, string>;
  progress!: Table<WordProgress, string>;
  sessions!: Table<StudySession, string>;
  attempts!: Table<Attempt, string>;
  retestQueue!: Table<RetestQueueItem, string>;
  settings!: Table<SettingsRow, string>;

  constructor(name = 'vocab-review-pwa') {
    super(name);
    applyMigrations(this);
  }
}

export const db = new VocabDatabase();
