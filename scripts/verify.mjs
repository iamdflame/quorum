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

const MACHINE = "0x0079bab03056fd05dde50e921cf5ea8c3405aaaa2f05492a8a0e1fb6c811ff76";
const MACHINE_SEPOLIA = "0x06e13e8e129b91085bcb6bde0f3bac7b8cf3ceb504ed4eb0149becc4c9b41736";
const CLASS_HASH = "0x262f3f548d23f74ac7326f04d11d315623ca57a6be9af4aabfd7c1a24b66086";
const POOL = "0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a";
const STRK = "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";

/* Selectors, from starknet_keccak of the entry point name. */
const SEL = {
  get_campaign: "0x333358710919613a34f18567332063b09711678bab1f50754e4f8f7fd637a8e",
  held: "0x34a3e3c6d5d516a635cba760af371241a4847b82058493c7447a286655255dc",
  get_fee_amount: "0x3d323cd692ad43935b81ce230c47bfc57f69656249c5a33fe5223c17dd32ed2",
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

/* ---- nothing is stranded in the contract ---- */
try {
  const held = await mainnet("starknet_call", [
    { contract_address: MACHINE, entry_point_selector: SEL.held, calldata: [STRK] }, "latest"]);
  BigInt(held[0]) === 0n
    ? pass("no STRK stranded in the machine", "held() = 0")
    : fail("the machine is holding STRK it has not accounted for", `held() = ${BigInt(held[0])}`);
} catch (e) { fail("held() failed", String(e.message ?? e)); }

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
  const { readFileSync } = await import("node:fs");
  const manifest = JSON.parse(readFileSync(new URL("../strk20.json", import.meta.url), "utf8"));
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
