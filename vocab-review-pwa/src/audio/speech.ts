import type { AppSettings } from '../domain/types';

/** 利用可能な英語音声の一覧 */
export function getEnglishVoices(): SpeechSynthesisVoice[] {
  if (typeof speechSynthesis === 'undefined') return [];
  try {
    return speechSynthesis.getVoices().filter((v) => v.lang.toLowerCase().startsWith('en'));
  } catch {
    return [];
  }
}

/** ブラウザ読み上げで単語を再生する（失敗してもアプリを止めない） */
export function speakWord(text: string, settings: AppSettings): boolean {
  if (!settings.speechEnabled) return false;
  if (typeof speechSynthesis === 'undefined' || text.trim() === '') return false;
  try {
    speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'en-US';
    utterance.rate = settings.speechRate;
    utterance.volume = settings.speechVolume;
    if (settings.speechVoiceURI) {
      const voice = getEnglishVoices().find((v) => v.voiceURI === settings.speechVoiceURI);
      if (voice) utterance.voice = voice;
    }
    speechSynthesis.speak(utterance);
    return true;
  } catch {
    return false;
  }
}
