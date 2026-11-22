import { expect, test, type Page } from '@playwright/test';

async function importCsv(page: Page, word: string, meaning: string) {
  await page.getByLabel('CSVファイルを選択').setInputFiles({
    name: 'words.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(`number,word,meaning\n1,${word},${meaning}\n`)
  });
  await expect(page.getByRole('heading', { name: 'プレビュー' })).toBeVisible();
  await page.getByRole('button', { name: 'インポート実行' }).click();
  await expect(page.getByRole('heading', { name: 'プレビュー' })).toHaveCount(0);
}

test('同じ番号を別の単語帳に取り込み、履歴・統計・途中の学習を分けて保持する', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'ようこそ' })).toBeVisible();
  await importCsv(page, 'retain', '保持する');

  // 1冊目で診断を始め、回答前の状態を残す。
  await page.getByRole('link', { name: /ホーム/ }).click();
  await page.getByRole('link', { name: '診断モードを始める' }).click();
  await page.getByRole('button', { name: '診断を始める', exact: true }).click();
  await expect(page.getByText('retain', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '一時停止' }).click();
  await page.getByRole('button', { name: 'ホームへ戻る', exact: true }).click();
  await expect(page.getByRole('button', { name: '続きから再開' })).toBeVisible();

  await page.getByRole('button', { name: '＋単語帳を追加' }).click();
  await page.getByLabel('単語帳名', { exact: true }).fill('英熟語帳');
  await page.getByRole('button', { name: '作成する', exact: true }).click();
  await expect(page.getByLabel('学習する単語帳')).toHaveValue(/.+/);
  await expect(page.getByRole('button', { name: '続きから再開' })).toHaveCount(0);
  await importCsv(page, 'look forward to', '〜を楽しみにする');
  await page.getByRole('link', { name: /単語/ }).click();
  await expect(page.getByText('look forward to', { exact: true })).toBeVisible();
  await expect(page.getByText('retain', { exact: true })).toHaveCount(0);

  await page.getByRole('link', { name: /ホーム/ }).click();
  await page.getByRole('link', { name: '診断モードを始める' }).click();
  await page.getByRole('button', { name: '診断を始める', exact: true }).click();
  await expect(page.getByText('look forward to', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '答えを見る' }).click();
  await page.getByRole('button', { name: '⭕ 正解' }).click();
  await page.getByRole('button', { name: '次へ →' }).click();
  await expect(page.getByRole('heading', { name: 'セッション結果' })).toBeVisible();

  await page.getByLabel('学習する単語帳').selectOption({ label: 'これまでの単語帳' });
  await expect(page.getByRole('button', { name: '続きから再開' })).toBeVisible();
  await page.getByRole('link', { name: /統計/ }).click();
  await expect(page.getByText('まだ学習記録がありません。')).toBeVisible();
  await page.getByRole('link', { name: /ホーム/ }).click();
  await page.getByRole('button', { name: '続きから再開' }).click();
  await expect(page.getByText('retain', { exact: true })).toBeVisible();
  await expect(page.getByText('look forward to', { exact: true })).toHaveCount(0);

  // 再読み込みしても選択中の単語帳とセッションを維持する。
  await page.reload();
  await expect(page.getByText('retain', { exact: true })).toBeVisible();
});
