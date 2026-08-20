/** 単語編集フォームの検証 */
export interface WordFormInput {
  number: string;
  word: string;
  meaning: string;
}

export interface ValidationResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
}

export function validateWordForm(input: WordFormInput): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const num = Number(input.number.trim());
  if (input.number.trim() === '' || !Number.isInteger(num) || num <= 0) {
    errors.push('単語番号は正の整数で入力してください。');
  }
  if (input.word.trim() === '') warnings.push('英単語が空です。');
  if (input.meaning.trim() === '') warnings.push('意味が空です。');
  return { ok: errors.length === 0, errors, warnings };
}
