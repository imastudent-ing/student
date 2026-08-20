import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  attemptsForWord,
  deleteWord,
  getProgress,
  getWord,
  putProgress,
  putWord
} from '../db/repositories';
import {
  createDefaultProgress,
  type Attempt,
  type Word,
  type WordProgress
} from '../domain/types';
import { addDaysStr, formatDateJa, nowIso, todayStr } from '../utils/dates';
import { AudioButton } from '../components/AudioButton';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { useUiStore } from '../stores/uiStore';

const RESULT_LABEL = {
  fast_correct: '即答',
  slow_correct: '遅答',
  wrong: '不正解'
} as const;

const PHASE_LABEL = {
  diagnosis: '診断',
  daily_first: '弱点復習',
  audit_first: '抜き打ち',
  same_day_retest: '再テスト',
  pronunciation: '発音'
} as const;

export function WordDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const showToast = useUiStore((s) => s.showToast);
  const [word, setWord] = useState<Word | null>(null);
  const [progress, setProgress] = useState<WordProgress | null>(null);
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<Partial<Word>>({});
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);

  const reload = async () => {
    if (!id) return;
    const w = await getWord(id);
    if (!w) {
      navigate('/words', { replace: true });
      return;
    }
    setWord(w);
    setProgress(await getProgress(id));
    setAttempts((await attemptsForWord(id)).slice(0, 30));
  };

  useEffect(() => {
    void reload();
  }, [id]);

  if (!word || !progress) {
    return (
      <div className="page">
        <p>読み込み中…</p>
      </div>
    );
  }

  const updateProgress = async (patch: Partial<WordProgress>, message: string) => {
    const updated = { ...progress, ...patch, updatedAt: nowIso() };
    await putProgress(updated);
    setProgress(updated);
    showToast(message, 'success');
  };

  const saveEdit = async () => {
    const updated: Word = {
      ...word,
      ...form,
      number: Number(form.number ?? word.number),
      tags:
        typeof form.tags === 'string'
          ? (form.tags as string)
              .split(/[;,、]/)
              .map((t: string) => t.trim())
              .filter(Boolean)
          : (form.tags ?? word.tags),
      updatedAt: nowIso()
    };
    await putWord(updated);
    setWord(updated);
    setEditing(false);
    showToast('保存しました。', 'success');
  };

  return (
    <div className="page">
      <button className="btn btn-ghost btn-small" onClick={() => navigate(-1)}>
        ← 戻る
      </button>
      <h1 className="page-title">
        <span className="word-number-inline">No.{word.number}</span> {word.word || '（未入力）'}
      </h1>

      {!editing ? (
        <div className="card">
          <div className="stat-row">
            <span>意味</span>
            <strong>{word.meaning || '-'}</strong>
          </div>
          {word.secondaryMeaning && (
            <div className="stat-row">
              <span>補助的な意味</span>
              <strong>{word.secondaryMeaning}</strong>
            </div>
          )}
          {word.pronunciation && (
            <div className="stat-row">
              <span>発音・読み方</span>
              <strong>{word.pronunciation}</strong>
            </div>
          )}
          {word.phrase && (
            <div className="stat-row">
              <span>フレーズ</span>
              <strong>
                {word.phrase}
                {word.phraseMeaning && ` / ${word.phraseMeaning}`}
              </strong>
            </div>
          )}
          {word.tags.length > 0 && (
            <div className="stat-row">
              <span>タグ</span>
              <strong>{word.tags.join(', ')}</strong>
            </div>
          )}
          <AudioButton word={word} />
          <button
            className="btn btn-secondary"
            onClick={() => {
              setForm({ ...word, tags: word.tags.join(';') as unknown as string[] });
              setEditing(true);
            }}
          >
            編集
          </button>
        </div>
      ) : (
        <div className="card">
          <div className="form-grid form-grid-single">
            {(
              [
                ['number', '単語番号'],
                ['word', '英単語'],
                ['meaning', '中心的な意味'],
                ['secondaryMeaning', '補助的な意味'],
                ['pronunciation', '発音記号・読み方'],
                ['phrase', 'フレーズ'],
                ['phraseMeaning', 'フレーズの意味'],
                ['audioUrl', '音声URL'],
                ['tags', 'タグ（; 区切り）']
              ] as const
            ).map(([key, label]) => (
              <label key={key}>
                {label}
                <input
                  type={key === 'number' ? 'number' : 'text'}
                  className="input"
                  value={String((form as Record<string, unknown>)[key] ?? '')}
                  onChange={(e) => setForm({ ...form, [key]: e.target.value })}
                />
              </label>
            ))}
          </div>
          <div className="dialog-actions">
            <button className="btn btn-secondary" onClick={() => setEditing(false)}>
              キャンセル
            </button>
            <button className="btn btn-primary" onClick={() => void saveEdit()}>
              保存
            </button>
          </div>
        </div>
      )}

      <div className="card">
        <h2>学習状況</h2>
        <div className="stat-row">
          <span>状態</span>
          <strong>
            {
              { unassessed: '未診断', weak: '弱点', mastered: '習得済み', archived: 'アーカイブ' }[
                progress.state
              ]
            }
          </strong>
        </div>
        <div className="stat-row">
          <span>別日連続成功数</span>
          <strong>{progress.separateDaySuccessStreak}回</strong>
        </div>
        <div className="stat-row">
          <span>次回復習日</span>
          <strong>{formatDateJa(progress.dueDate)}</strong>
        </div>
        <div className="stat-row">
          <span>最終確認日</span>
          <strong>{formatDateJa(progress.lastFirstAttemptDate)}</strong>
        </div>
        <div className="stat-row">
          <span>発音状態</span>
          <strong>{progress.pronunciationState === 'needs_review' ? '要確認' : 'OK'}</strong>
        </div>
        <div className="stat-row">
          <span>即答 / 遅答 / 不正解</span>
          <strong>
            {progress.totalFastCorrect} / {progress.totalSlowCorrect} / {progress.totalWrong}
          </strong>
        </div>
        <div className="stat-row">
          <span>つまずき回数</span>
          <strong>{progress.lapseCount}回</strong>
        </div>
      </div>

      <div className="card">
        <h2>操作</h2>
        <div className="detail-actions">
          <button
            className="btn btn-secondary"
            onClick={() =>
              void updateProgress(
                {
                  state: 'weak',
                  separateDaySuccessStreak: 0,
                  dueDate: todayStr()
                },
                '弱点に変更しました。'
              )
            }
          >
            弱点へ変更
          </button>
          <button
            className="btn btn-secondary"
            onClick={() =>
              void updateProgress(
                {
                  state: 'mastered',
                  dueDate: null,
                  nextAuditEligibleDate: addDaysStr(todayStr(), 14)
                },
                '習得済みに変更しました。'
              )
            }
          >
            習得済みへ変更
          </button>
          <button
            className="btn btn-secondary"
            onClick={() =>
              void updateProgress(
                { state: 'weak', dueDate: addDaysStr(todayStr(), 1) },
                '明日の復習へ追加しました。'
              )
            }
          >
            明日復習へ追加
          </button>
          <button
            className="btn btn-secondary"
            onClick={() =>
              void updateProgress({ pronunciationState: 'needs_review' }, '発音確認へ追加しました。')
            }
          >
            発音確認へ追加
          </button>
          <button className="btn btn-secondary" onClick={() => setConfirmReset(true)}>
            履歴をリセット
          </button>
          <button
            className="btn btn-secondary"
            onClick={() =>
              void updateProgress(
                { state: progress.state === 'archived' ? 'unassessed' : 'archived' },
                progress.state === 'archived' ? 'アーカイブを解除しました。' : 'アーカイブしました。'
              )
            }
          >
            {progress.state === 'archived' ? 'アーカイブ解除' : 'アーカイブ'}
          </button>
          <button className="btn btn-danger" onClick={() => setConfirmDelete(true)}>
            削除
          </button>
        </div>
      </div>

      {attempts.length > 0 && (
        <div className="card">
          <h2>回答履歴（最新30件）</h2>
          <ul className="history-list">
            {attempts.map((a) => (
              <li key={a.id}>
                {a.localStudyDate} [{PHASE_LABEL[a.phase]}] {RESULT_LABEL[a.result]}
                {a.responseTimeMs !== null && ` (${(a.responseTimeMs / 1000).toFixed(1)}秒)`}
                {a.isFirstAttemptOfDay && ' ★初回'}
              </li>
            ))}
          </ul>
        </div>
      )}

      <ConfirmDialog
        open={confirmReset}
        title="履歴をリセット"
        message="この単語の学習状態を未診断に戻します。回答履歴の記録は残ります。"
        confirmLabel="リセット"
        danger
        onConfirm={() => {
          setConfirmReset(false);
          const fresh = createDefaultProgress(word.id, nowIso());
          void putProgress(fresh).then(() => {
            setProgress(fresh);
            showToast('リセットしました。', 'success');
          });
        }}
        onCancel={() => setConfirmReset(false)}
      />
      <ConfirmDialog
        open={confirmDelete}
        title="単語を削除"
        message={`「${word.word}」を削除します。学習履歴も削除され、元に戻せません。`}
        confirmLabel="削除する"
        danger
        onConfirm={() => {
          setConfirmDelete(false);
          void deleteWord(word.id).then(() => {
            showToast('削除しました。', 'success');
            navigate('/words');
          });
        }}
        onCancel={() => setConfirmDelete(false)}
      />
    </div>
  );
}
