import {
  exportBackup,
  importBackup,
  isValidBackup,
  type BackupPayload
} from '../db/repositories';

export async function createBackupJson(): Promise<string> {
  const payload = await exportBackup();
  return JSON.stringify(payload, null, 2);
}

export async function restoreFromJson(text: string): Promise<void> {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('JSONの解析に失敗しました。バックアップファイルを確認してください。');
  }
  if (!isValidBackup(data)) {
    throw new Error('このアプリのバックアップ形式ではありません。');
  }
  await importBackup(data as BackupPayload);
}

/** ファイルをダウンロードさせる */
export function downloadFile(filename: string, content: string, mime: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
