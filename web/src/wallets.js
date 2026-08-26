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
  const legacy = legacyWallets();
  return {
    total: all.length,
    names: all.map((w) => w?.name ?? "unnamed"),
    starknetCapable: starknetWallets().map((w) => w.name),
    legacyNames: legacy.map((w) => w?.name ?? w?.id ?? "unnamed"),
    windowKeys: typeof window === "undefined"
      ? [] : Object.keys(window).filter((k) => /^starknet/i.test(k)),
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

/* ------------------------------------------------------------------ *
 * Legacy wallets
 * ------------------------------------------------------------------ */

/**
 * Not every Starknet wallet registers with Wallet Standard.
 *
 * Ready injects the older `StarknetWindowObject` on `window` — `{id, name,
 * version, icon, request, on, off}` — and never announces itself to the
 * Wallet Standard registry. Meanwhile Phantom and MetaMask register properly
 * but do not speak Starknet. So on a real machine the registry is full of
 * wallets that cannot help and missing the one that can.
 *
 * The two are closer than they look. `WalletAccountV6` only ever touches three
 * features, and each maps onto something the legacy object already does:
 *
 *   starknet:walletApi.request  -> swo.request        (identical JSON-RPC)
 *   standard:connect.connect    -> wallet_requestAccounts
 *   standard:events.on("change")-> swo.on("accountsChanged")
 *
 * So we adapt rather than ask the user to install a different wallet. This is a
 * shim over a transitional gap in the ecosystem, not a workaround for anything
 * anyone decided.
 */

const CHAIN = "starknet:SN_MAIN";

/**
 * Keys Starknet wallets are known to inject under.
 *
 * Probed by name because enumeration is not enough: extensions commonly install
 * themselves with `Object.defineProperty(window, key, { enumerable: false })`,
 * which makes them invisible to `Object.keys` while `window[key]` returns the
 * object perfectly well. Scanning with `Object.keys` reports an empty machine
 * on a machine that has a wallet — which is exactly what happened here.
 */
export const KNOWN_WALLET_KEYS = [
  "starknet",
  "starknet_ready",
  "starknet_argentX",
  "starknet_braavos",
  "starknet_okxwallet",
  "starknet_keplr",
  "starknet_metamask",
  "starknet_fordefi",
  "starknet_xverse",
  "ready",
];

const looksLikeWallet = (o) =>
  !!o && typeof o === "object" && typeof o.request === "function";

/** Every `starknet*`-shaped key present, enumerable or not. */
export function candidateKeys() {
  if (typeof window === "undefined") return [];
  const keys = new Set(KNOWN_WALLET_KEYS);
  // getOwnPropertyNames sees non-enumerable properties; Object.keys does not.
  try {
    for (const k of Object.getOwnPropertyNames(window)) {
      if (/^starknet/i.test(k)) keys.add(k);
    }
  } catch { /* cross-origin or exotic window */ }
  try {
    for (const k in window) {
      if (/^starknet/i.test(k)) keys.add(k);
    }
  } catch { /* ignore */ }
  return [...keys];
}

/** Find legacy wallets injected on `window`, however they were defined. */
export function legacyWallets() {
  if (typeof window === "undefined") return [];
  const out = [];
  const seen = new Set();
  for (const key of candidateKeys()) {
    let obj;
    try {
      obj = window[key];
    } catch {
      continue; // some injected getters throw on access
    }
    if (!looksLikeWallet(obj)) continue;
    const id = obj.id ?? obj.name ?? key;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(obj);
  }
  return out;
}

/** Everything we can see, verbatim — for reporting a failure precisely. */
export function diagnostics() {
  const present = [];
  for (const key of candidateKeys()) {
    let obj, note;
    try {
      obj = window[key];
      note = obj === undefined ? "undefined"
        : typeof obj !== "object" ? typeof obj
        : typeof obj.request !== "function" ? "object, no request()"
        : `wallet: ${obj.name ?? obj.id ?? "unnamed"} v${obj.version ?? "?"}`;
    } catch (err) {
      note = `threw on access: ${String(err?.message ?? err).slice(0, 60)}`;
    }
    if (note !== "undefined") present.push(`${key} -> ${note}`);
  }
  return {
    walletStandard: allWallets().map((w) => `${w?.name ?? "unnamed"} [${Object.keys(w?.features ?? {}).join("|")}]`),
    windowProbe: present,
    usable: usableWallets().map((w) => w.name),
  };
}

/** Wrap a legacy `StarknetWindowObject` so `WalletAccountV6` accepts it. */
export function adaptLegacy(swo) {
  const icon = typeof swo.icon === "string" ? swo.icon : (swo.icon?.dark ?? swo.icon?.light ?? "");
  return {
    name: swo.name ?? swo.id ?? "Starknet wallet",
    icon,
    version: "1.0.0",
    chains: [CHAIN],
    accounts: [],
    __legacy: swo,
    features: {
      [CONNECT_FEATURE]: {
        version: "1.0.0",
        connect: async () => {
          const res = await swo.request({ type: "wallet_requestAccounts" });
          const addresses = Array.isArray(res) ? res : (res?.accounts ?? []);
          return {
            accounts: addresses.filter(Boolean).map((address) => ({
              address,
              publicKey: new Uint8Array(),
              chains: [CHAIN],
              features: [STARKNET_FEATURE],
            })),
          };
        },
      },
      [EVENTS_FEATURE]: {
        version: "1.0.0",
        // starknet.js expects `{ accounts: [{ address, chains }] }`; the legacy
        // event hands over a bare array of addresses.
        on: (event, callback) => {
          if (event !== "change" || typeof swo.on !== "function") return () => {};
          const handler = (addresses) => {
            const list = Array.isArray(addresses) ? addresses : [addresses];
            callback({
              accounts: list.filter(Boolean).map((address) => ({ address, chains: [CHAIN] })),
            });
          };
          try {
            swo.on("accountsChanged", handler);
          } catch (err) {
            console.warn("[shoal] wallet does not support accountsChanged", err);
            return () => {};
          }
          return () => { try { swo.off?.("accountsChanged", handler); } catch { /* ignore */ } };
        },
      },
      [STARKNET_FEATURE]: {
        version: "1.0.0",
        request: (call) => swo.request(call),
        walletVersion: swo.version ?? "unknown",
      },
    },
  };
}

/**
 * Every wallet that can drive a `WalletAccountV6`, native or adapted.
 * Native registrations win; a wallet appearing both ways is listed once.
 */
export function usableWallets() {
  const native = starknetWallets();
  const nativeNames = new Set(native.map((w) => (w.name ?? "").toLowerCase()));
  const adapted = legacyWallets()
    .map(adaptLegacy)
    .filter((w) => !nativeNames.has((w.name ?? "").toLowerCase()));
  return [...native, ...adapted];
}
