import type { AppSettings, Word } from '../domain/types';
import { speakWord } from './speech';

let currentAudio: HTMLAudioElement | null = null;

/**
 * 音声の優先順位:
 * 1. 単語に登録された音声URL（設定で優先が有効な場合）
 * 2. ブラウザの英語読み上げ
 * 3. どちらも使えなければ何もしない（発音記号表示のみ）
 *
 * 再生失敗でもアプリ全体は停止しない。
 */
export async function playWordAudio(word: Word, settings: AppSettings): Promise<boolean> {
  const tryRegistered = async (): Promise<boolean> => {
    if (!word.audioUrl) return false;
    try {
      if (currentAudio) {
        currentAudio.pause();
        currentAudio = null;
      }
      const audio = new Audio(word.audioUrl);
      audio.volume = settings.speechVolume;
      audio.playbackRate = settings.speechRate;
      currentAudio = audio;
      await audio.play();
      return true;
    } catch {
      return false;
    }
  };

  if (settings.preferRegisteredAudio && (await tryRegistered())) return true;
  if (speakWord(word.word, settings)) return true;
  if (!settings.preferRegisteredAudio && (await tryRegistered())) return true;
  return false;
}

/** 単語に何らかの音声手段があるか */
export function hasAudio(word: Word, settings: AppSettings): boolean {
  if (word.audioUrl) return true;
  return settings.speechEnabled && typeof speechSynthesis !== 'undefined';
}
