import { useState } from 'react';
import type { Word } from '../domain/types';
import { hasAudio, playWordAudio } from '../audio/audioResolver';
import { useSettingsStore } from '../stores/settingsStore';

interface Props {
  word: Word;
  emphasized?: boolean;
}

export function AudioButton({ word, emphasized = false }: Props) {
  const settings = useSettingsStore((s) => s.settings);
  const [failed, setFailed] = useState(false);

  if (!hasAudio(word, settings)) {
    return word.pronunciation ? (
      <span className="pronunciation-text">{word.pronunciation}</span>
    ) : null;
  }

  return (
    <button
      type="button"
      className={`btn btn-audio ${emphasized ? 'btn-audio-emphasized' : ''}`}
      onClick={async () => {
        const ok = await playWordAudio(word, settings);
        setFailed(!ok);
      }}
    >
      🔊 音声を再生
      {failed && <span className="audio-error">（再生できませんでした）</span>}
    </button>
  );
}
