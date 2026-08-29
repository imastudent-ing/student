# 英単語弱点反復学習PWA

すでに何周かした単語帳の**弱点だけを効率的に潰す**ための、日本語UI・オフライン対応の英単語復習アプリです。

新しい単語を覚えるアプリではありません。「その日の最後に答えられたか」ではなく、**別の日の最初の1回で即答できたか**を記録・評価することに特化しています。

## 主な機能

- **診断モード**: 範囲・語数を選んで全単語を一度判定し、弱点（weak）と習得済み（mastered）に振り分け
- **即答判定**: 単語表示から制限時間（初期値3秒、2〜5秒で変更可）以内の正解のみ「即答」。正解でも時間超過や「曖昧」は「遅答」
- **同日再テスト**: 遅答・不正解の単語だけを10〜20語後に再出題（最大3回）。再テストで正解しても翌日の復習予定・別日連続成功数・初回即答率は変わらない
- **弱点卒業**: 別々の日の初回回答で3回即答すると習得済みへ（1回目成功→3日後、2回目→7日後に再出題）
- **抜き打ち確認**: 習得済み単語から毎日約20語を重み付き抽出して確認。失敗すると弱点へ戻る
- **発音管理**: 「読み方が分からない」を意味の習得とは別に記録し、音声再生・発音復習ができる
- **セッション自動保存**: 画面を閉じても・リロードしても続きから再開できる
- **データ管理**: CSVインポート/エクスポート、JSONバックアップ/復元、1〜1900の空データ作成

## 技術構成

- Vite + React + TypeScript
- React Router（HashRouter）/ Zustand / Dexie.js（IndexedDB）/ date-fns / Papa Parse
- vite-plugin-pwa（Service Worker・オフラインキャッシュ・マニフェスト）
- テスト: Vitest + React Testing Library + Playwright

## 必要環境

- Node.js 20以上
- npm
- 動作対象: iPhone Safari / デスクトップ版 Chrome / デスクトップ版 Safari

## インストールと起動

```bash
npm install
npm run dev      # 開発サーバー
npm run test     # ユニットテスト（Vitest）
npm run build    # 型チェック + 本番ビルド（dist/ に静的ファイルを生成）
npm run preview  # ビルド結果のローカル確認
```

その他のコマンド:

```bash
npm run lint      # ESLint
npm run typecheck # tsc --noEmit
npm run test:e2e  # Playwright E2E（要ビルド済み or 自動でpreviewを起動）
npm run icons     # PWAアイコンPNGの再生成
```

## CSV形式

必須列: `number,word,meaning`
任意列: `secondary_meaning,pronunciation,phrase,phrase_meaning,audio_url,tags`

```csv
number,word,meaning,secondary_meaning,pronunciation,phrase,phrase_meaning,audio_url,tags
1,example,例,実例,,an example of,〜の例,,basic
2,retain,保持する,維持する,,retain information,情報を保持する,,important
```

- UTF-8 / BOM付きUTF-8 に対応
- インポート前にプレビューとエラー行の一覧を表示
- 既存番号と重複する場合は「上書き（学習履歴は保持）/ スキップ / 新規追加」を選択可能
- テンプレート: `sample-data/import-template.csv`（形式例のみ。市販単語帳のデータは含みません）

## バックアップ・復元

- 設定画面 → データ設定 → 「JSONバックアップ」で全データ（単語・進捗・履歴・設定）をファイル保存
- 「JSON復元」または初回起動画面の「バックアップから復元する」で読み込み
- CSVエクスポートは単語データのみ（進捗は含まれません）

## PWAとしてインストール（iPhone）

1. `npm run build` した `dist/` を任意の静的ホスティング（HTTPS必須）に配置するか、同一Wi-Fi内で `npm run preview -- --host` を開く
2. iPhoneのSafariでURLを開く
3. 共有ボタン →「ホーム画面に追加」
4. 以後はホーム画面のアイコンからフルスクリーンで起動でき、オフラインでも利用できます

## データの保存について（重要）

- データはすべて**この端末のブラウザ内（IndexedDB）**に保存されます。サーバーやログインはありません
- **ブラウザのデータ（サイトデータ）を削除すると学習データも消えます。**定期的にJSONバックアップを取ることを推奨します
- iOSでは長期間使用しないサイトのデータが自動削除される場合があります。ホーム画面に追加したPWAとして使うと保持されやすくなります

## 著作権に関する注意

- このアプリには**市販単語帳（ターゲット1900等）の本文・音声データは一切同梱されていません**
- 著作物のスクレイピングや無断取得は行いません
- 登録する単語・意味・フレーズ・音声URLは、**ユーザー自身が利用権を持つデータのみ**にしてください

## ライセンス

MIT License（`LICENSE` を参照）
