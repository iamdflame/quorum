#!/usr/bin/env node
/**
 * Check the repository's claims against the chain, and fail if they disagree.
 *
 *   npm run verify
 *
 * A README is a set of assertions about the world that rots the moment the world
 * moves. Everything here is a claim made somewhere in this repository, restated
 * as something a machine can check — so the documentation cannot quietly drift
 * away from what is deployed, and a stranger can confirm all of it in one command
 * without trusting a word of it.
 *
 * Exits non-zero on the first disagreement.
 */

const RPCS = [
  "https://api.cartridge.gg/x/starknet/mainnet",
  "https://rpc.starknet.lava.build:443",
];
const SEPOLIA = "https://api.cartridge.gg/x/starknet/sepolia";

const MACHINE = "0x00dca84ff35ee793c69c983abfc29e3e1aa8790f7dcd7e0288b705f600fcdaf7";
const MACHINE_SEPOLIA = "0x07d639ca00289a59a6949a12f6470feadf74d905d01bcce331f6c9d1d775fc73";
const CLASS_HASH = "0x04a3ad9409c4f4acc72b9fda88410161044e44eb2aa6ab403d08d3ac7de4d4f7";
const POOL = "0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a";
const STRK = "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";

const { readFileSync } = await import("node:fs");
const manifest = JSON.parse(readFileSync(new URL("../strk20.json", import.meta.url), "utf8"));

/* Selectors, from starknet_keccak of the entry point name. */
const SEL = {
  get_campaign: "0x333358710919613a34f18567332063b09711678bab1f50754e4f8f7fd637a8e",
  held: "0x34a3e3c6d5d516a635cba760af371241a4847b82058493c7447a286655255dc",
  get_fee_amount: "0x3d323cd692ad43935b81ce230c47bfc57f69656249c5a33fe5223c17dd32ed2",
  balanceOf: "0x2e4263afad30923c891518314c3c95dbe830a16874e8abc5777a9a20b54c76e",
};

let failures = 0;
const pass = (what, detail) => console.log(`  \x1b[32mok\x1b[0m    ${what}${detail ? `  ${detail}` : ""}`);
const fail = (what, detail) => { failures++; console.log(`  \x1b[31mFAIL\x1b[0m  ${what}\n        ${detail}`); };

async function rpc(url, method, params) {
  const r = await fetch(url, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const j = await r.json();
  if (j.error) throw new Error(j.error.message ?? JSON.stringify(j.error));
  return j.result;
}

/** Public endpoints fail often enough that one refusal is not evidence. */
async function mainnet(method, params) {
  let last;
  for (const url of RPCS) {
    try { return await rpc(url, method, params); } catch (e) { last = e; }
  }
  throw last;
}

const eq = (a, b) => BigInt(a) === BigInt(b);

console.log("\nQuorum — checking the repository's claims against the chain\n");

/* ---- the contract is where the README says, and is the code it says ---- */
try {
  const cls = await mainnet("starknet_getClassHashAt", ["latest", MACHINE]);
  eq(cls, CLASS_HASH)
    ? pass("mainnet class hash matches", CLASS_HASH.slice(0, 18) + "…")
    : fail("mainnet class hash differs", `deployed ${cls}, README says ${CLASS_HASH}`);
} catch (e) { fail("mainnet contract unreachable", String(e.message ?? e)); }

try {
  const cls = await rpc(SEPOLIA, "starknet_getClassHashAt", ["latest", MACHINE_SEPOLIA]);
  eq(cls, CLASS_HASH)
    ? pass("sepolia runs the same bytecode as mainnet")
    : fail("sepolia bytecode differs from mainnet",
           `sepolia ${cls} vs mainnet ${CLASS_HASH} — the testnet did not rehearse production`);
} catch (e) { fail("sepolia contract unreachable", String(e.message ?? e)); }

/* ---- an unopened campaign reads as Void, in eleven fields ---- */
try {
  const v = await mainnet("starknet_call", [
    { contract_address: MACHINE, entry_point_selector: SEL.get_campaign,
      calldata: ["0x77616c6b6f75742d32303236"] }, "latest"]);
  const allZero = v.every((x) => BigInt(x) === 0n);
  if (v.length !== 11) {
    fail("Campaign struct is not eleven fields",
         `got ${v.length} — the app reads these by position, so a change here silently misreads every value`);
  } else if (!allZero) {
    fail("an unopened campaign is not Void", JSON.stringify(v));
  } else {
    pass("an unopened campaign reads as Phase::Void", "11 fields, all zero");
  }
} catch (e) { fail("get_campaign failed", String(e.message ?? e)); }

/* ---- every address written in the docs is one that actually exists ---- *
 *
 * Twice now a plausible-looking address has been written into a document from
 * memory rather than from the chain. Both times it was caught by reading, which
 * is not a control. A full-width hex literal in a document is a claim about
 * mainnet, so it is checked against the small set this repository has actually
 * deployed or transacted, and anything else has to be declared here on purpose.
 */
{
  // The contract's own entry points, computed rather than listed: documenting a
  // call means writing its selector, and those are legitimate by construction.
  const { hash } = await import("starknet");
  const selectors = ["privacy_invoke", "get_campaign", "get_pledge", "quorum_reached", "held"]
    .map((n) => hash.getSelectorFromName(n));

  const known = new Set([
    MACHINE, MACHINE_SEPOLIA, CLASS_HASH, POOL, STRK,
    ...manifest.transactions, ...selectors,
    // Values this repository legitimately names, each checked once by hand
    // against the chain before being written down here.
    "0x127021a1b5a52d3174c2ab077c2b043c80369250d29428cee956d76ee51584f", // the pool's paymaster
    "0x00d79041634625e5288296fbc648088788710ba44903a3a49468a66567749e77", // the fee collector
    "0x0487c8b492361acdf48bf691ee61f56884734dc0e84980ffccc18b128ee3dd49", // mainnet deploy tx
    "0x0254a6b2997ef52e9f830ce1f543f6b29768295e8d17e2267d672c552cfe0d91", // the Sepolia pool
    "0x076032ab7a20ff0b7a324157e403062eba3a756421fa70a44514cdb0ee7d0c65", // Sepolia deploy tx
    "0x06d3f070a8732b1272ac7e73527187ce08da502839b18fc30a481a79512b8c08", // superseded QuorumMachine
    "0x0269fa8cd8a7a04f5cd5b2fda7139efebb99511e2dde4778ba9395948a62ecfc", // superseded ConclaveMachine
  ].map((h) => h.toLowerCase()));
  const eqHex = (a, b) => { try { return BigInt(a) === BigInt(b); } catch { return false; } };

  const docs = ["README.md", "RUBRIC_MAP.md", "DEPLOYMENTS.md",
                "contracts/README.md", "packages/linkage/README.md"];
  const bad = [];
  for (const doc of docs) {
    let text;
    try { text = readFileSync(new URL(`../${doc}`, import.meta.url), "utf8"); } catch { continue; }
    for (const m of text.matchAll(/0x[0-9a-fA-F]{48,64}/g)) {
      if (![...known].some((k) => eqHex(k, m[0]))) bad.push(`${doc}: ${m[0]}`);
    }
  }
  bad.length === 0
    ? pass("every address in the docs is one that exists", `${docs.length} documents scanned`)
    : fail("a document names an address this repo never deployed or used",
           bad.slice(0, 4).join("\n         "));
}

/* ---- the contract's own accounting reconciles with its real balance ---- *
 *
 * `held` is not expected to be zero: a live RefundAll campaign holds its
 * pledges until they are reclaimed. What must be true is that what the contract
 * thinks it holds is exactly what it does hold. A gap either way is stranded
 * value or a phantom balance, and both are silent.
 */
try {
  const [held, balance] = await Promise.all([
    mainnet("starknet_call", [
      { contract_address: MACHINE, entry_point_selector: SEL.held, calldata: [STRK] }, "latest"]),
    mainnet("starknet_call", [
      { contract_address: STRK, entry_point_selector: SEL.balanceOf, calldata: [MACHINE] }, "latest"]),
  ]);
  const h = BigInt(held[0]);
  const b = BigInt(balance[0]) + (BigInt(balance[1] ?? 0) << 128n);
  h === b
    ? pass("the machine's accounting reconciles with its balance",
           `held = balance = ${Number(h) / 1e18} STRK`)
    : fail("the machine's accounting does not match its balance",
           `held() = ${h} but balanceOf = ${b}. The difference is stranded or phantom.`);
} catch (e) { fail("could not reconcile the machine's balance", String(e.message ?? e)); }

/* ---- block time is what the code assumes, not what old tooling assumes ---- */
try {
  const head = await mainnet("starknet_blockNumber", []);
  const span = 200_000;
  const [a, b] = await Promise.all([
    mainnet("starknet_getBlockWithTxHashes", [{ block_number: head - span }]),
    mainnet("starknet_getBlockWithTxHashes", [{ block_number: head }]),
  ]);
  const secs = (b.timestamp - a.timestamp) / span;
  if (secs > 1.2 && secs < 2.5) {
    pass("block time is ~1.7s as the code assumes", `${secs.toFixed(3)} s/block over ${span.toLocaleString()} blocks`);
  } else {
    fail("block time is not what this project assumes",
         `measured ${secs.toFixed(3)} s/block. Campaign expiry is computed from this, and expiry cannot be changed after creation.`);
  }
} catch (e) { fail("could not measure block time", String(e.message ?? e)); }

/* ---- the pool fee the docs and UI quote ---- */
try {
  const fee = await mainnet("starknet_call", [
    { contract_address: POOL, entry_point_selector: SEL.get_fee_amount, calldata: [] }, "latest"]);
  const strk = Number(BigInt(fee[0])) / 1e18;
  strk === 6
    ? pass("pool fee is 6 STRK per transaction", "as quoted in the app and README")
    : fail("pool fee has changed", `now ${strk} STRK — the cost figures shown to organisers are wrong`);
} catch (e) { fail("could not read the pool fee", String(e.message ?? e)); }

/* ---- every transaction listed in strk20.json actually did what we claim ---- */
try {
  const txs = manifest.transactions ?? [];
  if (txs.length === 0) {
    console.log("  \x1b[33mnote\x1b[0m  strk20.json lists no transactions yet");
  }
  for (const tx of txs) {
    const status = await mainnet("starknet_getTransactionStatus", [tx]);
    if (status.execution_status !== "SUCCEEDED") {
      fail(`transaction ${tx.slice(0, 14)}… did not succeed`, JSON.stringify(status));
      continue;
    }
    const receipt = await mainnet("starknet_getTransactionReceipt", [tx]);
    const touchedPool = (receipt.events ?? []).some((e) => eq(e.from_address, POOL));
    const throughUs = (receipt.events ?? []).some((e) => eq(e.from_address, MACHINE));
    if (!touchedPool) fail(`transaction ${tx.slice(0, 14)}… never touched the pool`, "the panel checks this");
    else if (!throughUs) console.log(
      `  \x1b[33mnote\x1b[0m  ${tx.slice(0, 14)}… touched the pool but not through QuorumMachine`);
    else pass(`transaction ${tx.slice(0, 14)}… ran through QuorumMachine`);
  }
} catch (e) { fail("could not verify the listed transactions", String(e.message ?? e)); }

console.log(
  failures === 0
    ? "\n\x1b[32mEverything this repository claims is true on chain.\x1b[0m\n"
    : `\n\x1b[31m${failures} claim(s) disagree with the chain.\x1b[0m\n`,
);
process.exit(failures === 0 ? 0 : 1);
