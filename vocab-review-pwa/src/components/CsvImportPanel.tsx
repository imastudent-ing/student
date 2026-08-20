import { useRef, useState } from 'react';
import {
  buildImportPlan,
  parseCsvText,
  type ConflictPolicy,
  type CsvParseResult
} from '../importExport/csvImport';
import { bulkPutWords, getAllWords } from '../db/repositories';
import { useUiStore } from '../stores/uiStore';

interface Props {
  onImported?: (count: number) => void;
}

export function CsvImportPanel({ onImported }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [parseResult, setParseResult] = useState<CsvParseResult | null>(null);
  const [conflictCount, setConflictCount] = useState(0);
  const [policy, setPolicy] = useState<ConflictPolicy>('overwrite');
  const [importValidOnly, setImportValidOnly] = useState(true);
  const [busy, setBusy] = useState(false);
  const showToast = useUiStore((s) => s.showToast);

  const handleFile = async (file: File) => {
    setBusy(true);
    try {
      const text = await file.text();
      const result = parseCsvText(text);
      setParseResult(result);
      if (!result.columnError) {
        const existing = await getAllWords();
        const existingNumbers = new Set(existing.map((w) => w.number));
        setConflictCount(result.rows.filter((r) => existingNumbers.has(r.number)).length);
      }
    } catch {
      showToast('ファイルの読み込みに失敗しました。', 'error');
    } finally {
      setBusy(false);
    }
  };

  const doImport = async () => {
    if (!parseResult || parseResult.columnError) return;
    if (parseResult.errors.length > 0 && !importValidOnly) {
      showToast('エラー行があります。正常行のみ取り込むか、CSVを修正してください。', 'error');
      return;
    }
    if (parseResult.duplicateNumbers.length > 0 && policy !== 'add_new' && !importValidOnly) {
      showToast('重複番号があります。処理方法を選択してください。', 'error');
      return;
    }
    setBusy(true);
    try {
      const existing = await getAllWords();
      const plan = buildImportPlan(parseResult.rows, existing, policy, policy === 'add_new');
      await bulkPutWords([...plan.toCreate, ...plan.toUpdate]);
      const count = plan.toCreate.length + plan.toUpdate.length;
      showToast(
        `${count}語を取り込みました（新規${plan.toCreate.length}・更新${plan.toUpdate.length}・スキップ${plan.skipped.length}）`,
        'success'
      );
      setParseResult(null);
      if (fileRef.current) fileRef.current.value = '';
      onImported?.(count);
    } catch {
      showToast('インポートに失敗しました。', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="csv-import">
      <input
        ref={fileRef}
        type="file"
        accept=".csv,text/csv"
        aria-label="CSVファイルを選択"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void handleFile(file);
        }}
        disabled={busy}
      />
      {parseResult && (
        <div className="csv-preview">
          {parseResult.columnError ? (
            <p className="error-text">{parseResult.columnError}</p>
          ) : (
            <>
              <h3>プレビュー</h3>
              <p>
                読み込み行数: {parseResult.rows.length} / エラー行: {parseResult.errors.length} /
                警告: {parseResult.warnings.length}
              </p>
              {parseResult.duplicateNumbers.length > 0 && (
                <p className="error-text">
                  ファイル内で番号が重複しています: {parseResult.duplicateNumbers.slice(0, 10).join(', ')}
                  {parseResult.duplicateNumbers.length > 10 && ' …'}
                </p>
              )}
              {conflictCount > 0 && (
                <div className="csv-conflict">
                  <p>既存の番号と一致する行が {conflictCount} 件あります。処理方法:</p>
                  <label>
                    <input
                      type="radio"
                      checked={policy === 'overwrite'}
                      onChange={() => setPolicy('overwrite')}
                    />
                    上書き（学習履歴は保持）
                  </label>
                  <label>
                    <input
                      type="radio"
                      checked={policy === 'skip'}
                      onChange={() => setPolicy('skip')}
                    />
                    スキップ
                  </label>
                  <label>
                    <input
                      type="radio"
                      checked={policy === 'add_new'}
                      onChange={() => setPolicy('add_new')}
                    />
                    新規として追加
                  </label>
                </div>
              )}
              {parseResult.errors.length > 0 && (
                <div className="csv-errors">
                  <h4>エラー行</h4>
                  <ul>
                    {parseResult.errors.slice(0, 20).map((e) => (
                      <li key={e.rowNumber}>
                        {e.rowNumber}行目: {e.message}
                      </li>
                    ))}
                  </ul>
                  <label>
                    <input
                      type="checkbox"
                      checked={importValidOnly}
                      onChange={(e) => setImportValidOnly(e.target.checked)}
                    />
                    正常行のみ取り込む
                  </label>
                </div>
              )}
              {parseResult.warnings.length > 0 && (
                <details>
                  <summary>警告 {parseResult.warnings.length} 件</summary>
                  <ul>
                    {parseResult.warnings.slice(0, 20).map((w, i) => (
                      <li key={i}>{w.message}</li>
                    ))}
                  </ul>
                </details>
              )}
              <table className="csv-table">
                <thead>
                  <tr>
                    <th>No.</th>
                    <th>単語</th>
                    <th>意味</th>
                  </tr>
                </thead>
                <tbody>
                  {parseResult.rows.slice(0, 10).map((r) => (
                    <tr key={r.rowNumber}>
                      <td>{r.number}</td>
                      <td>{r.word}</td>
                      <td>{r.meaning}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {parseResult.rows.length > 10 && <p>…ほか {parseResult.rows.length - 10} 行</p>}
              <button
                className="btn btn-primary"
                onClick={() => void doImport()}
                disabled={
                  busy ||
                  parseResult.rows.length === 0 ||
                  (parseResult.errors.length > 0 && !importValidOnly)
                }
              >
                インポート実行
              </button>
            </>
          )}
        </div>
      )}
      <p className="hint">
        形式: number,word,meaning（必須）+
        secondary_meaning,pronunciation,phrase,phrase_meaning,audio_url,tags（任意）。UTF-8 /
        BOM付きUTF-8対応。
      </p>
    </div>
  );
}
