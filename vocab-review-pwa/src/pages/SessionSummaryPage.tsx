import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { getSession } from '../db/repositories';
import { db } from '../db/database';
import type { StudySession, Word } from '../domain/types';
import { useSessionStore } from '../stores/sessionStore';
import { useUiStore } from '../stores/uiStore';

export function SessionSummaryPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  const showToast = useUiStore((s) => s.showToast);
  const startExtra = useSessionStore((s) => s.startExtraSession);
  const startPronunciation = useSessionStore((s) => s.startPronunciationSession);
  const [session, setSession] = useState<StudySession | null>(null);
  const [wrongWords, setWrongWords] = useState<Word[]>([]);
  const [showWrong, setShowWrong] = useState(false);

  useEffect(() => {
    if (!sessionId) return;
    void (async () => {
      const s = await getSession(sessionId);
      if (!s) {
        navigate('/', { replace: true });
        return;
      }
      setSession(s);
      const targetIds = s.summary.retestTargetWordIds;
      if (targetIds.length > 0) {
        const words = await db.words.bulkGet(targetIds);
        setWrongWords(words.filter((w): w is Word => w !== undefined));
      }
    })();
  }, [sessionId, navigate]);

  if (!session) {
    return (
      <div className="page">
        <p>読み込み中…</p>
      </div>
    );
  }

  const sum = session.summary;
  const firstTotal = sum.firstFast + sum.firstSlow + sum.firstWrong;
  const fastRate = firstTotal > 0 ? Math.round((sum.firstFast / firstTotal) * 100) : 0;
  const durationMin =
    session.completedAt !== null
      ? Math.max(
          1,
          Math.round(
            (new Date(session.completedAt).getTime() - new Date(session.startedAt).getTime()) /
              60000
          )
        )
      : null;

  return (
    <div className="page">
      <h1 className="page-title">セッション結果</h1>

      <div className="card summary-main">
        <h2>本日の初回回答</h2>
        <div className="fast-rate-display">
          <span className="fast-rate-number">{fastRate}%</span>
          <span className="fast-rate-label">初回即答率</span>
        </div>
        <div className="stat-row">
          <span>⭕ 即答</span>
          <strong>{sum.firstFast}語</strong>
        </div>
        <div className="stat-row">
          <span>🔺 遅答</span>
          <strong>{sum.firstSlow}語</strong>
        </div>
        <div className="stat-row">
          <span>❌ 不正解</span>
          <strong>{sum.firstWrong}語</strong>
        </div>
      </div>

      <div className="card">
        <h2>同日再テスト</h2>
        <div className="stat-row">
          <span>対象</span>
          <strong>{sum.retestTargetWordIds.length}語</strong>
        </div>
        <div className="stat-row">
          <span>最終的に正解</span>
          <strong>{sum.retestCorrectWordIds.length}語</strong>
        </div>
        <div className="stat-row">
          <span>翌日へ持ち越し</span>
          <strong>{sum.carryOverWordIds.length}語</strong>
        </div>
        <p className="hint">再テストで正解しても、初回即答率と翌日の復習予定は変わりません。</p>
      </div>

      <div className="card">
        <h2>状態の変化</h2>
        <div className="stat-row">
          <span>新たに弱点になった語</span>
          <strong>{sum.newlyWeakWordIds.length}語</strong>
        </div>
        <div className="stat-row">
          <span>習得済みへ移った語</span>
          <strong>{sum.graduatedWordIds.length}語</strong>
        </div>
        <div className="stat-row">
          <span>発音確認へ入れた語</span>
          <strong>{sum.pronunciationFlaggedWordIds.length}語</strong>
        </div>
        {durationMin !== null && (
          <div className="stat-row">
            <span>学習時間</span>
            <strong>約{durationMin}分</strong>
          </div>
        )}
      </div>

      {wrongWords.length > 0 && (
        <div className="card">
          <button className="btn btn-secondary" onClick={() => setShowWrong(!showWrong)}>
            今日間違えた単語を見る（{wrongWords.length}語）
          </button>
          {showWrong && (
            <ul className="wrong-word-list">
              {wrongWords.map((w) => (
                <li key={w.id}>
                  <Link to={`/words/${w.id}`}>
                    <span className="word-number-inline">No.{w.number}</span> {w.word} — {w.meaning}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="home-actions">
        {sum.pronunciationFlaggedWordIds.length > 0 && (
          <button
            className="btn btn-secondary"
            onClick={() => {
              void startPronunciation().then((id) => {
                if (id) navigate('/study');
                else showToast('発音確認対象がありません。');
              });
            }}
          >
            発音だけ復習する
          </button>
        )}
        <button
          className="btn btn-secondary"
          onClick={() => {
            void startExtra().then((id) => {
              if (id) navigate('/study');
              else showToast('追加で出題できる単語がありません。');
            });
          }}
        >
          追加で学習する
        </button>
        <Link to="/" className="btn btn-primary btn-big">
          ホームへ戻る
        </Link>
      </div>
    </div>
  );
}
