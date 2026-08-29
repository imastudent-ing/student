import { describe, expect, it } from 'vitest';
import { buildImportPlan, parseCsvText } from '../importExport/csvImport';
import { wordsToCsv } from '../importExport/csvExport';
import type { Word } from '../domain/types';

const VALID_CSV = `number,word,meaning,secondary_meaning,pronunciation,phrase,phrase_meaning,audio_url,tags
1,example,例,実例,,an example of,〜の例,,basic
2,retain,保持する,維持する,,retain information,情報を保持する,,important`;

describe('CSVインポート', () => {
  it('正常なCSVを解析できる', () => {
    const result = parseCsvText(VALID_CSV);
    expect(result.ok).toBe(true);
    expect(result.rows.length).toBe(2);
    expect(result.rows[0]).toMatchObject({ number: 1, word: 'example', meaning: '例' });
    expect(result.rows[1].tags).toEqual(['important']);
  });

  it('BOM付きUTF-8を扱える', () => {
    const result = parseCsvText('\uFEFF' + VALID_CSV);
    expect(result.ok).toBe(true);
    expect(result.rows.length).toBe(2);
  });

  it('必須列の不足を検出できる', () => {
    const result = parseCsvText('number,word\n1,example');
    expect(result.ok).toBe(false);
    expect(result.columnError).toContain('meaning');
  });

  it('number が空の行はエラーになる', () => {
    const result = parseCsvText('number,word,meaning\n,example,例');
    expect(result.errors.length).toBe(1);
    expect(result.ok).toBe(false);
  });

  it('word / meaning が空の行は警告になる', () => {
    const result = parseCsvText('number,word,meaning\n1,,例\n2,test,');
    expect(result.errors.length).toBe(0);
    expect(result.warnings.length).toBe(2);
  });

  it('重複番号を検出できる', () => {
    const result = parseCsvText('number,word,meaning\n1,a,あ\n1,b,い');
    expect(result.duplicateNumbers).toEqual([1]);
    expect(result.ok).toBe(false);
  });
});

describe('インポート計画', () => {
  const existing: Word[] = [
    {
      id: 'existing-1',
      number: 1,
      word: 'old',
      meaning: '古い',
      tags: [],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z'
    }
  ];
  const rows = parseCsvText(VALID_CSV).rows;

  it('上書き時は既存 id を保持する（学習履歴が保持される）', () => {
    const plan = buildImportPlan(rows, existing, 'overwrite', false);
    expect(plan.toUpdate.length).toBe(1);
    expect(plan.toUpdate[0].id).toBe('existing-1');
    expect(plan.toUpdate[0].word).toBe('example');
    expect(plan.toCreate.length).toBe(1);
  });

  it('スキップ時は既存番号を変更しない', () => {
    const plan = buildImportPlan(rows, existing, 'skip', false);
    expect(plan.toUpdate.length).toBe(0);
    expect(plan.skipped.length).toBe(1);
    expect(plan.toCreate.length).toBe(1);
  });

  it('新規追加時は別レコードとして作成する', () => {
    const plan = buildImportPlan(rows, existing, 'add_new', true);
    expect(plan.toCreate.length).toBe(2);
    expect(plan.toCreate.every((w) => w.id !== 'existing-1')).toBe(true);
  });
});

describe('CSVエクスポート', () => {
  it('往復変換できる', () => {
    const words: Word[] = [
      {
        id: 'a',
        number: 1,
        word: 'example',
        meaning: '例',
        secondaryMeaning: '実例',
        tags: ['basic'],
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z'
      }
    ];
    const csv = wordsToCsv(words);
    const parsed = parseCsvText(csv);
    expect(parsed.ok).toBe(true);
    expect(parsed.rows[0]).toMatchObject({ number: 1, word: 'example', meaning: '例' });
  });
});
