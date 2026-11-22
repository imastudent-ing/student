import { useEffect } from 'react';
import { HashRouter } from 'react-router-dom';
import { AppProviders } from './providers';
import { AppRoutes } from './router';
import { Toasts } from '../components/Toasts';
import { BookSelector } from '../components/BookSelector';
import { useBookStore } from '../stores/bookStore';

export function App() {
  const load = useBookStore((s) => s.load);
  useEffect(() => {
    void load().catch(() => { /* The startup screen shows the stored error. */ });
  }, [load]);

  return (
    <AppProviders>
      <HashRouter>
        <BookWorkspace />
        <Toasts />
      </HashRouter>
    </AppProviders>
  );
}

function BookWorkspace() {
  const { activeBookId, loaded, resetting, error, load } = useBookStore();
  if (error) {
    return (
      <div className="boot-screen">
        <div role="alert">
          <p>単語帳の読み込みに失敗しました。</p>
          <button className="btn btn-secondary" onClick={() => void load().catch(() => {})}>
            再読み込み
          </button>
        </div>
      </div>
    );
  }
  if (!loaded) return <div className="boot-screen"><p>読み込み中…</p></div>;
  return (
    <>
      <BookSelector />
      {resetting ? (
        <div className="page" role="status"><p>単語帳を読み込み中…</p></div>
      ) : (
        <AppRoutes key={activeBookId} />
      )}
    </>
  );
}
