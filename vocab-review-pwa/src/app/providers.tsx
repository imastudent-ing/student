import { useEffect, useState, type ReactNode } from 'react';
import { useSettingsStore } from '../stores/settingsStore';

/** 設定の読み込みなど、起動時の初期化を行う */
export function AppProviders({ children }: { children: ReactNode }) {
  const loaded = useSettingsStore((s) => s.loaded);
  const load = useSettingsStore((s) => s.load);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    load().catch(() => setError('データベースの初期化に失敗しました。'));
  }, [load]);

  if (error) {
    return (
      <div className="boot-screen">
        <p>{error}</p>
      </div>
    );
  }
  if (!loaded) {
    return (
      <div className="boot-screen">
        <p>読み込み中…</p>
      </div>
    );
  }
  return <>{children}</>;
}
