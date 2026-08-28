import { WalletAccountV6, RpcProvider } from "starknet";

/**
 * Wallet discovery.
 *
 * `WalletAccountV6` subscribes to `features["standard:events"]` in its
 * constructor, so it needs a Wallet Standard object. Ready — the wallet that
 * actually implements the STRK20 methods on mainnet — injects the older
 * `StarknetWindowObject` on `window` and never registers with Wallet Standard.
 * Neither library reaches it alone, so we adapt.
 *
 * The scan uses `getOwnPropertyNames` and an explicit key list rather than
 * `Object.keys`, because extensions install themselves non-enumerably:
 * `window.starknet_ready` returns the object perfectly well while `Object.keys`
 * never mentions it.
 */

export const RPC = "https://api.cartridge.gg/x/starknet/mainnet";
const CHAIN = "starknet:SN_MAIN";

const KNOWN = [
  "starknet", "starknet_ready", "starknet_argentX", "starknet_braavos",
  "starknet_okxwallet", "starknet_keplr", "starknet_metamask", "starknet_fordefi",
  "starknet_xverse", "ready",
];

function candidateKeys() {
  const keys = new Set(KNOWN);
  try { for (const k of Object.getOwnPropertyNames(window)) if (/^starknet/i.test(k)) keys.add(k); } catch {}
  try { for (const k in window) if (/^starknet/i.test(k)) keys.add(k); } catch {}
  return [...keys];
}

export function findWallets() {
  const out = []; const seen = new Set();
  for (const key of candidateKeys()) {
    let o;
    try { o = window[key]; } catch { continue; }
    if (!o || typeof o !== "object" || typeof o.request !== "function") continue;
    const id = o.id ?? o.name ?? key;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(o);
  }
  return out;
}

function adapt(swo) {
  return {
    name: swo.name ?? swo.id ?? "Starknet wallet",
    icon: typeof swo.icon === "string" ? swo.icon : (swo.icon?.dark ?? ""),
    version: "1.0.0",
    chains: [CHAIN],
    accounts: [],
    features: {
      "standard:connect": {
        version: "1.0.0",
        connect: async () => {
          const res = await swo.request({ type: "wallet_requestAccounts" });
          const list = Array.isArray(res) ? res : (res?.accounts ?? []);
          return {
            accounts: list.filter(Boolean).map((address) => ({
              address, publicKey: new Uint8Array(), chains: [CHAIN], features: [],
            })),
          };
        },
      },
      "standard:events": {
        version: "1.0.0",
        on: (event, cb) => {
          if (event !== "change" || typeof swo.on !== "function") return () => {};
          const handler = (addrs) => cb({
            accounts: (Array.isArray(addrs) ? addrs : [addrs]).filter(Boolean)
              .map((address) => ({ address, chains: [CHAIN] })),
          });
          try { swo.on("accountsChanged", handler); } catch { return () => {}; }
          return () => { try { swo.off?.("accountsChanged", handler); } catch {} };
        },
      },
      "starknet:walletApi": { version: "1.0.0", request: (c) => swo.request(c) },
    },
  };
}

export async function connectWallet() {
  const found = findWallets();
  if (found.length === 0) {
    throw new Error(
      "No Starknet wallet found. Install Ready and reload — extensions attach on page " +
      "load, so one installed after this tab opened stays invisible until refresh.",
    );
  }
  const swo = found.find((w) => /ready|argent/i.test(w.name ?? "")) ?? found[0];
  const wallet = adapt(swo);
  const { accounts } = await wallet.features["standard:connect"].connect();
  const address = accounts[0]?.address;
  if (!address) throw new Error(`${wallet.name} exposed no account. Unlock it and retry.`);

  const account = new WalletAccountV6({
    provider: new RpcProvider({ nodeUrl: RPC }), walletProvider: wallet, address,
  });
  return { account, address, name: wallet.name };
}

/**
 * Does this wallet speak STRK20, and is the address registered?
 *
 * `NOT_REGISTERED` is the pool answering about the address, not the wallet
 * refusing the call — a wallet that relays a protocol error has demonstrably
 * implemented the method. Collapsing the two turns a one-time setup step into a
 * dead end, which is exactly the trap we fell into.
 */
export async function probeStrk20(account, token) {
  try {
    return { supported: true, registered: true, balances: await account.strk20Balances([token]) };
  } catch (err) {
    const msg = String(err?.message ?? err);
    if (/not[_\s-]?registered/i.test(msg)) return { supported: true, registered: false };
    if (/not implemented|unsupported|unknown method|-32601/i.test(msg)) {
      return { supported: false, registered: false, reason: "This wallet does not implement the STRK20 methods." };
    }
    return { supported: false, registered: false, reason: msg.slice(0, 200) };
  }
}
