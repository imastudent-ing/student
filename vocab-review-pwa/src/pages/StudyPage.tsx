import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ProgressHeader } from '../components/ProgressHeader';
import { StudyCard } from '../components/StudyCard';
import { AnswerPanel } from '../components/AnswerPanel';
import { AudioButton } from '../components/AudioButton';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { useSessionStore } from '../stores/sessionStore';
import { useSettingsStore } from '../stores/settingsStore';
import { pendingRetests } from '../domain/retest';
import { playWordAudio } from '../audio/audioResolver';
import type { AttemptPhase } from '../domain/types';

const PHASE_LABEL: Record<AttemptPhase, string> = {
  diagnosis: '診断',
  daily_first: '弱点復習',
  audit_first: '抜き打ち',
  same_day_retest: '同日再テスト',
  pronunciation: '発音確認'
};

export function StudyPage() {
  const navigate = useNavigate();
  const settings = useSettingsStore((s) => s.settings);
  const store = useSessionStore();
  const {
    session,
    currentCard,
    wordsCache,
    revealed,
    shownAtMs,
    elapsedMs,
    judgedResult,
    pronunciationUnknown,
    carryOverNotice,
    undoSnapshot,
    finishedSessionId,
    retestItems
  } = store;
  const [confirmExit, setConfirmExit] = useState(false);
  const [paused, setPaused] = useState(false);
  const triedResume = useRef(false);
  const autoAdvanceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // セッションがなければ再開を試み、なければホームへ
  useEffect(() => {
    if (session || finishedSessionId) return;
    if (triedResume.current) return;
    triedResume.current = true;
    void store.resumeSession().then((ok) => {
      if (!ok) navigate('/', { replace: true });
    });
  }, [session, finishedSessionId]);

  // セッション完了 → 終了画面へ
  // finishedSessionId はここでは消さない（再レンダーと遷移が競合するため）。
  // 次のセッション開始時に sessionStore 側でリセットされる。
  useEffect(() => {
    if (finishedSessionId) {
      navigate(`/summary/${finishedSessionId}`, { replace: true });
    }
  }, [finishedSessionId, navigate]);

  const word = currentCard ? wordsCache.get(currentCard.wordId) : undefined;

  // 新しいカードの表示時は必ず先頭から見せる
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [currentCard?.wordId, currentCard?.kind]);

  // 答え表示時の自動再生
  useEffect(() => {
    if (!revealed || !word || judgedResult !== null) return;
    if (
      settings.autoPlayAudio ||
      (pronunciationUnknown && settings.autoPlayPronunciationIssue)
    ) {
      void playWordAudio(word, settings);
    }
  }, [revealed, word?.id]);

  // 自動で次へ
  useEffect(() => {
    if (judgedResult !== null && settings.autoAdvance && !carryOverNotice) {
      autoAdvanceTimer.current = setTimeout(() => {
        void store.next();
      }, 1000);
      return () => {
        if (autoAdvanceTimer.current) clearTimeout(autoAdvanceTimer.current);
      };
    }
  }, [judgedResult]);

  const handleJudge = useCallback(
    (j: 'correct' | 'ambiguous' | 'wrong' | 'dont_know') => {
      void store.judge(j);
    },
    [store]
  );

  // キーボード操作
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (paused || confirmExit) return;
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      switch (e.key) {
        case ' ':
          e.preventDefault();
          if (!revealed) store.reveal();
          else if (judgedResult !== null) void store.next();
          break;
        case '1':
          if (revealed && judgedResult === null) handleJudge('correct');
          break;
        case '2':
          if (revealed && judgedResult === null && currentCard?.kind !== 'retest') {
            handleJudge('ambiguous');
          }
          break;
        case '3':
          if (revealed && judgedResult === null) handleJudge('wrong');
          break;
        case 'p':
        case 'P':
          store.togglePronunciationUnknown();
          break;
        case 'r':
        case 'R':
          if (word) void playWordAudio(word, settings);
          break;
        case 'z':
        case 'Z':
          void store.undo();
          break;
        case 'Escape':
          setPaused(true);
          break;
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [store, revealed, judgedResult, paused, confirmExit, word, settings, handleJudge, currentCard]);

  if (!session || !currentCard || !word) {
    return (
      <div className="page">
        <p>読み込み中…</p>
      </div>
    );
  }

  const pending = pendingRetests(retestItems).length;
  const typeLabel = PHASE_LABEL[currentCard.phase];
  const canUndo = undoSnapshot !== null && Date.now() < undoSnapshot.expiresAt;

  if (paused) {
    return (
      <div className="page study-page">
        <div className="pause-screen">
          <h1>一時停止中</h1>
          <p>
            進捗は自動保存されています。
            <br />
            画面を閉じても続きから再開できます。
          </p>
          <button className="btn btn-primary btn-big" onClick={() => setPaused(false)}>
            再開する
          </button>
          <button className="btn btn-secondary" onClick={() => navigate('/')}>
            ホームへ戻る
          </button>
        </div>
      </div>
    );
  }

  // 発音確認カード
  if (currentCard.kind === 'pronunciation') {
    return (
      <div className="page study-page">
        <ProgressHeader
          current={session.completedFirstAttemptCount + 1}
          total={session.plannedFirstAttemptCount}
          typeLabel="発音確認"
          pendingRetests={0}
          onPause={() => setPaused(true)}
          onExit={() => setConfirmExit(true)}
        />
        <div className="study-card">
          {settings.showWordNumber && <div className="word-number">No. {word.number}</div>}
          <div className="study-word" lang="en">
            {word.word}
          </div>
          {word.pronunciation && <div className="answer-pronunciation">{word.pronunciation}</div>}
          <div className="answer-meaning">{word.meaning}</div>
          <AudioButton word={word} emphasized />
        </div>
        <div className="bottom-actions">
          <button
            className="btn btn-correct btn-big"
            onClick={() => void store.markPronunciationChecked(true)}
          >
            発音確認済み
          </button>
          <button
            className="btn btn-secondary"
            onClick={() => void store.markPronunciationChecked(false)}
          >
            あとで（残す）
          </button>
        </div>
        <ExitDialog
          open={confirmExit}
          onConfirm={() => {
            setConfirmExit(false);
            void store.completeSession();
          }}
          onCancel={() => setConfirmExit(false)}
        />
      </div>
    );
  }

  return (
    <div className="page study-page">
      <ProgressHeader
        current={Math.min(session.completedFirstAttemptCount + 1, session.plannedFirstAttemptCount)}
        total={session.plannedFirstAttemptCount}
        typeLabel={typeLabel}
        pendingRetests={pending}
        onPause={() => setPaused(true)}
        onExit={() => setConfirmExit(true)}
      />

      <StudyCard
        word={word}
        revealed={revealed}
        shownAtMs={shownAtMs}
        pronunciationUnknown={pronunciationUnknown}
        onTogglePronunciationUnknown={store.togglePronunciationUnknown}
      />

      {!revealed ? (
        <div className="bottom-actions">
          <button className="btn btn-primary btn-big" onClick={store.reveal}>
            答えを見る
          </button>
          <button className="btn btn-wrong-outline" onClick={() => handleJudge('dont_know')}>
            分からない
          </button>
        </div>
      ) : (
        <AnswerPanel
          word={word}
          isRetest={currentCard.kind === 'retest'}
          judgedResult={judgedResult}
          elapsedMs={elapsedMs}
          pronunciationEmphasized={pronunciationUnknown}
          onJudge={handleJudge}
          onNext={() => void store.next()}
          onUndo={() => void store.undo()}
          canUndo={canUndo}
          carryOverNotice={carryOverNotice}
        />
      )}

      <ExitDialog
        open={confirmExit}
        onConfirm={() => {
          setConfirmExit(false);
          void store.completeSession();
        }}
        onCancel={() => setConfirmExit(false)}
      />
    </div>
  );
}

function ExitDialog({
  open,
  onConfirm,
  onCancel
}: {
  open: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <ConfirmDialog
      open={open}
      title="セッションを終了"
      message="ここまでの結果を保存してセッションを終了します。よろしいですか？"
      confirmLabel="終了する"
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  );
}
