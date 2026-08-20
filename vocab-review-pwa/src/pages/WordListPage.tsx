import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { getAllProgress, getAllWords, putWord } from '../db/repositories';
import type { Word, WordProgress, WordState } from '../domain/types';
import { formatDateJa, isOverdue, nowIso, todayStr } from '../utils/dates';
import { newId } from '../utils/ids';
import { validateWordForm } from '../importExport/validators';
import { useUiStore } from '../stores/uiStore';

type Tab =
  | 'all'
  | 'unassessed'
  | 'weak'
  | 'mastered'
  | 'pronunciation'
  | 'overdue'
  | 'archived';

const TABS: Array<{ key: Tab; label: string }> = [
  { key: 'all', label: 'すべて' },
  { key: 'unassessed', label: '未診断' },
  { key: 'weak', label: '弱点' },
  { key: 'mastered', label: '習得済み' },
  { key: 'pronunciation', label: '発音確認' },
  { key: 'overdue', label: '期限超過' },
  { key: 'archived', label: 'アーカイブ' }
];

const STATE_LABEL: Record<WordState, string> = {
  unassessed: '未診断',
  weak: '弱点',
  mastered: '習得済み',
  archived: 'アーカイブ'
};

export function WordListPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const showToast = useUiStore((s) => s.showToast);
  const [words, setWords] = useState<Word[]>([]);
  const [progressMap, setProgressMap] = useState<Map<string, WordProgress>>(new Map());
  const [tab, setTab] = useState<Tab>('all');
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(100);
  const [showAdd, setShowAdd] = useState(searchParams.get('add') === '1');
  const [form, setForm] = useState({ number: '', word: '', meaning: '' });

  const reload = async () => {
    const [w, p] = await Promise.all([getAllWords(), getAllProgress()]);
    setWords(w);
    setProgressMap(new Map(p.map((x) => [x.wordId, x])));
  };

  useEffect(() => {
    void reload();
  }, []);

  const today = todayStr();

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return words.filter((w) => {
      const p = progressMap.get(w.id);
      const state = p?.state ?? 'unassessed';
      switch (tab) {
        case 'unassessed':
          if (state !== 'unassessed') return false;
          break;
        case 'weak':
          if (state !== 'weak') return false;
          break;
        case 'mastered':
          if (state !== 'mastered') return false;
          break;
        case 'pronunciation':
          if (p?.pronunciationState !== 'needs_review') return false;
          break;
        case 'overdue':
          if (!(state === 'weak' && isOverdue(p?.dueDate ?? null, today))) return false;
          break;
        case 'archived':
          if (state !== 'archived') return false;
          break;
        default:
          if (state === 'archived') return false;
      }
      if (q === '') return true;
      return (
        w.word.toLowerCase().includes(q) ||
        w.meaning.includes(query.trim()) ||
        String(w.number) === q ||
        w.tags.some((t) => t.toLowerCase().includes(q))
      );
    });
  }, [words, progressMap, tab, query, today]);

  const handleAdd = async () => {
    const validation = validateWordForm(form);
    if (!validation.ok) {
      showToast(validation.errors.join(' '), 'error');
      return;
    }
    const now = nowIso();
    await putWord({
      id: newId(),
      number: Number(form.number),
      word: form.word.trim(),
      meaning: form.meaning.trim(),
      tags: [],
      createdAt: now,
      updatedAt: now
    });
    showToast('単語を追加しました。', 'success');
    setForm({ number: '', word: '', meaning: '' });
    setShowAdd(false);
    setSearchParams({});
    await reload();
  };

  return (
    <div className="page">
      <h1 className="page-title">単語一覧</h1>

      <div className="word-list-controls">
        <input
          type="search"
          className="input"
          placeholder="単語・意味・番号・タグで検索"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button className="btn btn-primary btn-small" onClick={() => setShowAdd(true)}>
          ＋追加
        </button>
      </div>

      <div className="tabs">
        {TABS.map((t) => (
          <button
            key={t.key}
            className={`tab ${tab === t.key ? 'tab-active' : ''}`}
            onClick={() => {
              setTab(t.key);
              setLimit(100);
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      <p className="hint">{filtered.length}語</p>

      <ul className="word-list">
        {filtered.slice(0, limit).map((w) => {
          const p = progressMap.get(w.id);
          const state = p?.state ?? 'unassessed';
          return (
            <li key={w.id} className="word-list-item">
              <Link to={`/words/${w.id}`}>
                <div className="word-list-main">
                  <span className="word-number-inline">No.{w.number}</span>
                  <span className="word-list-word" lang="en">
                    {w.word || '（未入力）'}
                  </span>
                  {p?.pronunciationState === 'needs_review' && (
                    <span className="badge badge-pron">発音</span>
                  )}
                </div>
                <div className="word-list-meaning">{w.meaning || '（意味未入力）'}</div>
                <div className="word-list-meta">
                  <span className={`state-label state-${state}`}>{STATE_LABEL[state]}</span>
                  {state === 'weak' && p && (
                    <>
                      <span>成功{p.separateDaySuccessStreak}回</span>
                      <span>次回: {formatDateJa(p.dueDate)}</span>
                    </>
                  )}
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
      {filtered.length > limit && (
        <button className="btn btn-secondary" onClick={() => setLimit(limit + 200)}>
          さらに表示（残り{filtered.length - limit}語）
        </button>
      )}

      {showAdd && (
        <div className="dialog-backdrop" role="dialog" aria-modal="true">
          <div className="dialog">
            <h2 className="dialog-title">単語を追加</h2>
            <div className="form-grid form-grid-single">
              <label>
                単語番号
                <input
                  type="number"
                  className="input"
                  value={form.number}
                  onChange={(e) => setForm({ ...form, number: e.target.value })}
                />
              </label>
              <label>
                英単語
                <input
                  type="text"
                  className="input"
                  value={form.word}
                  onChange={(e) => setForm({ ...form, word: e.target.value })}
                />
              </label>
              <label>
                意味
                <input
                  type="text"
                  className="input"
                  value={form.meaning}
                  onChange={(e) => setForm({ ...form, meaning: e.target.value })}
                />
              </label>
            </div>
            <div className="dialog-actions">
              <button
                className="btn btn-secondary"
                onClick={() => {
                  setShowAdd(false);
                  setSearchParams({});
                }}
              >
                キャンセル
              </button>
              <button className="btn btn-primary" onClick={() => void handleAdd()}>
                追加
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
