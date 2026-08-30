import type { AppSettings } from '../domain/types';

let cachedVoices: SpeechSynthesisVoice[] = [];

function refreshVoices(): void {
  if (typeof speechSynthesis === 'undefined') return;
  try {
    const voices = speechSynthesis.getVoices();
    if (voices.length > 0) cachedVoices = voices;
  } catch {
    // 取得失敗してもアプリは止めない
  }
}

if (typeof speechSynthesis !== 'undefined') {
  refreshVoices();
  try {
    // iOS Safari では音声リストが非同期で読み込まれる
    speechSynthesis.addEventListener('voiceschanged', refreshVoices);
  } catch {
    // addEventListener 非対応環境は無視
  }
}

/**
 * 英語音声の品質スコア。
 * iOSの高品質音声（Enhanced / Premium）や自然な定番ボイスを優先し、
 * 機械的な compact 音声を避ける。
 */
function scoreVoice(v: SpeechSynthesisVoice): number {
  const name = v.name.toLowerCase();
  const lang = v.lang.toLowerCase().replace('_', '-');
  let score = 0;
  if (lang.startsWith('en-us')) score += 4;
  else if (lang.startsWith('en-gb')) score += 3;
  else if (lang.startsWith('en')) score += 1;
  if (/(enhanced|premium|natural|neural)/.test(name)) score += 6;
  if (
    /(samantha|ava|allison|susan|zoe|evan|nathan|noelle|karen|daniel|serena|moira|tessa|alex|aaron)/.test(
      name
    )
  ) {
    score += 2;
  }
  if (v.localService) score += 1;
  if (/compact/.test(name)) score -= 4;
  return score;
}

/** 利用可能な英語音声を品質の高い順に返す */
export function getEnglishVoices(): SpeechSynthesisVoice[] {
  if (cachedVoices.length === 0) refreshVoices();
  return cachedVoices
    .filter((v) => v.lang.toLowerCase().replace('_', '-').startsWith('en'))
    .sort((a, b) => scoreVoice(b) - scoreVoice(a));
}

/** 音声リストの読み込み完了を監視する（解除関数を返す） */
export function onVoicesChanged(listener: () => void): () => void {
  if (typeof speechSynthesis === 'undefined') return () => {};
  const handler = () => {
    refreshVoices();
    listener();
  };
  try {
    speechSynthesis.addEventListener('voiceschanged', handler);
  } catch {
    return () => {};
  }
  return () => {
    try {
      speechSynthesis.removeEventListener('voiceschanged', handler);
    } catch {
      // 無視
    }
  };
}

/** 設定で選択された音声、なければ最も品質の高い英語音声を返す */
export function resolveVoice(settings: AppSettings): SpeechSynthesisVoice | null {
  const voices = getEnglishVoices();
  if (voices.length === 0) return null;
  if (settings.speechVoiceURI) {
    const chosen = voices.find((v) => v.voiceURI === settings.speechVoiceURI);
    if (chosen) return chosen;
  }
  return voices[0];
}

/** ブラウザ読み上げで単語を再生する（失敗してもアプリを止めない） */
export function speakWord(text: string, settings: AppSettings): boolean {
  if (!settings.speechEnabled) return false;
  if (typeof speechSynthesis === 'undefined' || text.trim() === '') return false;
  try {
    speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    const voice = resolveVoice(settings);
    if (voice) {
      utterance.voice = voice;
      utterance.lang = voice.lang;
    } else {
      utterance.lang = 'en-US';
    }
    utterance.rate = settings.speechRate;
    utterance.volume = settings.speechVolume;
    speechSynthesis.speak(utterance);
    return true;
  } catch {
    return false;
  }
}
