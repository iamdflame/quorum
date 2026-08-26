import { getWallets } from "@wallet-standard/app";

/**
 * Finding a wallet that can actually do this.
 *
 * `WalletAccountV6` is not built on get-starknet's window object. Its base class
 * subscribes to `walletProvider.features["standard:events"]` in the constructor,
 * so it wants a **Wallet Standard** wallet — an object carrying a `features` map.
 * get-starknet v4 returns the older `StarknetWindowObject`, which has no
 * `features` at all, and there is no v5 published. Handing one to the other
 * throws `Cannot read properties of undefined (reading 'standard:events')`
 * before anything useful happens.
 *
 * So we discover wallets through Wallet Standard itself and filter for the
 * Starknet feature. That is the same registry the extensions announce
 * themselves to; get-starknet is a convenience layer over it, not the source.
 */

export const STARKNET_FEATURE = "starknet:walletApi";
export const CONNECT_FEATURE = "standard:connect";
export const EVENTS_FEATURE = "standard:events";

/** Every registered wallet, whether or not it speaks Starknet. */
export function allWallets() {
  try {
    return getWallets().get();
  } catch (err) {
    console.error("[shoal] wallet-standard registry unavailable", err);
    return [];
  }
}

/**
 * Wallets that can drive a `WalletAccountV6`.
 *
 * All three features are required, not just the Starknet one: the account
 * subscribes to `standard:events` on construction and calls `standard:connect`
 * to obtain an address, so a wallet missing either fails later and less legibly.
 */
export function starknetWallets() {
  return allWallets().filter(
    (w) =>
      w?.features &&
      STARKNET_FEATURE in w.features &&
      CONNECT_FEATURE in w.features &&
      EVENTS_FEATURE in w.features,
  );
}

/** What is installed, for telling the user something true when nothing matches. */
export function describeEnvironment() {
  const all = allWallets();
  return {
    total: all.length,
    names: all.map((w) => w?.name ?? "unnamed"),
    starknetCapable: starknetWallets().map((w) => w.name),
    missingFeatures: all
      .filter((w) => w?.features && !(STARKNET_FEATURE in w.features))
      .map((w) => w.name),
  };
}

/**
 * Connect and return the wallet plus its first account address.
 *
 * `standard:connect` is what actually prompts the extension, and it returns the
 * accounts — so the address never needs a second request.
 */
export async function connectWallet(wallet) {
  const res = await wallet.features[CONNECT_FEATURE].connect();
  const account = res?.accounts?.[0];
  if (!account?.address) {
    throw new Error(`${wallet.name} connected but exposed no account. Unlock it and retry.`);
  }
  return { wallet, address: account.address, account };
}
