import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CsvImportPanel } from '../components/CsvImportPanel';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { createEmptyDataset, wordCount } from '../db/repositories';
import { restoreFromJson } from '../importExport/jsonBackup';
import { useUiStore } from '../stores/uiStore';

export function OnboardingPage() {
  const navigate = useNavigate();
  const showToast = useUiStore((s) => s.showToast);
  const [hasWords, setHasWords] = useState(false);
  const [confirmEmpty, setConfirmEmpty] = useState(false);
  const [busy, setBusy] = useState(false);
  const restoreRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void wordCount().then((c) => setHasWords(c > 0));
  }, []);

  const handleRestore = async (file: File) => {
    setBusy(true);
    try {
      const text = await file.text();
      await restoreFromJson(text);
      showToast('バックアップから復元しました。', 'success');
      navigate('/');
    } catch (e) {
      showToast(e instanceof Error ? e.message : '復元に失敗しました。', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page">
      <h1 className="page-title">{hasWords ? 'データ管理' : 'ようこそ'}</h1>
      {!hasWords && (
        <div className="card">
          <p>
            このアプリは、すでに何周かした単語帳の
            <strong>弱点だけを効率的に潰す</strong>ための復習アプリです。
          </p>
          <ul className="onboarding-list">
            <li>英単語を見て3秒以内に意味を思い出せるかを判定</li>
            <li>迷った・間違えた語だけを同じ日に再テスト</li>
            <li>別々の日に3回即答できたら弱点から卒業</li>
            <li>データはすべてこの端末の中に保存（サーバー・ログイン不要）</li>
          </ul>
          <p className="hint">
            市販単語帳の本文・音声データは含まれていません。ご自身が利用権を持つデータのみ登録してください。
          </p>
        </div>
      )}

      <section className="card">
        <h2>CSVを読み込む</h2>
        <CsvImportPanel onImported={() => setHasWords(true)} />
      </section>

      <section className="card">
        <h2>手動で単語を登録する</h2>
        <p className="hint">単語一覧画面から1語ずつ追加できます。</p>
        <button className="btn btn-secondary" onClick={() => navigate('/words?add=1')}>
          単語一覧へ
        </button>
      </section>

      <section className="card">
        <h2>1〜1900の空データを作成する</h2>
        <p className="hint">
          番号だけが入った1900件の空レコードを作成します。単語・意味は後から入力できます。
        </p>
        <button className="btn btn-secondary" onClick={() => setConfirmEmpty(true)} disabled={busy}>
          空データを作成
        </button>
      </section>

      <section className="card">
        <h2>バックアップから復元する</h2>
        <input
          ref={restoreRef}
          type="file"
          accept=".json,application/json"
          aria-label="バックアップJSONを選択"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void handleRestore(file);
          }}
          disabled={busy}
        />
      </section>

      {hasWords && (
        <button className="btn btn-ghost" onClick={() => navigate('/')}>
          ← ホームへ戻る
        </button>
      )}

      <ConfirmDialog
        open={confirmEmpty}
        title="空データを作成"
        message="1〜1900の空レコードを作成します。既存の番号はスキップされます。"
        confirmLabel="作成する"
        onConfirm={() => {
          setConfirmEmpty(false);
          setBusy(true);
          void createEmptyDataset(1900)
            .then((n) => {
              showToast(`${n}件の空レコードを作成しました。`, 'success');
              setHasWords(true);
              navigate('/words');
            })
            .finally(() => setBusy(false));
        }}
        onCancel={() => setConfirmEmpty(false)}
      />
    </div>
  );
}
