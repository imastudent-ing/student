# LAPTOP Base First-Block Sniper

Rust bot that buys `$LAPTOP` (`0xb095274743941e953c746f9c228da9c18bb6ec29`) on Base
inside the **same normal block** as the Uniswap v4 launch transaction, using Base
Flashblocks pre-confirmations to detect the launch ~200 ms after the sequencer
orders it, instead of waiting for the 2 s block or an off-chain alert.

```
Base Flashblocks WSS ── eth_subscribe("pendingLogs", {PoolManager, [Initialize, ModifyLiquidity, Swap]})
        │
        ▼  (one log per frame, t_recv stamped)
  decode topic0 ──▶ Initialize(currency0/1 ∋ LAPTOP) ──▶ guards (counter currency, hooks, fee, tickSpacing)
        │                                                        │
        │                                              POOL_SEEN: buy tx pre-signed (nonce/fees already cached)
        ▼
  ModifyLiquidity(poolId == target, liquidityDelta > 0) ──▶ TRIGGERED ──▶ eth_sendRawTransaction ×N ──▶ SENT
        │
        ▼
  poll eth_getTransactionReceipt ──▶ result.json: launch_block_number vs our_buy_block_number
```

Success criterion for the MVP: `launch_block_number == our_buy_block_number`
(`"outcome": "same_block"` in `result.json`).

## Status

| Phase | State |
| --- | --- |
| P0 compile / release build | `cargo build --release` clean, `cargo test` 17 tests (incl. an end-to-end run of the binary against a mock Flashblocks WSS + JSON-RPC server, `tests/e2e_mock.rs`), clippy clean |
| P0 Flashblocks decode / detection / latency logging | implemented; unit-tested with synthetic frames |
| P0 live connection to `wss://mainnet-preconf.base.org` | **not yet exercised** — the development sandbox had no egress to Base endpoints. First thing to do on a real machine: `MODE=listen cargo run --release` and read `sniper.jsonl` |
| P1 buy calldata / local signing / submission / price + one-shot protection | implemented; calldata layout unit-tested against the Universal Router / v4-periphery decoders |
| P2 same-block experiment | run `MODE=dry_run` on other v4 launches first, then `MODE=live` on a small amount |

## Verified reference facts (Sept 2026)

* **Flashblocks API** (base/docs `base-chain/api-reference/flashblocks-api/*`):
  `eth_subscribe("pendingLogs", {address, topics})` emits one pre-confirmed log per
  message; `eth_subscribe("newFlashblockTransactions", true)` gives full tx + receipt
  fields (`blockNumber`, `transactionIndex`, `status`, `logs`) per pre-confirmed tx;
  `"pending"` block tag resolves against Flashblocks state on all `eth_*` reads.
  The docs are inconsistent about whether the public `wss://mainnet-preconf.base.org`
  serves `eth_subscribe` (the `pendingLogs` page says yes, the RPC overview says public
  endpoints are HTTP-only). `WS_URL` is configurable; fall back to a Flashblocks-aware
  WebSocket provider if the subscribe is rejected (the bot logs the rejection verbatim).
* **Base has announced Flashblocks will be deprecated in the upcoming Cobalt hardfork**
  (canonical 200 ms blocks instead). If LAPTOP launches after Cobalt, the same code
  works with a normal `logs` subscription: change the subscription name in
  `src/flashblocks.rs` and the "same block" target becomes "same 200 ms block".
* **Uniswap v4 on Base** (docs.uniswap.org deployments, `Uniswap/universal-router`
  `deploy-addresses/base.json`):
  PoolManager `0x498581ff718922c3f8e6a244956af099b2652b2b`,
  UniversalRouterV2 `0x6ff5693b99212da76ad316178a184ab56d299b43`
  (built from v4-periphery `444c526` → `ExactInputSingleParams` has **no** `minHopPriceX36`),
  UniversalRouter 2.1.1 `0xfdf682f51fe81aa4898f0ae2163d8a55c127fbc7`
  (v4-periphery `3231810` → **has** `minHopPriceX36`). Select with `ROUTER_VERSION`.
  Permit2 `0x000000000022D473030F116dDEE9F6B43aC78BA3` (not needed: we pay native ETH
  via `msg.value`, or wrap inside the router for WETH pools).
* **Events** (`IPoolManager.sol`): `Initialize(bytes32 indexed id, address indexed
  currency0, address indexed currency1, uint24 fee, int24 tickSpacing, address hooks,
  uint160 sqrtPriceX96, int24 tick)`, `ModifyLiquidity(bytes32 indexed id, address
  indexed sender, int24 tickLower, int24 tickUpper, int256 liquidityDelta, bytes32 salt)`,
  `Swap(...)`. `PoolId = keccak256(abi.encode(PoolKey))` is recomputed and checked.
* **Swap route**: `execute(commands, inputs, deadline)` with `V4_SWAP (0x10)` →
  actions `SWAP_EXACT_IN_SINGLE (0x06)`, `SETTLE_ALL (0x0c)`, `TAKE_ALL (0x0f)`;
  for WETH-paired pools `WRAP_ETH (0x0b)` to `ADDRESS_THIS` then `SETTLE (0x0b,
  payerIsUser=false)`. Encodings match `CalldataDecoder.sol` strict layout (tests in
  `src/executor.rs`).

## Build

```bash
cd laptop_base_sniper
cargo build --release
cargo test
```

## Run

```bash
cp .env.example .env   # edit; never commit .env
MODE=listen ./target/release/laptop_base_sniper        # P0: watch real PoolManager events
MODE=dry_run ./target/release/laptop_base_sniper       # signs + eth_call("pending") simulation, never sends
MODE=live ./target/release/laptop_base_sniper          # sends once
```

Every event is written to `LOG_FILE` (JSON Lines) with `ts_unix_ns`, and the hot path
records `Instant`-based micro-second deltas:

* `decode_us` – WebSocket frame received → log decoded
* `recv_to_trigger_us` – frame received → state machine fired
* `sign_us` – signing cost (done at POOL_SEEN, i.e. before the trigger)
* `trigger_to_send_us`, `recv_to_send_us` – trigger → `eth_sendRawTransaction` started
* `send_ok.rtt_us` per endpoint – request → node acknowledged the hash
* `RESULT.latency_us.*` – full chain incl. receipt

`RESULT_FILE` holds the verdict: `launch_block_number`, `launch_tx_index`,
`our_buy_block_number`, `our_buy_tx_index`, `block_delta`, `outcome`
(`same_block` / `later_block` / `reverted` / `receipt_timeout`).

## Safety guards (always on)

* `BUY_AMOUNT_ETH` is the exact `msg.value`; `MAX_BUY_AMOUNT_ETH` is a hard cap checked at startup.
* `amountOutMinimum = max(quote_at_initialize_price × (1 − SLIPPAGE_BPS), MIN_OUT_TOKENS)`;
  a zero minimum is refused. The router reverts with `V4TooLittleReceived` otherwise.
* Pool verification: currencies must be exactly `{COUNTER_CURRENCY, TARGET_TOKEN}`,
  `hooks ∈ ALLOWED_HOOKS` (default: only `address(0)`), optional `ALLOWED_FEES` /
  `ALLOWED_TICK_SPACINGS`. A pool with an unknown hook is logged as `pool_rejected`
  and the bot stays `ARMED`.
* One-shot: `ARMED → POOL_SEEN → TRIGGERED → SENT → DONE` via atomic CAS; duplicate
  log deliveries are de-duplicated by `(txHash, logIndex)`.
* No blind retry: a failed or reverted send is reported, never re-sent.
* Private key only from `PRIVATE_KEY` env / `.env`; it is never logged. Use a dedicated
  wallet holding only `BUY_AMOUNT_ETH + gas`.

## Hot-path philosophy

The WebSocket reader task does: parse → topic compare → (rare) ABI decode → CAS →
`tokio::spawn` the HTTP sends. No disk I/O, no RPC round trips, no formatting beyond
building a `serde_json::Value` that is pushed to an unbounded channel. Nonce, base fee
and the signed transaction are refreshed by a background task every `REFRESH_SECS`.

## Next steps (in order)

1. On a machine with Base egress: `MODE=listen`, confirm `ws_subscribed` and real
   `initialize` / `modify_liquidity` frames with timestamps. If `eth_subscribe` is
   rejected on the public endpoint, set `WS_URL` to a Flashblocks-aware provider.
2. Point `TARGET_TOKEN` at a few random new v4 launches with `MODE=dry_run` and look
   at `simulation_ok` / `simulation_reverted` plus `recv_to_ready_us`.
3. `MODE=live` with a tiny `BUY_AMOUNT_ETH` on such launches; collect `result.json`
   over ≥20 launches; compute same-block rate and p50/p95 `recv_to_send_us`.
4. Only then: multiple `SEND_URLS`, region choice, own node.
5. Before the real LAPTOP launch decide `ALLOWED_HOOKS` / `COUNTER_CURRENCY` from the
   announced pool parameters (do not assume `hooks = 0`).
