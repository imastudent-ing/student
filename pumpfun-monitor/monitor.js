// pump.fun 新規コイン監視ボット
//
// 仕組み:
//  1. FUNDING_WALLETS で指定した「出金元ウォレット」のトランザクションを監視し、
//     SOL送金先ウォレットを自動で監視リストに追加する
//  2. pump.fun プログラムの Create 命令をWebSocketでリアルタイム監視し、
//     作成者が監視リスト内のウォレットならすぐ通知する (Telegram / Discord)

import { Connection, PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import * as dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, ".env") });

const PUMP_FUN_PROGRAM = new PublicKey("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");

const config = {
  rpcHttp: process.env.RPC_HTTP_URL || "https://api.mainnet-beta.solana.com",
  rpcWs: process.env.RPC_WS_URL || undefined, // 未指定ならHTTP URLから自動導出
  fundingWallets: (process.env.FUNDING_WALLETS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
  minFundingSol: parseFloat(process.env.MIN_FUNDING_SOL || "0.01"),
  watchDepth: parseInt(process.env.WATCH_DEPTH || "1", 10),
  maxWatched: parseInt(process.env.MAX_WATCHED || "500", 10),
  notifyOnFunding: (process.env.NOTIFY_ON_FUNDING || "true") === "true",
  telegramToken: process.env.TELEGRAM_BOT_TOKEN || "",
  telegramChatId: process.env.TELEGRAM_CHAT_ID || "",
  discordWebhook: process.env.DISCORD_WEBHOOK_URL || "",
  stateFile: path.join(__dirname, process.env.STATE_FILE || "watched-wallets.json"),
};

if (config.fundingWallets.length === 0) {
  console.error("エラー: FUNDING_WALLETS が設定されていません。.env を確認してください。");
  process.exit(1);
}

// ---------- 状態 (監視リスト) ----------

// watched: { address: { fundedBy, depth, sol, addedAt } }
let watched = {};
function loadState() {
  try {
    watched = JSON.parse(fs.readFileSync(config.stateFile, "utf8"));
  } catch {
    watched = {};
  }
}
function saveState() {
  fs.writeFileSync(config.stateFile, JSON.stringify(watched, null, 2));
}
loadState();

const fundingSet = new Set(config.fundingWallets);
function isWatchedCreator(address) {
  return fundingSet.has(address) || watched[address] !== undefined;
}

// ---------- 通知 ----------

async function notify(text) {
  console.log(`\n${new Date().toISOString()}\n${text}\n`);
  const jobs = [];
  if (config.telegramToken && config.telegramChatId) {
    jobs.push(
      fetch(`https://api.telegram.org/bot${config.telegramToken}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: config.telegramChatId,
          text,
          disable_web_page_preview: true,
        }),
      }).catch((e) => console.error("Telegram通知失敗:", e.message))
    );
  }
  if (config.discordWebhook) {
    jobs.push(
      fetch(config.discordWebhook, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: text }),
      }).catch((e) => console.error("Discord通知失敗:", e.message))
    );
  }
  await Promise.all(jobs);
}

// ---------- Solana接続 ----------

const connection = new Connection(config.rpcHttp, {
  wsEndpoint: config.rpcWs,
  commitment: "confirmed",
});

const seenSignatures = new Set();
function markSeen(sig) {
  if (seenSignatures.has(sig)) return true;
  seenSignatures.add(sig);
  if (seenSignatures.size > 10000) {
    const first = seenSignatures.values().next().value;
    seenSignatures.delete(first);
  }
  return false;
}

async function getTxWithRetry(signature, retries = 5) {
  for (let i = 0; i < retries; i++) {
    try {
      const tx = await connection.getParsedTransaction(signature, {
        commitment: "confirmed",
        maxSupportedTransactionVersion: 0,
      });
      if (tx) return tx;
    } catch (e) {
      console.error(`getParsedTransaction失敗 (${i + 1}/${retries}):`, e.message);
    }
    await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
  }
  return null;
}

// ---------- 1) 出金元ウォレット監視 → 送金先を監視リストへ ----------

const subscribedTransferWallets = new Set();

function subscribeTransfers(address, depth) {
  if (subscribedTransferWallets.has(address)) return;
  subscribedTransferWallets.add(address);
  const pubkey = new PublicKey(address);
  connection.onLogs(
    pubkey,
    async (logs) => {
      if (logs.err || markSeen(logs.signature)) return;
      await handlePossibleFunding(logs.signature, address, depth);
    },
    "confirmed"
  );
  console.log(`送金監視を開始: ${address} (depth=${depth})`);
}

async function handlePossibleFunding(signature, sourceAddress, depth) {
  const tx = await getTxWithRetry(signature);
  if (!tx || tx.meta?.err) return;

  const instructions = [
    ...tx.transaction.message.instructions,
    ...(tx.meta?.innerInstructions || []).flatMap((x) => x.instructions),
  ];

  for (const ix of instructions) {
    if (ix.program !== "system" || ix.parsed?.type !== "transfer") continue;
    const { source, destination, lamports } = ix.parsed.info;
    if (source !== sourceAddress || destination === sourceAddress) continue;

    const sol = lamports / LAMPORTS_PER_SOL;
    if (sol < config.minFundingSol) continue;
    if (isWatchedCreator(destination)) continue;
    if (Object.keys(watched).length >= config.maxWatched) {
      console.warn(`監視上限 (MAX_WATCHED=${config.maxWatched}) に達したため ${destination} を追加できません`);
      continue;
    }

    watched[destination] = {
      fundedBy: sourceAddress,
      depth: depth + 1,
      sol,
      addedAt: new Date().toISOString(),
    };
    saveState();

    // 多段追跡: WATCH_DEPTH が2以上なら送金先からのさらに先の送金も追う
    if (depth + 1 < config.watchDepth) {
      subscribeTransfers(destination, depth + 1);
    }

    const msg = [
      "👀 監視ウォレット追加",
      `出金元: ${sourceAddress}`,
      `送金先: ${destination}`,
      `金額: ${sol} SOL`,
      `https://solscan.io/account/${destination}`,
      `tx: https://solscan.io/tx/${signature}`,
    ].join("\n");
    if (config.notifyOnFunding) await notify(msg);
    else console.log(msg);
  }
}

// ---------- 2) pump.fun Create 命令の監視 ----------

function extractCreateInfo(tx) {
  // pump.fun Create命令: accounts[0]=mint, accounts[7]=creator(user)
  const all = [
    ...tx.transaction.message.instructions,
    ...(tx.meta?.innerInstructions || []).flatMap((x) => x.instructions),
  ];
  for (const ix of all) {
    if (!ix.programId?.equals?.(PUMP_FUN_PROGRAM)) continue;
    const accounts = ix.accounts;
    if (accounts && accounts.length >= 8) {
      return { mint: accounts[0].toBase58(), creator: accounts[7].toBase58() };
    }
  }
  // フォールバック: fee payer=作成者、それ以外の署名者=新規mint
  const keys = tx.transaction.message.accountKeys;
  const signers = keys.filter((k) => k.signer);
  if (signers.length >= 2) {
    return {
      creator: signers[0].pubkey.toBase58(),
      mint: signers[1].pubkey.toBase58(),
    };
  }
  return null;
}

async function handlePumpCreate(logs) {
  const tx = await getTxWithRetry(logs.signature);
  if (!tx || tx.meta?.err) return;

  const info = extractCreateInfo(tx);
  if (!info) return;

  if (!isWatchedCreator(info.creator)) return;

  const w = watched[info.creator];
  const chain = w ? `${w.fundedBy} → ${info.creator} (${w.sol} SOL供給)` : `${info.creator} (出金元ウォレット本人)`;

  await notify(
    [
      "🚨 pump.fun 新規コイン検知!",
      `ミント: ${info.mint}`,
      `作成者: ${info.creator}`,
      `資金経路: ${chain}`,
      `pump.fun: https://pump.fun/coin/${info.mint}`,
      `solscan: https://solscan.io/token/${info.mint}`,
      `tx: https://solscan.io/tx/${logs.signature}`,
    ].join("\n")
  );
}

function subscribePumpFun() {
  connection.onLogs(
    PUMP_FUN_PROGRAM,
    (logs) => {
      if (logs.err) return;
      const isCreate = logs.logs.some((l) => l.includes("Instruction: Create") && !l.includes("CreateIdempotent"));
      if (!isCreate || markSeen(logs.signature)) return;
      handlePumpCreate(logs).catch((e) => console.error("Create処理失敗:", e.message));
    },
    "processed"
  );
  console.log("pump.fun Create命令の監視を開始しました");
}

// ---------- ヘルスチェック ----------

let healthFailures = 0;
setInterval(async () => {
  try {
    await connection.getSlot();
    healthFailures = 0;
  } catch {
    healthFailures++;
    console.error(`ヘルスチェック失敗 (${healthFailures}/5)`);
    if (healthFailures >= 5) {
      console.error("RPC接続が回復しないため終了します (pm2等で自動再起動してください)");
      process.exit(1);
    }
  }
}, 60_000);

// ---------- 起動 ----------

console.log("=== pump.fun 新規コイン監視ボット ===");
console.log(`RPC: ${config.rpcHttp}`);
console.log(`出金元ウォレット: ${config.fundingWallets.join(", ")}`);
console.log(`最低送金額: ${config.minFundingSol} SOL / 監視中: ${Object.keys(watched).length}件`);

for (const w of config.fundingWallets) subscribeTransfers(w, 0);
// 既存の監視ウォレットのうち多段追跡対象を再購読
for (const [addr, meta] of Object.entries(watched)) {
  if (meta.depth < config.watchDepth) subscribeTransfers(addr, meta.depth);
}
subscribePumpFun();
