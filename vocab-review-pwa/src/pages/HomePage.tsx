import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  firstAttemptedWordIds,
  getActiveSession,
  getAllProgress,
  getAllWords,
  wordCount
} from '../db/repositories';
import { buildDailyQueue } from '../domain/queueBuilder';
import { useSettingsStore } from '../stores/settingsStore';
import { useSessionStore } from '../stores/sessionStore';
import { useUiStore } from '../stores/uiStore';
import { isOverdue, todayStr } from '../utils/dates';
import { ConfirmDialog } from '../components/ConfirmDialog';
import type { StudySession } from '../domain/types';

interface HomeStats {
  totalWords: number;
  todayReview: number;
  todayAudit: number;
  remainingWeak: number;
  overdue: number;
  weak: number;
  mastered: number;
  unassessed: number;
  pronunciationPending: number;
}

export function HomePage() {
  const navigate = useNavigate();
  const settings = useSettingsStore((s) => s.settings);
  const showToast = useUiStore((s) => s.showToast);
  const startDaily = useSessionStore((s) => s.startDailySession);
  const startExtra = useSessionStore((s) => s.startExtraSession);
  const resumeSession = useSessionStore((s) => s.resumeSession);
  const [stats, setStats] = useState<HomeStats | null>(null);
  const [activeSession, setActiveSession] = useState<StudySession | null>(null);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    void (async () => {
      const count = await wordCount();
      if (count === 0) {
        navigate('/onboarding', { replace: true });
        return;
      }
      const today = todayStr();
      const [words, progressList, attempted, active] = await Promise.all([
        getAllWords(),
        getAllProgress(),
        firstAttemptedWordIds(today),
        getActiveSession()
      ]);
      const queue = buildDailyQueue(words, progressList, settings, today, {
        excludeWordIds: attempted
      });
      const weakList = progressList.filter((p) => p.state === 'weak');
      setStats({
        totalWords: count,
        todayReview: queue.weakCount,
        todayAudit: queue.auditCount,
        remainingWeak: queue.remainingWeakCount,
        overdue: weakList.filter((p) => isOverdue(p.dueDate, today)).length,
        weak: weakList.length,
        mastered: progressList.filter((p) => p.state === 'mastered').length,
        unassessed: progressList.filter((p) => p.state === 'unassessed').length,
        pronunciationPending: progressList.filter(
          (p) => p.pronunciationState === 'needs_review' && p.state !== 'archived'
        ).length
      });
      setActiveSession(active ?? null);
    })();
  }, [navigate, settings]);

  const today = todayStr();
  const dueTotal = stats ? stats.todayReview + stats.todayAudit : 0;

  const handleStart = async () => {
    setStarting(true);
    const id = await startDaily();
    setStarting(false);
    if (id) navigate('/study');
    else showToast('今日出題できる単語がありません。診断モードで弱点を見つけましょう。');
  };

  const handleExtra = async () => {
    setStarting(true);
    const id = await startExtra();
    setStarting(false);
    if (id) navigate('/study');
    else showToast('追加で出題できる単語がありません。');
  };

  const handleResume = async () => {
    const ok = await resumeSession();
    if (ok) navigate('/study');
    else showToast('再開できるセッションがありません。');
  };

  return (
    <div className="page">
      <h1 className="page-title">英単語弱点反復</h1>
      <p className="home-date">{today}</p>

      {activeSession && (
        <div className="card resume-card">
          <p className="resume-title">前回の学習が途中です</p>
          <p className="resume-progress">
            {activeSession.completedFirstAttemptCount} / {activeSession.plannedFirstAttemptCount}語
          </p>
          <div className="row-buttons">
            <button className="btn btn-primary" onClick={() => void handleResume()}>
              続きから再開
            </button>
            <button className="btn btn-secondary" onClick={() => setConfirmEnd(true)}>
              このセッションを終了
            </button>
          </div>
        </div>
      )}

      {stats && (
        <div className="card stats-card">
          <div className="stat-row">
            <span>今日の復習</span>
            <strong>{dueTotal}語</strong>
          </div>
          <div className="stat-row">
            <span>抜き打ち確認</span>
            <strong>{stats.todayAudit}語</strong>
          </div>
          <div className="stat-row">
            <span>復習待ち残数</span>
            <strong>{stats.remainingWeak}語</strong>
          </div>
          <div className="stat-row">
            <span>期限超過</span>
            <strong>{stats.overdue}語</strong>
          </div>
          <hr />
          <div className="stat-row">
            <span>弱点単語</span>
            <strong>{stats.weak.toLocaleString()}語</strong>
          </div>
          <div className="stat-row">
            <span>習得済み</span>
            <strong>{stats.mastered.toLocaleString()}語</strong>
          </div>
          <div className="stat-row">
            <span>未診断</span>
            <strong>{stats.unassessed.toLocaleString()}語</strong>
          </div>
          <div className="stat-row">
            <span>発音確認待ち</span>
            <strong>{stats.pronunciationPending}語</strong>
          </div>
        </div>
      )}

      <div className="home-actions">
        {!activeSession && (
          <button
            className="btn btn-primary btn-big"
            onClick={() => void handleStart()}
            disabled={starting || !stats}
          >
            今日の学習を始める
          </button>
        )}
        <Link to="/diagnosis" className="btn btn-secondary btn-big">
          診断モードを始める
        </Link>
        {stats && stats.remainingWeak > 0 && !activeSession && (
          <button className="btn btn-secondary" onClick={() => void handleExtra()} disabled={starting}>
            追加で学習する（復習待ち {stats.remainingWeak}語）
          </button>
        )}
        <Link to="/onboarding" className="btn btn-ghost">
          データ管理（登録・復元）
        </Link>
      </div>

      <ConfirmDialog
        open={confirmEnd}
        title="セッションを終了"
        message="進行中のセッションを終了します。回答済みの結果は保存されています。"
        confirmLabel="終了する"
        onConfirm={() => {
          void (async () => {
            const resumed = await resumeSession();
            if (resumed) {
              await useSessionStore.getState().abandonSession();
            }
            setActiveSession(null);
            setConfirmEnd(false);
          })();
        }}
        onCancel={() => setConfirmEnd(false)}
      />
    </div>
  );
}
