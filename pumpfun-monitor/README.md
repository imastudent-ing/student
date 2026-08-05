# pump.fun 新規コイン監視ボット

指定した「出金元ウォレット」からSOLが送られたウォレットを自動追跡し、
そのウォレットが pump.fun で新規コインを作成した瞬間に Telegram / Discord へ通知するボットです。

## 仕組み

```
出金元ウォレット (あなたが指定)
      │ SOL送金を検知
      ▼
送金先ウォレット ──→ 自動で監視リストに追加 (watched-wallets.json に保存)
      │ pump.fun で Create 命令を実行
      ▼
🚨 即時通知 (ミントアドレス / 作成者 / 資金経路 / pump.funリンク)
```

- 出金元ウォレットのトランザクションをWebSocketで監視し、SOL送金先を監視リストへ自動追加
- pump.fun プログラム (`6EF8...F6P`) の `Create` 命令を `processed` コミットメントでリアルタイム検知
- 作成者が「監視リスト内 or 出金元本人」なら即通知
- 監視リストはファイル保存されるので再起動しても引き継がれます

## セットアップ

```bash
cd pumpfun-monitor
npm install
cp .env.example .env
# .env を編集して FUNDING_WALLETS と通知先を設定
npm start
```

### 必須設定 (.env)

| 変数 | 説明 |
|---|---|
| `FUNDING_WALLETS` | 監視する出金元ウォレット (カンマ区切りで複数可) |
| `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` | Telegram通知を使う場合 |
| `DISCORD_WEBHOOK_URL` | Discord通知を使う場合 |

### RPCについて (重要)

デフォルトの公共RPC (`api.mainnet-beta.solana.com`) はWebSocket購読の制限が厳しく、
通知が遅れたり切断されたりします。**[Helius](https://helius.dev) などの無料APIキーの利用を強く推奨**します:

```
RPC_HTTP_URL=https://mainnet.helius-rpc.com/?api-key=あなたのキー
```

### オプション設定

| 変数 | デフォルト | 説明 |
|---|---|---|
| `MIN_FUNDING_SOL` | `0.01` | この金額未満の送金は無視 |
| `WATCH_DEPTH` | `1` | 資金追跡の深さ。`2` にすると送金先からさらに先への送金も追跡 |
| `MAX_WATCHED` | `500` | 監視ウォレット数の上限 |
| `NOTIFY_ON_FUNDING` | `true` | ウォレットが監視リストに追加された時にも通知 |

## 常時稼働させる

RPC接続が長時間回復しない場合はプロセスが自動終了する設計なので、
pm2 などで自動再起動させてください:

```bash
npm install -g pm2
pm2 start monitor.js --name pumpfun-monitor
pm2 save
```

## 通知例

```
🚨 pump.fun 新規コイン検知!
ミント: AbC...pump
作成者: XyZ...
資金経路: 出金元ウォレット → XyZ... (0.5 SOL供給)
pump.fun: https://pump.fun/coin/AbC...pump
solscan: https://solscan.io/token/AbC...pump
tx: https://solscan.io/tx/...
```

## 注意

- 検知はほぼリアルタイムですが、送金直後の数秒以内にコイン作成された場合、
  監視リスト追加が間に合わず通知を逃す可能性があります (RPCの速度に依存)
- Node.js 18以上が必要です
