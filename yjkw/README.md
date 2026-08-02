# $YJKW — 白くまミームコイン サイト

Solana ミームコイン **$YJKW** のコミュニティサイト。依存ゼロの静的サイトです(ビルド不要)。

- CA: `6WqTZgmwi5ytyMaCFm88xoLPu26Bips35V4u6CCopump`
- X コミュニティ: https://x.com/i/communities/2038327343748730919

## 構成

```
yjkw/
├── index.html          # 本体(全セクション)
├── site.webmanifest    # PWA マニフェスト
└── assets/
    ├── css/style.css   # デザイン・アニメーション
    ├── js/main.js      # スクロール演出・ライブデータ・ゲーム
    └── img/            # コイン画像・OG画像・favicon
```

## 機能

- 慣性スムーススクロール(PC はホイールを lerp 補間、スマホはネイティブスクロール + 補間エフェクトでヌルヌル)
- スクロール連動: コイン回転 / パララックス / ブラー付きリビール / プログレスバー
- ライブ価格・時価総額・出来高・流動性(DexScreener API、30秒自動更新)+ チャート埋め込み(ペア生成後に自動表示)
- CA ワンタップコピー、コインレイン、白くまクリッカー(localStorage 保存・X シェア)、FAQ、ロードマップ
- レスポンシブ / `prefers-reduced-motion` 対応 / OGP・PWA アイコン完備

## 公開方法

静的ホスティングならどこでも動きます。GitHub Pages の場合はリポジトリの
**Settings → Pages → Deploy from a branch** で `main` を選ぶと
`https://<user>.github.io/student/yjkw/` で公開されます。
