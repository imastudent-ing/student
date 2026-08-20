import Papa from 'papaparse';
import type { Word } from '../domain/types';

/** 登録単語を CSV 文字列（BOM 付き UTF-8 用）へ変換する */
export function wordsToCsv(words: Word[]): string {
  const rows = [...words]
    .sort((a, b) => a.number - b.number)
    .map((w) => ({
      number: w.number,
      word: w.word,
      meaning: w.meaning,
      secondary_meaning: w.secondaryMeaning ?? '',
      pronunciation: w.pronunciation ?? '',
      phrase: w.phrase ?? '',
      phrase_meaning: w.phraseMeaning ?? '',
      audio_url: w.audioUrl ?? '',
      tags: w.tags.join(';')
    }));
  return '\uFEFF' + Papa.unparse(rows);
}
