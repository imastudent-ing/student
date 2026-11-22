import { create } from 'zustand';
import {
  createBook,
  getActiveBookId,
  getBooks,
  renameBook,
  setActiveBookId
} from '../db/repositories';
import type { Book } from '../domain/types';
import { useSessionStore } from './sessionStore';

interface BookStore {
  books: Book[];
  activeBookId: string;
  loading: boolean;
  resetting: boolean;
  loaded: boolean;
  error: string | null;
  load: () => Promise<void>;
  create: (name: string) => Promise<void>;
  rename: (id: string, name: string) => Promise<void>;
  select: (id: string) => Promise<void>;
}

/** Persisted sessions remain available when returning to their book. */
function clearSessionView(): void {
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

function requireIdle(loading: boolean): void {
  if (loading || useSessionStore.getState().busy) {
    throw new Error('保存が終わってから単語帳を切り替えてください。');
  }
}

function bookName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('単語帳名を入力してください。');
  return trimmed;
}

let loadPromise: Promise<void> | null = null;

export const useBookStore = create<BookStore>((set, get) => ({
  books: [],
  activeBookId: '',
  loading: false,
  resetting: false,
  loaded: false,
  error: null,
  load: () => {
    if (loadPromise) return loadPromise;
    set({ loading: true, resetting: true, error: null });
    loadPromise = (async () => {
      try {
        const books = await getBooks();
        const activeBookId = await getActiveBookId();
        clearSessionView();
        set({ books, activeBookId, loaded: true, loading: false, resetting: false });
      } catch (error) {
        set({
          loading: false,
          resetting: false,
          error: error instanceof Error ? error.message : '単語帳の読み込みに失敗しました。'
        });
        throw error;
      } finally {
        loadPromise = null;
      }
    })();
    return loadPromise;
  },
  create: async (name) => {
    requireIdle(get().loading);
    const trimmed = bookName(name);
    set({ loading: true, resetting: true, error: null });
    try {
      const book = await createBook(trimmed);
      await setActiveBookId(book.id);
      const books = await getBooks();
      clearSessionView();
      set({ books, activeBookId: book.id, loading: false, resetting: false });
    } catch (error) {
      set({ loading: false, resetting: false });
      throw error;
    }
  },
  rename: async (id, name) => {
    requireIdle(get().loading);
    const trimmed = bookName(name);
    set({ loading: true, resetting: false, error: null });
    try {
      await renameBook(id, trimmed);
      const books = await getBooks();
      set({ books, loading: false });
    } catch (error) {
      set({ loading: false });
      throw error;
    }
  },
  select: async (id) => {
    requireIdle(get().loading);
    if (id === get().activeBookId) return;
    set({ loading: true, resetting: true, error: null });
    try {
      await setActiveBookId(id);
      clearSessionView();
      set({ activeBookId: id, loading: false, resetting: false });
    } catch (error) {
      set({ loading: false, resetting: false });
      throw error;
    }
  }
}));
