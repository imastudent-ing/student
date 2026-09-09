//! Uniswap v4 ABI definitions verified against the official sources:
//!
//! * `Uniswap/v4-core` `src/interfaces/IPoolManager.sol` (events)
//! * `Uniswap/v4-core` `src/types/PoolKey.sol`, `PoolId.sol`
//! * `Uniswap/v4-periphery` `src/interfaces/IV4Router.sol` at commits
//!   444c526 (Universal Router V2) and 3231810 (Universal Router 2.1.1)
//! * `Uniswap/v4-periphery` `src/libraries/Actions.sol`, `ActionConstants.sol`
//! * `Uniswap/universal-router` `contracts/libraries/Commands.sol`,
//!   `contracts/interfaces/IUniversalRouter.sol`

#[cfg(test)]
use alloy::primitives::aliases::{I24, U24};
use alloy::primitives::{keccak256, Address, B256};
use alloy::sol;
use alloy::sol_types::SolValue;

sol! {
    /// PoolKey (v4-core). `Currency` and `IHooks` are address-typed.
    #[derive(Debug, PartialEq, Eq)]
    struct PoolKey {
        address currency0;
        address currency1;
        uint24 fee;
        int24 tickSpacing;
        address hooks;
    }

    /// PoolManager events. `PoolId` is `bytes32`, `Currency` is `address`.
    #[derive(Debug)]
    event Initialize(
        bytes32 indexed id,
        address indexed currency0,
        address indexed currency1,
        uint24 fee,
        int24 tickSpacing,
        address hooks,
        uint160 sqrtPriceX96,
        int24 tick
    );

    #[derive(Debug)]
    event ModifyLiquidity(
        bytes32 indexed id,
        address indexed sender,
        int24 tickLower,
        int24 tickUpper,
        int256 liquidityDelta,
        bytes32 salt
    );

    #[derive(Debug)]
    event Swap(
        bytes32 indexed id,
        address indexed sender,
        int128 amount0,
        int128 amount1,
        uint160 sqrtPriceX96,
        uint128 liquidity,
        int24 tick,
        uint24 fee
    );

    /// IV4Router.ExactInputSingleParams as deployed in Universal Router V2.
    #[derive(Debug)]
    struct ExactInputSingleParamsV2 {
        PoolKey poolKey;
        bool zeroForOne;
        uint128 amountIn;
        uint128 amountOutMinimum;
        bytes hookData;
    }

    /// IV4Router.ExactInputSingleParams as deployed in Universal Router 2.1.1.
    #[derive(Debug)]
    struct ExactInputSingleParamsV211 {
        PoolKey poolKey;
        bool zeroForOne;
        uint128 amountIn;
        uint128 amountOutMinimum;
        uint256 minHopPriceX36;
        bytes hookData;
    }

    /// IUniversalRouter.execute
    function execute(bytes commands, bytes[] inputs, uint256 deadline) external payable;
}

/// Universal Router commands (Commands.sol).
pub mod commands {
    pub const WRAP_ETH: u8 = 0x0b;
    pub const V4_SWAP: u8 = 0x10;
}

/// v4-periphery router actions (Actions.sol).
pub mod actions {
    pub const SWAP_EXACT_IN_SINGLE: u8 = 0x06;
    pub const SETTLE: u8 = 0x0b;
    pub const SETTLE_ALL: u8 = 0x0c;
    pub const TAKE_ALL: u8 = 0x0f;
}

/// ActionConstants.sol
pub mod action_constants {
    use alloy::primitives::{address, Address};
    /// `address(2)`: recipient/payer alias meaning "the router contract itself".
    pub const ADDRESS_THIS: Address = address!("0000000000000000000000000000000000000002");
}

/// `uint24` helper.
#[cfg(test)]
pub fn u24(v: u32) -> U24 {
    U24::from(v)
}

/// `int24` helper (test-only; panics if out of range).
#[cfg(test)]
pub fn i24(v: i32) -> I24 {
    I24::try_from(v).expect("int24 range")
}

/// keccak256(abi.encode(poolKey)) — PoolIdLibrary.toId.
pub fn pool_id(key: &PoolKey) -> B256 {
    keccak256(key.abi_encode())
}

/// Sorted currencies as the PoolManager requires (currency0 < currency1).
pub fn sort_currencies(a: Address, b: Address) -> (Address, Address) {
    if a < b {
        (a, b)
    } else {
        (b, a)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use alloy::primitives::{address, b256, U256};
    use alloy::sol_types::SolEvent;

    #[test]
    fn event_topics_match_reference_signatures() {
        // Signatures from IPoolManager.sol with user-defined types replaced by
        // their underlying ABI types.
        assert_eq!(
            Initialize::SIGNATURE_HASH,
            keccak256(b"Initialize(bytes32,address,address,uint24,int24,address,uint160,int24)")
        );
        assert_eq!(
            ModifyLiquidity::SIGNATURE_HASH,
            keccak256(b"ModifyLiquidity(bytes32,address,int24,int24,int256,bytes32)")
        );
        assert_eq!(
            Swap::SIGNATURE_HASH,
            keccak256(b"Swap(bytes32,address,int128,int128,uint160,uint128,int24,uint24)")
        );
        // Topic0 values derived from the official IPoolManager.sol signatures (pinned so a
        // future edit of the sol! block cannot silently change what we subscribe to).
        assert_eq!(
            Initialize::SIGNATURE_HASH,
            b256!("dd466e674ea557f56295e2d0218a125ea4b4f0f6f3307b95f85e6110838d6438")
        );
        assert_eq!(
            ModifyLiquidity::SIGNATURE_HASH,
            b256!("f208f4912782fd25c7f114ca3723a2d5dd6f3bcc3ac8db5af63baa85f711d5ec")
        );
        assert_eq!(
            Swap::SIGNATURE_HASH,
            b256!("40e9cecb9f5f1f1c5b9c97dec2917b7ee92e57ba5563708daca94dd84ad7112f")
        );
    }

    #[test]
    fn execute_selector() {
        let call = executeCall { commands: vec![0x10].into(), inputs: vec![], deadline: U256::ZERO };
        let enc = alloy::sol_types::SolCall::abi_encode(&call);
        assert_eq!(&enc[..4], &keccak256(b"execute(bytes,bytes[],uint256)")[..4]);
        assert_eq!(&enc[..4], &[0x35, 0x93, 0x56, 0x4c]);
    }

    #[test]
    fn pool_id_is_keccak_of_encoded_key() {
        let key = PoolKey {
            currency0: Address::ZERO,
            currency1: address!("b095274743941e953c746f9c228da9c18bb6ec29"),
            fee: u24(10_000),
            tickSpacing: i24(200),
            hooks: Address::ZERO,
        };
        let enc = key.abi_encode();
        assert_eq!(enc.len(), 5 * 32, "PoolKey must encode to 5 static words (0xa0 bytes)");
        assert_eq!(pool_id(&key), keccak256(&enc));
    }
}
