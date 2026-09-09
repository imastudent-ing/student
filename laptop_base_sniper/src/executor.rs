//! Buy transaction construction, signing and submission.
//!
//! Route: Universal Router `execute(commands, inputs, deadline)` with
//! `V4_SWAP` → [SWAP_EXACT_IN_SINGLE, SETTLE_ALL|SETTLE, TAKE_ALL].
//!
//! * Native ETH in: `tx.value = amountIn`; `SETTLE_ALL(ETH, amountIn)` makes the
//!   router call `poolManager.settle{value}` from its own balance (DeltaResolver).
//! * WETH in: `WRAP_ETH(ADDRESS_THIS, amountIn)` first, then `SETTLE(WETH,
//!   amountIn, payerIsUser=false)` so the router pays from its own WETH
//!   balance — no Permit2 approval needed.
//!
//! Price protection is enforced on-chain by `amountOutMinimum` (router reverts
//! with `V4TooLittleReceived`) and by `TAKE_ALL(minAmount)`.

use alloy::consensus::{SignableTransaction, TxEip1559, TxEnvelope};
use alloy::eips::eip2718::Encodable2718;
use alloy::primitives::{hex, Address, Bytes, TxKind, B256, U256, U512};
use alloy::network::TxSignerSync;
use alloy::signers::local::PrivateKeySigner;
use alloy::sol_types::{SolCall, SolValue};
use anyhow::{anyhow, bail, Context, Result};
use serde_json::json;
use std::time::Instant;

use crate::abi::{self, action_constants, actions, commands, PoolKey};
#[cfg(test)]
use crate::abi::{i24, u24};
use crate::config::{Config, RouterVersion};

/// Everything needed to send in one step.
#[derive(Debug, Clone)]
pub struct SignedBuy {
    pub tx_hash: B256,
    pub raw_hex: String,
    pub raw_len: usize,
    pub nonce: u64,
    pub max_fee_per_gas: u128,
    pub priority_fee: u128,
    pub gas_limit: u64,
    pub value: U256,
    pub amount_in: u128,
    pub min_out: u128,
    pub deadline: u64,
    pub calldata: Bytes,
    pub t_signed: Instant,
    pub sign_micros: u128,
}

pub struct Wallet {
    pub signer: PrivateKeySigner,
    pub address: Address,
}

impl Wallet {
    pub fn from_hex(pk: &str) -> Result<Wallet> {
        let signer: PrivateKeySigner = pk.trim().parse().map_err(|_| anyhow!("PRIVATE_KEY is not a valid secp256k1 key"))?;
        let address = signer.address();
        Ok(Wallet { signer, address })
    }
}

/// Expected output for `amount_in` at the pool's current sqrtPriceX96
/// (ignores fee and price impact — those are covered by `slippage_bps`).
///
/// price(token1 per token0) = (sqrtPriceX96 / 2^96)^2.
pub fn quote_at_sqrt_price(sqrt_price_x96: U256, amount_in: U256, zero_for_one: bool) -> U256 {
    let sp = U512::from(sqrt_price_x96);
    let sp2 = sp * sp; // < 2^320
    let amt = U512::from(amount_in);
    let out = if zero_for_one {
        (amt * sp2) >> 192
    } else {
        if sp2.is_zero() {
            return U256::ZERO;
        }
        (amt << 192) / sp2
    };
    u512_to_u256_saturating(out)
}

fn u512_to_u256_saturating(v: U512) -> U256 {
    let l = v.as_limbs();
    if l[4..].iter().any(|x| *x != 0) {
        U256::MAX
    } else {
        U256::from_limbs([l[0], l[1], l[2], l[3]])
    }
}

/// Compute `amountOutMinimum`: max(quote × (1 − slippage), configured floor), capped to uint128.
pub fn min_out_for(cfg: &Config, sqrt_price_x96: U256, zero_for_one: bool) -> Result<u128> {
    let quote = quote_at_sqrt_price(sqrt_price_x96, cfg.buy_amount_wei, zero_for_one);
    let with_slippage = quote * U256::from(10_000u32 - cfg.slippage_bps) / U256::from(10_000u32);
    let min_out = if with_slippage > cfg.min_out_tokens { with_slippage } else { cfg.min_out_tokens };
    if min_out.is_zero() {
        bail!("computed amountOutMinimum is zero — refusing an unprotected buy (set MIN_OUT_TOKENS or check price)");
    }
    let capped = if min_out > U256::from(u128::MAX) { u128::MAX } else { min_out.to::<u128>() };
    Ok(capped)
}

/// Build Universal Router calldata and the ETH value to attach.
pub fn build_calldata(cfg: &Config, key: &PoolKey, zero_for_one: bool, amount_in: u128, min_out: u128, deadline: u64) -> (Bytes, U256) {
    let currency_in = if zero_for_one { key.currency0 } else { key.currency1 };
    let currency_out = if zero_for_one { key.currency1 } else { key.currency0 };

    // Action 1: swap.
    let swap_params: Vec<u8> = match cfg.router_version {
        RouterVersion::V2 => abi::ExactInputSingleParamsV2 {
            poolKey: key.clone(),
            zeroForOne: zero_for_one,
            amountIn: amount_in,
            amountOutMinimum: min_out,
            hookData: Bytes::new(),
        }
        .abi_encode(),
        RouterVersion::V2_1_1 => abi::ExactInputSingleParamsV211 {
            poolKey: key.clone(),
            zeroForOne: zero_for_one,
            amountIn: amount_in,
            amountOutMinimum: min_out,
            minHopPriceX36: U256::ZERO,
            hookData: Bytes::new(),
        }
        .abi_encode(),
    };

    let native_in = currency_in == Address::ZERO;
    let mut v4_actions: Vec<u8> = Vec::with_capacity(3);
    let mut v4_params: Vec<Bytes> = Vec::with_capacity(3);
    v4_actions.push(actions::SWAP_EXACT_IN_SINGLE);
    v4_params.push(swap_params.into());
    if native_in {
        v4_actions.push(actions::SETTLE_ALL);
        v4_params.push((currency_in, U256::from(amount_in)).abi_encode_params().into());
    } else {
        // Router pays from its own (just wrapped) balance: payerIsUser = false.
        v4_actions.push(actions::SETTLE);
        v4_params.push((currency_in, U256::from(amount_in), false).abi_encode_params().into());
    }
    v4_actions.push(actions::TAKE_ALL);
    v4_params.push((currency_out, U256::from(min_out)).abi_encode_params().into());

    let v4_input: Bytes = (Bytes::from(v4_actions), v4_params).abi_encode_params().into();

    let mut ur_commands: Vec<u8> = Vec::with_capacity(2);
    let mut ur_inputs: Vec<Bytes> = Vec::with_capacity(2);
    if !native_in {
        ur_commands.push(commands::WRAP_ETH);
        ur_inputs.push((action_constants::ADDRESS_THIS, U256::from(amount_in)).abi_encode_params().into());
    }
    ur_commands.push(commands::V4_SWAP);
    ur_inputs.push(v4_input);

    let call = abi::executeCall { commands: ur_commands.into(), inputs: ur_inputs, deadline: U256::from(deadline) };
    (call.abi_encode().into(), U256::from(amount_in))
}

/// Sign an EIP-1559 buy transaction. Pure CPU; no I/O.
#[allow(clippy::too_many_arguments)]
pub fn sign_buy(
    cfg: &Config,
    wallet: &Wallet,
    key: &PoolKey,
    zero_for_one: bool,
    min_out: u128,
    nonce: u64,
    max_fee_per_gas: u128,
    priority_fee: u128,
    now_unix: u64,
) -> Result<SignedBuy> {
    let t0 = Instant::now();
    let amount_in: u128 = cfg.buy_amount_wei.try_into().map_err(|_| anyhow!("buy amount exceeds uint128"))?;
    let deadline = now_unix + cfg.deadline_secs;
    let (calldata, value) = build_calldata(cfg, key, zero_for_one, amount_in, min_out, deadline);

    let mut tx = TxEip1559 {
        chain_id: cfg.chain_id,
        nonce,
        gas_limit: cfg.gas_limit,
        max_fee_per_gas,
        max_priority_fee_per_gas: priority_fee,
        to: TxKind::Call(cfg.router),
        value,
        access_list: Default::default(),
        input: calldata.clone(),
    };
    let sig = wallet.signer.sign_transaction_sync(&mut tx).context("sign")?;
    let signed = tx.into_signed(sig);
    let tx_hash = *signed.hash();
    let envelope = TxEnvelope::Eip1559(signed);
    let raw = envelope.encoded_2718();
    let t1 = Instant::now();
    Ok(SignedBuy {
        tx_hash,
        raw_hex: format!("0x{}", hex::encode(&raw)),
        raw_len: raw.len(),
        nonce,
        max_fee_per_gas,
        priority_fee,
        gas_limit: cfg.gas_limit,
        value,
        amount_in,
        min_out,
        deadline,
        calldata,
        t_signed: t1,
        sign_micros: (t1 - t0).as_micros(),
    })
}

/// `eth_call` object for simulating the buy (dry-run diagnostics only).
pub fn simulation_call(cfg: &Config, from: Address, buy: &SignedBuy) -> serde_json::Value {
    json!({
        "from": from,
        "to": cfg.router,
        "value": format!("0x{:x}", buy.value),
        "gas": format!("0x{:x}", buy.gas_limit),
        "data": buy.calldata,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::{Mode, Trigger};
    use alloy::primitives::address;

    fn test_cfg(router_version: RouterVersion, counter: Address) -> Config {
        Config {
            mode: Mode::DryRun,
            ws_url: String::new(),
            rpc_url: String::new(),
            send_urls: vec![],
            chain_id: 8453,
            pool_manager: address!("498581ff718922c3f8e6a244956af099b2652b2b"),
            router: address!("6ff5693b99212da76ad316178a184ab56d299b43"),
            router_version,
            weth: address!("4200000000000000000000000000000000000006"),
            target_token: address!("b095274743941e953c746f9c228da9c18bb6ec29"),
            counter_currency: counter,
            allowed_hooks: vec![Address::ZERO],
            allowed_fees: None,
            allowed_tick_spacings: None,
            trigger: Trigger::Liquidity,
            min_liquidity_delta: U256::from(1),
            buy_amount_wei: U256::from(10u128.pow(16)),
            slippage_bps: 3000,
            min_out_tokens: U256::ZERO,
            gas_limit: 500_000,
            max_fee_per_gas_wei: 100_000_000,
            priority_fee_wei: 10_000_000,
            deadline_secs: 120,
            private_key: None,
            log_file: "x".into(),
            result_file: "y".into(),
            refresh_secs: 15,
            startup_scan_blocks: 0,
            receipt_poll_ms: 100,
            receipt_timeout_secs: 90,
            simulate_in_dry_run: false,
            quiet: true,
        }
    }

    fn word(bytes: &[u8], i: usize) -> U256 {
        U256::from_be_slice(&bytes[i * 32..(i + 1) * 32])
    }

    #[test]
    fn quote_math() {
        // sqrtPriceX96 = 2^96 -> price 1:1
        let one = U256::from(1u8) << 96;
        assert_eq!(quote_at_sqrt_price(one, U256::from(1000), true), U256::from(1000));
        assert_eq!(quote_at_sqrt_price(one, U256::from(1000), false), U256::from(1000));
        // sqrtPrice = 2 * 2^96 -> price 4: token1 per token0
        let two = U256::from(2u8) << 96;
        assert_eq!(quote_at_sqrt_price(two, U256::from(1000), true), U256::from(4000));
        assert_eq!(quote_at_sqrt_price(two, U256::from(1000), false), U256::from(250));
    }

    #[test]
    fn native_eth_calldata_layout_v2() {
        let cfg = test_cfg(RouterVersion::V2, Address::ZERO);
        let key = PoolKey {
            currency0: Address::ZERO,
            currency1: cfg.target_token,
            fee: u24(10_000),
            tickSpacing: i24(200),
            hooks: Address::ZERO,
        };
        let (calldata, value) = build_calldata(&cfg, &key, true, 10u128.pow(16), 12345, 1_700_000_000);
        assert_eq!(value, U256::from(10u128.pow(16)));
        assert_eq!(&calldata[..4], &[0x35, 0x93, 0x56, 0x4c]);

        // Decode outer execute() and check commands = [V4_SWAP].
        let call = abi::executeCall::abi_decode(&calldata).expect("decode execute");
        assert_eq!(call.commands.as_ref(), &[commands::V4_SWAP]);
        assert_eq!(call.inputs.len(), 1);
        assert_eq!(call.deadline, U256::from(1_700_000_000u64));

        // V4 input = abi.encode(bytes actions, bytes[] params) — strict layout expected by CalldataDecoder.
        let v4 = call.inputs[0].as_ref();
        assert_eq!(word(v4, 0), U256::from(0x40));
        let (acts, params) = <(Bytes, Vec<Bytes>)>::abi_decode_params(v4).expect("decode v4 input");
        assert_eq!(acts.as_ref(), &[actions::SWAP_EXACT_IN_SINGLE, actions::SETTLE_ALL, actions::TAKE_ALL]);
        assert_eq!(params.len(), 3);

        // SWAP_EXACT_IN_SINGLE params: leading offset 0x20, then 8 static words, hookData offset 0x120, len 0.
        let p0 = params[0].as_ref();
        assert_eq!(p0.len(), 11 * 32);
        assert_eq!(word(p0, 0), U256::from(0x20));
        assert_eq!(word(p0, 1), U256::ZERO); // currency0
        assert_eq!(word(p0, 2), U256::from_be_slice(cfg.target_token.into_word().as_slice()));
        assert_eq!(word(p0, 3), U256::from(10_000)); // fee
        assert_eq!(word(p0, 4), U256::from(200)); // tickSpacing
        assert_eq!(word(p0, 5), U256::ZERO); // hooks
        assert_eq!(word(p0, 6), U256::from(1)); // zeroForOne
        assert_eq!(word(p0, 7), U256::from(10u128.pow(16))); // amountIn
        assert_eq!(word(p0, 8), U256::from(12345)); // amountOutMinimum
        assert_eq!(word(p0, 9), U256::from(0x120)); // hookData offset (9 words)
        assert_eq!(word(p0, 10), U256::ZERO); // hookData length
        let decoded = abi::ExactInputSingleParamsV2::abi_decode(p0).expect("round-trip");
        assert_eq!(decoded.poolKey, key);

        // SETTLE_ALL(currency, maxAmount) and TAKE_ALL(currency, minAmount): two static words each.
        let p1 = params[1].as_ref();
        assert_eq!(p1.len(), 64);
        assert_eq!(word(p1, 0), U256::ZERO);
        assert_eq!(word(p1, 1), U256::from(10u128.pow(16)));
        let p2 = params[2].as_ref();
        assert_eq!(p2.len(), 64);
        assert_eq!(word(p2, 0), U256::from_be_slice(cfg.target_token.into_word().as_slice()));
        assert_eq!(word(p2, 1), U256::from(12345));
    }

    #[test]
    fn v211_struct_has_min_hop_price_word() {
        let cfg = test_cfg(RouterVersion::V2_1_1, Address::ZERO);
        let key = PoolKey { currency0: Address::ZERO, currency1: cfg.target_token, fee: u24(3000), tickSpacing: i24(60), hooks: Address::ZERO };
        let (calldata, _) = build_calldata(&cfg, &key, true, 1, 1, 0);
        let call = abi::executeCall::abi_decode(&calldata).unwrap();
        let (_, params) = <(Bytes, Vec<Bytes>)>::abi_decode_params(call.inputs[0].as_ref()).unwrap();
        let p0 = params[0].as_ref();
        assert_eq!(p0.len(), 12 * 32);
        assert_eq!(word(p0, 9), U256::ZERO); // minHopPriceX36
        assert_eq!(word(p0, 10), U256::from(0x140)); // hookData offset (10 words)
    }

    #[test]
    fn weth_route_wraps_first_and_settles_from_router() {
        let weth = address!("4200000000000000000000000000000000000006");
        let cfg = test_cfg(RouterVersion::V2, weth);
        let key = PoolKey { currency0: weth, currency1: cfg.target_token, fee: u24(3000), tickSpacing: i24(60), hooks: Address::ZERO };
        let (calldata, value) = build_calldata(&cfg, &key, true, 777, 5, 0);
        assert_eq!(value, U256::from(777));
        let call = abi::executeCall::abi_decode(&calldata).unwrap();
        assert_eq!(call.commands.as_ref(), &[commands::WRAP_ETH, commands::V4_SWAP]);
        let wrap = call.inputs[0].as_ref();
        assert_eq!(wrap.len(), 64);
        assert_eq!(word(wrap, 0), U256::from(2)); // ADDRESS_THIS
        assert_eq!(word(wrap, 1), U256::from(777));
        let (acts, params) = <(Bytes, Vec<Bytes>)>::abi_decode_params(call.inputs[1].as_ref()).unwrap();
        assert_eq!(acts.as_ref(), &[actions::SWAP_EXACT_IN_SINGLE, actions::SETTLE, actions::TAKE_ALL]);
        let settle = params[1].as_ref();
        assert_eq!(settle.len(), 96);
        assert_eq!(word(settle, 0), U256::from_be_slice(weth.into_word().as_slice()));
        assert_eq!(word(settle, 1), U256::from(777));
        assert_eq!(word(settle, 2), U256::ZERO); // payerIsUser = false
    }

    #[test]
    fn signing_produces_eip1559_envelope() {
        let cfg = test_cfg(RouterVersion::V2, Address::ZERO);
        // Well-known test key (never fund it).
        let wallet = Wallet::from_hex("0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80").unwrap();
        assert_eq!(wallet.address, address!("f39Fd6e51aad88F6F4ce6aB8827279cffFb92266"));
        let key = PoolKey { currency0: Address::ZERO, currency1: cfg.target_token, fee: u24(10_000), tickSpacing: i24(200), hooks: Address::ZERO };
        let buy = sign_buy(&cfg, &wallet, &key, true, 1, 7, 100_000_000, 10_000_000, 1_700_000_000).unwrap();
        assert!(buy.raw_hex.starts_with("0x02f8") || buy.raw_hex.starts_with("0x02f9"));
        assert_eq!(buy.nonce, 7);
        assert_eq!(buy.deadline, 1_700_000_120);
        use alloy::consensus::transaction::SignerRecoverable;
        use alloy::eips::eip2718::Decodable2718;
        let raw = hex::decode(&buy.raw_hex).unwrap();
        let env = TxEnvelope::decode_2718(&mut raw.as_slice()).expect("decode envelope");
        assert_eq!(*env.tx_hash(), buy.tx_hash);
        assert_eq!(env.recover_signer().unwrap(), wallet.address);
    }

    #[test]
    fn min_out_refuses_zero() {
        let mut cfg = test_cfg(RouterVersion::V2, Address::ZERO);
        cfg.min_out_tokens = U256::ZERO;
        assert!(min_out_for(&cfg, U256::ZERO, true).is_err());
        cfg.min_out_tokens = U256::from(5);
        assert_eq!(min_out_for(&cfg, U256::ZERO, true).unwrap(), 5);
        let one = U256::from(1u8) << 96;
        // quote = 1e16 at 1:1, minus 30% = 7e15
        assert_eq!(min_out_for(&cfg, one, true).unwrap(), 7 * 10u128.pow(15));
    }
}
