import { useState, type FormEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useBookStore } from '../stores/bookStore';
import { useSessionStore } from '../stores/sessionStore';
import { useUiStore } from '../stores/uiStore';

export function BookSelector() {
  const navigate = useNavigate();
  const location = useLocation();
  const { books, activeBookId, loading, select, create, rename } = useBookStore();
  const savingAnswer = useSessionStore((s) => s.busy);
  const showToast = useUiStore((s) => s.showToast);
  const [mode, setMode] = useState<'create' | 'rename' | null>(null);
  const [name, setName] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const disabled = loading || savingAnswer;

  const changeBook = async (id: string) => {
    try {
      await select(id);
      navigate('/', { replace: true });
    } catch (error) {
      showToast(error instanceof Error ? error.message : '切り替えに失敗しました。', 'error');
    }
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!name.trim()) {
      setFormError('単語帳名を入力してください。');
      return;
    }
    try {
      if (mode === 'create') {
        await create(name);
        navigate('/onboarding', { replace: true });
        showToast('単語帳を作成しました。CSVや手入力で単語を追加できます。', 'success');
      } else {
        await rename(activeBookId, name);
        showToast('単語帳名を変更しました。', 'success');
      }
      setMode(null);
      setName('');
      setFormError(null);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : '保存に失敗しました。');
    }
  };

  if (location.pathname.startsWith('/study')) return null;

  return (
    <header className="book-header" onKeyDown={(event) => event.stopPropagation()}>
      <div className="book-toolbar">
        <label className="book-select-label" htmlFor="active-book">
          学習する単語帳
          <select
            id="active-book"
            className="input"
            value={activeBookId}
            disabled={disabled}
            onChange={(event) => void changeBook(event.target.value)}
          >
            {books.map((book) => (
              <option key={book.id} value={book.id}>{book.name}</option>
            ))}
          </select>
        </label>
        <div className="book-actions">
          <button
            type="button"
            className="btn btn-secondary btn-small"
            disabled={disabled}
            onClick={() => {
              setMode('create');
              setName('');
              setFormError(null);
            }}
          >
            ＋単語帳を追加
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-small"
            disabled={disabled}
            onClick={() => {
              setMode('rename');
              setName(books.find((book) => book.id === activeBookId)?.name ?? '');
              setFormError(null);
            }}
          >
            名前を変更
          </button>
        </div>
      </div>
      <p className="book-hint">出題・学習履歴・統計は単語帳ごとに保存されます。</p>
      {mode && (
        <div
          className="dialog-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="book-dialog-title"
          onKeyDown={(event) => {
            if (event.key === 'Escape' && !disabled) setMode(null);
          }}
        >
          <form className="dialog" onSubmit={(event) => void submit(event)}>
            <h2 id="book-dialog-title" className="dialog-title">
              {mode === 'create' ? '単語帳を追加' : '単語帳名を変更'}
            </h2>
            <label className="book-name-label" htmlFor="book-name">単語帳名</label>
            <input
              id="book-name"
              className="input"
              type="text"
              value={name}
              autoFocus
              required
              disabled={disabled}
              aria-invalid={Boolean(formError)}
              aria-describedby={formError ? 'book-form-error' : undefined}
              placeholder="例：英熟語帳"
              onChange={(event) => {
                setName(event.target.value);
                setFormError(null);
              }}
            />
            {mode === 'create' && <p className="hint">空の単語帳を作成します。これまでの単語と履歴は残ります。</p>}
            {formError && <p id="book-form-error" className="error-text" role="alert">{formError}</p>}
            <div className="dialog-actions">
              <button type="button" className="btn btn-secondary" disabled={disabled} onClick={() => setMode(null)}>
                キャンセル
              </button>
              <button type="submit" className="btn btn-primary" disabled={disabled || !name.trim()}>
                {loading ? '保存中…' : mode === 'create' ? '作成する' : '保存する'}
              </button>
            </div>
          </form>
        </div>
      )}
    </header>
  );
}
