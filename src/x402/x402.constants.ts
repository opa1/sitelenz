import {
  ALGORAND_MAINNET_GENESIS_HASH,
  ALGORAND_TESTNET_GENESIS_HASH,
} from '@x402/avm';
import type { Network } from '@x402/core/types';

export const X402_RESOURCE_SERVER = Symbol('X402_RESOURCE_SERVER');

/** Wire header carrying the client's signed payment payload (x402 v2). */
export const X402_PAYMENT_HEADER = 'payment-signature';

/** How long a client has to complete payment for a built requirement. */
export const X402_MAX_TIMEOUT_SECONDS = 60;

/**
 * Algorand CAIP-2 network ids, built from the full genesis hash rather than
 * @x402/avm's own shortened `ALGORAND_*_CAIP2` exports. The live GoPlausible
 * facilitator's /supported endpoint currently advertises networks using the
 * full genesis hash, and x402ResourceServer matches facilitator support with
 * an exact string comparison — the shortened constants do not match what the
 * facilitator returns and cause buildPaymentRequirements() to throw. The AVM
 * scheme's own normalizeAlgorandNetwork() treats both forms as equivalent, so
 * using the full-hash form here is safe and matches what the facilitator
 * actually advertises (verified against
 * https://facilitator.goplausible.xyz/supported).
 */
export const ALGORAND_MAINNET_NETWORK =
  `algorand:${ALGORAND_MAINNET_GENESIS_HASH}` as Network;
export const ALGORAND_TESTNET_NETWORK =
  `algorand:${ALGORAND_TESTNET_GENESIS_HASH}` as Network;
