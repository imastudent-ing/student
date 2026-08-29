import type { AttemptResult, Word } from '../domain/types';
import { AudioButton } from './AudioButton';
import { useSettingsStore } from '../stores/settingsStore';

interface Props {
  word: Word;
  isRetest: boolean;
  judgedResult: AttemptResult | null;
  elapsedMs: number | null;
  pronunciationEmphasized: boolean;
  onJudge: (judgment: 'correct' | 'ambiguous' | 'wrong') => void;
  onNext: () => void;
  onUndo: () => void;
  canUndo: boolean;
  carryOverNotice: boolean;
}

const RESULT_LABEL: Record<AttemptResult, string> = {
  fast_correct: '⭕ 即答',
  slow_correct: '🔺 遅答',
  wrong: '❌ 不正解'
};

/** 答え表示後のパネル */
export function AnswerPanel({
  word,
  isRetest,
  judgedResult,
  elapsedMs,
  pronunciationEmphasized,
  onJudge,
  onNext,
  onUndo,
  canUndo,
  carryOverNotice
}: Props) {
  const settings = useSettingsStore((s) => s.settings);
  return (
    <div className="answer-panel">
      <div className="answer-meaning">{word.meaning || '（意味が未入力です）'}</div>
      {word.secondaryMeaning && (
        <div className="answer-secondary">{word.secondaryMeaning}</div>
      )}
      {word.pronunciation && <div className="answer-pronunciation">{word.pronunciation}</div>}
      <AudioButton word={word} emphasized={pronunciationEmphasized} />
      {settings.showPhrase && word.phrase && (
        <div className="answer-phrase">
          <div lang="en">{word.phrase}</div>
          {word.phraseMeaning && <div className="phrase-meaning">{word.phraseMeaning}</div>}
        </div>
      )}
      {elapsedMs !== null && settings.showTimer && (
        <div className="answer-elapsed">回答まで {(elapsedMs / 1000).toFixed(1)}秒</div>
      )}

      {judgedResult === null ? (
        <div className="judge-buttons">
          <button className="btn btn-correct" onClick={() => onJudge('correct')}>
            ⭕ 正解
          </button>
          {!isRetest && (
            <button className="btn btn-ambiguous" onClick={() => onJudge('ambiguous')}>
              🔺 曖昧
            </button>
          )}
          <button className="btn btn-wrong" onClick={() => onJudge('wrong')}>
            ❌ 不正解
          </button>
        </div>
      ) : (
        <div className="judged-area">
          <div className={`judged-result judged-${judgedResult}`}>
            {RESULT_LABEL[judgedResult]}
          </div>
          {carryOverNotice && (
            <p className="carryover-notice">
              今日はまだ定着していません。
              <br />
              答えを確認して、明日の最初にもう一度確認します。
            </p>
          )}
          <div className="judged-actions">
            {canUndo && (
              <button className="btn btn-secondary" onClick={onUndo}>
                ↩ 元に戻す
              </button>
            )}
            <button className="btn btn-primary btn-next" onClick={onNext}>
              次へ →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
