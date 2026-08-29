import { useEffect, useState } from 'react';
import type { Word } from '../domain/types';
import { useSettingsStore } from '../stores/settingsStore';

interface Props {
  word: Word;
  revealed: boolean;
  shownAtMs: number | null;
  pronunciationUnknown: boolean;
  onTogglePronunciationUnknown: () => void;
}

/** 答え表示前のカード面。意味やフレーズは一切表示しない。 */
export function StudyCard({
  word,
  revealed,
  shownAtMs,
  pronunciationUnknown,
  onTogglePronunciationUnknown
}: Props) {
  const settings = useSettingsStore((s) => s.settings);
  const [elapsedSec, setElapsedSec] = useState(0);

  useEffect(() => {
    if (revealed || shownAtMs === null) return;
    const timer = setInterval(() => {
      setElapsedSec(Math.floor((Date.now() - shownAtMs) / 1000));
    }, 250);
    return () => clearInterval(timer);
  }, [revealed, shownAtMs]);

  return (
    <div className="study-card">
      {settings.showWordNumber && <div className="word-number">No. {word.number}</div>}
      <div className="study-word" lang="en">
        {word.word}
      </div>
      {!revealed && settings.showTimer && shownAtMs !== null && (
        <div
          className={`timer ${elapsedSec * 1000 > settings.fastThresholdMs ? 'timer-over' : ''}`}
          aria-label="経過秒数"
        >
          {elapsedSec}秒
        </div>
      )}
      <button
        type="button"
        className={`btn btn-toggle ${pronunciationUnknown ? 'btn-toggle-on' : ''}`}
        onClick={onTogglePronunciationUnknown}
        aria-pressed={pronunciationUnknown}
      >
        {pronunciationUnknown ? '✓ 読み方が分からない（発音復習へ）' : '読み方が分からない'}
      </button>
    </div>
  );
}
