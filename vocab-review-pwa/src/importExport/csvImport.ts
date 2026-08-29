import Papa from 'papaparse';
import type { Word } from '../domain/types';
import { newId } from '../utils/ids';
import { nowIso } from '../utils/dates';

export const REQUIRED_COLUMNS = ['number', 'word', 'meaning'] as const;
export const OPTIONAL_COLUMNS = [
  'secondary_meaning',
  'pronunciation',
  'phrase',
  'phrase_meaning',
  'audio_url',
  'tags'
] as const;

export interface CsvRowError {
  rowNumber: number;
  message: string;
  raw: Record<string, string>;
}

export interface CsvRowWarning {
  rowNumber: number;
  message: string;
}

export interface ParsedCsvRow {
  rowNumber: number;
  number: number;
  word: string;
  meaning: string;
  secondaryMeaning?: string;
  pronunciation?: string;
  phrase?: string;
  phraseMeaning?: string;
  audioUrl?: string;
  tags: string[];
}

export interface CsvParseResult {
  ok: boolean;
  columnError: string | null;
  rows: ParsedCsvRow[];
  errors: CsvRowError[];
  warnings: CsvRowWarning[];
  /** ファイル内で番号が重複している行 */
  duplicateNumbers: number[];
}

/** CSV テキストを解析・検証する（BOM 付き UTF-8 対応） */
export function parseCsvText(text: string): CsvParseResult {
  const clean = text.replace(/^\uFEFF/, '');
  const parsed = Papa.parse<Record<string, string>>(clean, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim().toLowerCase()
  });

  const fields = (parsed.meta.fields ?? []).map((f) => f.trim().toLowerCase());
  const missing = REQUIRED_COLUMNS.filter((c) => !fields.includes(c));
  if (missing.length > 0) {
    return {
      ok: false,
      columnError: `必須列がありません: ${missing.join(', ')}`,
      rows: [],
      errors: [],
      warnings: [],
      duplicateNumbers: []
    };
  }

  const rows: ParsedCsvRow[] = [];
  const errors: CsvRowError[] = [];
  const warnings: CsvRowWarning[] = [];
  const numberCount = new Map<number, number>();

  parsed.data.forEach((raw, i) => {
    const rowNumber = i + 2; // ヘッダーが1行目
    const numberStr = (raw.number ?? '').trim();
    if (numberStr === '') {
      errors.push({ rowNumber, message: 'number が空です', raw });
      return;
    }
    const num = Number(numberStr);
    if (!Number.isInteger(num) || num <= 0) {
      errors.push({ rowNumber, message: `number が正の整数ではありません: ${numberStr}`, raw });
      return;
    }
    const word = (raw.word ?? '').trim();
    const meaning = (raw.meaning ?? '').trim();
    if (word === '') warnings.push({ rowNumber, message: `No.${num}: word が空です` });
    if (meaning === '') warnings.push({ rowNumber, message: `No.${num}: meaning が空です` });

    numberCount.set(num, (numberCount.get(num) ?? 0) + 1);
    rows.push({
      rowNumber,
      number: num,
      word,
      meaning,
      secondaryMeaning: (raw.secondary_meaning ?? '').trim() || undefined,
      pronunciation: (raw.pronunciation ?? '').trim() || undefined,
      phrase: (raw.phrase ?? '').trim() || undefined,
      phraseMeaning: (raw.phrase_meaning ?? '').trim() || undefined,
      audioUrl: (raw.audio_url ?? '').trim() || undefined,
      tags: (raw.tags ?? '')
        .split(/[;|/、]/)
        .map((t) => t.trim())
        .filter((t) => t !== '')
    });
  });

  const duplicateNumbers = [...numberCount.entries()]
    .filter(([, count]) => count > 1)
    .map(([num]) => num)
    .sort((a, b) => a - b);

  return {
    ok: errors.length === 0 && duplicateNumbers.length === 0,
    columnError: null,
    rows,
    errors,
    warnings,
    duplicateNumbers
  };
}

export type ConflictPolicy = 'overwrite' | 'skip' | 'add_new';

export interface ImportPlan {
  toCreate: Word[];
  toUpdate: Word[];
  skipped: ParsedCsvRow[];
}

/**
 * 既存データとの突き合わせを行い、インポート計画を作る。
 * 上書きの場合も既存の id を保つため、学習履歴（progress）は保持される。
 */
export function buildImportPlan(
  rows: ParsedCsvRow[],
  existingWords: Word[],
  policy: ConflictPolicy,
  includeDuplicates: boolean
): ImportPlan {
  const existingByNumber = new Map(existingWords.map((w) => [w.number, w]));
  const now = nowIso();
  const toCreate: Word[] = [];
  const toUpdate: Word[] = [];
  const skipped: ParsedCsvRow[] = [];
  const seenNumbers = new Set<number>();

  for (const row of rows) {
    if (seenNumbers.has(row.number) && !includeDuplicates) {
      skipped.push(row);
      continue;
    }
    seenNumbers.add(row.number);

    const fields = {
      number: row.number,
      word: row.word,
      meaning: row.meaning,
      secondaryMeaning: row.secondaryMeaning,
      pronunciation: row.pronunciation,
      phrase: row.phrase,
      phraseMeaning: row.phraseMeaning,
      audioUrl: row.audioUrl,
      tags: row.tags,
      updatedAt: now
    };
    const existing = existingByNumber.get(row.number);
    if (existing) {
      if (policy === 'skip') {
        skipped.push(row);
      } else if (policy === 'overwrite') {
        toUpdate.push({ ...existing, ...fields });
      } else {
        toCreate.push({ id: newId(), createdAt: now, ...fields });
      }
    } else {
      toCreate.push({ id: newId(), createdAt: now, ...fields });
    }
  }
  return { toCreate, toUpdate, skipped };
}
