# $YJKW — やじゅかわミームコイン サイト

Solana ミームコイン **$YJKW (やじゅかわ / YAJUKAWA)** のコミュニティサイト。依存ゼロの静的サイトです(ビルド不要)。**日本語 / 英語のバイリンガル対応**(ブラウザ言語で自動判定+ヘッダーのトグルで切替、選択は保存)。

- CA: `6WqTZgmwi5ytyMaCFm88xoLPu26Bips35V4u6CCopump`
- X コミュニティ: https://x.com/i/communities/2038327343748730919
- LINE オープンチャット「ヤジュカワ YJKW コミュニティー」: https://line.me/ti/g2/mXHRwb6TejJAqhPZrjCuC_Na2dxY-K0DcHL38w?utm_source=invitation&utm_medium=link_copy&utm_campaign=default

## 構成

```
yjkw/
├── index.html          # 本体(全セクション、日本語がデフォルト)
├── site.webmanifest    # PWA マニフェスト
└── assets/
    ├── css/style.css   # デザイン・アニメーション
    ├── js/main.js      # スクロール演出・i18n辞書・ライブデータ・ゲーム
    └── img/            # コイン画像・YAJUKAWAバナー・OG画像・favicon
```

## 機能

- 日本語 / English 切り替え(JA・EN トグル、`localStorage` に保存、初回はブラウザ言語で自動判定)
- 慣性スムーススクロール(PC はホイールを lerp 補間、スマホはネイティブスクロール + 補間エフェクトでヌルヌル)
- スクロール連動: コイン回転 / パララックス / ブラー付きリビール / プログレスバー
- ライブ価格・時価総額・出来高・流動性(DexScreener API、30秒自動更新)+ チャート埋め込み(ペア生成後に自動表示)
- CA ワンタップコピー、コインレイン、やじゅかわクリッカー(localStorage 保存・X シェア)、FAQ、ロードマップ
- X コミュニティ / LINE オープンチャット導線(ヒーロー・メニュー・コミュニティ・フッター)
- レスポンシブ / `prefers-reduced-motion` 対応 / OGP・PWA アイコン完備

## 公開

Netlify にデプロイ済み(https://tourmaline-bunny-2d0b32.netlify.app)。
独自ドメインは **https://yjkw.xyz/**(canonical / OGP は yjkw.xyz 前提で設定済み)。

更新手順: このフォルダの中身を ZIP にして、Netlify の対象サイト →
**Deploys** タブにドラッグ&ドロップするだけ。静的ホスティングならどこでも動きます。
