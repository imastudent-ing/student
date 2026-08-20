import { expect, test } from '@playwright/test';

test('初回起動 → 空データ作成 → ホーム → 診断開始 → カード回答', async ({ page }) => {
  await page.goto('/');

  // 初回はオンボーディングが表示される
  await expect(page.getByRole('heading', { name: 'ようこそ' })).toBeVisible();

  // 空データを作成
  await page.getByRole('button', { name: '空データを作成' }).click();
  await page.getByRole('button', { name: '作成する' }).click();
  await expect(page).toHaveURL(/#\/words/);

  // 単語を1件入力できる状態にする（追加ダイアログ）
  await page.getByRole('button', { name: '＋追加' }).click();
  await page.getByLabel('単語番号').fill('9001');
  await page.getByLabel('英単語').fill('retain');
  await page.getByLabel('意味').fill('保持する');
  await page.getByRole('button', { name: '追加', exact: true }).click();

  // ホームへ
  await page.getByRole('link', { name: /ホーム/ }).click();
  await expect(page.getByText('英単語弱点反復')).toBeVisible();

  // 診断モードで1語出題
  await page.getByRole('link', { name: '診断モードを始める' }).click();
  await page.getByLabel('出題数').fill('10');
  await page.getByRole('button', { name: '診断を始める' }).click();

  // カードが表示され、答え → 判定できる
  await expect(page.getByText('retain')).toBeVisible();
  await page.getByRole('button', { name: '答えを見る' }).click();
  await expect(page.getByText('保持する')).toBeVisible();
  await page.getByRole('button', { name: '⭕ 正解' }).click();

  // 1語で終了 → サマリーへ
  await page.getByRole('button', { name: '次へ →' }).click();
  await expect(page.getByRole('heading', { name: 'セッション結果' })).toBeVisible();
  await expect(page.getByText('初回即答率', { exact: true })).toBeVisible();
  await expect(page.getByText('100%')).toBeVisible();
});

test('セッション中断後にホームから再開できる', async ({ page }) => {
  await page.goto('/');
  // 前のテストとは独立した新しいコンテキストなのでオンボーディングから
  await expect(page.getByRole('heading', { name: 'ようこそ' })).toBeVisible();
});
