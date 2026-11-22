import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { App } from '../app/App';
import { createBook, deleteAllData } from '../db/repositories';
import { useBookStore } from '../stores/bookStore';
import { useSessionStore } from '../stores/sessionStore';
import { useUiStore } from '../stores/uiStore';

vi.mock('../app/providers', () => ({
  AppProviders: ({ children }: { children: ReactNode }) => children
}));

vi.mock('../app/router', async () => {
  const { useState } = await import('react');
  return {
    AppRoutes: function DraftPage() {
      const [draft, setDraft] = useState('');
      return <input aria-label="未保存の下書き" value={draft} onChange={(event) => setDraft(event.target.value)} />;
    }
  };
});

beforeEach(async () => {
  await deleteAllData();
  useBookStore.setState({ books: [], activeBookId: '', loaded: false, loading: false, resetting: false, error: null });
  useSessionStore.setState({ busy: false });
  useUiStore.setState({ toasts: [] });
  window.location.hash = '#/words';
});

afterEach(async () => {
  cleanup();
  await deleteAllData();
});

describe('単語帳操作と編集中のページ', () => {
  it('名前を変更しても編集中のページを保持する', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.type(await screen.findByLabelText('未保存の下書き'), '保存前の熟語');
    await user.click(screen.getByRole('button', { name: '名前を変更' }));
    await user.clear(screen.getByLabelText('単語帳名'));
    await user.type(screen.getByLabelText('単語帳名'), '英単語帳');
    await user.click(screen.getByRole('button', { name: '保存する' }));
    await waitFor(() => expect(screen.getByRole('combobox', { name: '学習する単語帳' })).toHaveDisplayValue('英単語帳'));
    expect(screen.getByLabelText('未保存の下書き')).toHaveValue('保存前の熟語');
  });

  it('別の単語帳に切り替えたときは前のページの下書きを引き継がない', async () => {
    const book = await createBook('英熟語帳');
    const user = userEvent.setup();
    render(<App />);
    await user.type(await screen.findByLabelText('未保存の下書き'), '前の単語帳の下書き');
    await user.selectOptions(screen.getByRole('combobox', { name: '学習する単語帳' }), book.id);
    await waitFor(() => expect(screen.getByRole('combobox', { name: '学習する単語帳' })).toHaveDisplayValue('英熟語帳'));
    expect(await screen.findByLabelText('未保存の下書き')).toHaveValue('');
  });
});
