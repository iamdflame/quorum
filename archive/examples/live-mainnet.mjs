/**
 * The effective anonymity set of the live STRK20 pool on Starknet mainnet.
 *
 *   node examples/live-mainnet.mjs
 *
 * Reads only public data: Deposit and Withdrawal events the pool emits in the
 * clear. No keys, no funds, no permission.
 */
import { observePool, blockNumber, tokenLabel, formatAmount,
         identifyInfrastructure, excludeInfrastructure } from "../../packages/chain/dist/index.js";
import { anonymitySets } from "../oracle/dist/index.js";

const WINDOW = 12_700; // six hours at the measured ~1.7s per block

const head = await blockNumber();
// Scan in segments: public RPCs cap block spans, and the pool's history is long.
const SPAN = 400_000, SEGMENTS = 5;
const from = head - SPAN * SEGMENTS;
process.stderr.write(`scanning blocks ${from}..${head}\n`);

const all = [];
for (let i = 0; i < SEGMENTS; i++) {
  const a = from + i * SPAN, b = Math.min(head, a + SPAN - 1);
  const obs = await observePool(a, b);
  all.push(...obs.edges);
  process.stderr.write(`  ${a}..${b}: ${obs.edges.length} edges\n`);
}
// Separate participants from plumbing before measuring. A private swap
// withdraws to an anonymizer, and relayers drain constantly — none of them are
// someone you could have been, so counting them invents a crowd.
process.stderr.write("classifying infrastructure...\n");
const infra = await identifyInfrastructure(all, from, head);
const clean = excludeInfrastructure(all, infra);
const observation = { head, notes: [], edges: clean, channels: [], blockTimeSeconds: 1.7 };

const operators = new Set(clean.map((e) => e.operator?.toString(16)));
const tokens = new Set(clean.map((e) => e.token));
const deposits = clean.filter((e) => e.kind === "deposit").length;

console.log(`\nSTRK20 PRIVACY POOL — STARKNET MAINNET`);
console.log(`  block ${head}`);
console.log(`  ${all.length} public edges total`);
console.log(`  ${infra.anonymizers.size} anonymizer contracts, ${infra.sinks.size} infrastructure sinks -> excluded`);
console.log(`  ${clean.length} participant edges  (${deposits} deposits, ${clean.length - deposits} withdrawals)`);
console.log(`  ${operators.size} distinct addresses`);
console.log(`  ${tokens.size} assets\n`);

const sets = [...anonymitySets(observation, WINDOW).values()];
const eff = sets.map((s) => s.effective).sort((a, b) => a - b);
const median = eff[Math.floor(eff.length / 2)] ?? 1;
const alone = eff.filter((x) => x < 1.5).length;

console.log(`THE CROWD, MEASURED`);
console.log(`  (asset, denomination, 6h window) cells ..... ${sets.length}`);
console.log(`  median effective anonymity set ............. ${median.toFixed(2)}`);
console.log(`  cells where you stand alone ............... ${alone} of ${sets.length}  (${((alone / sets.length) * 100).toFixed(0)}%)`);
console.log(`  largest crowd anywhere in the pool ........ ${Math.max(...eff).toFixed(2)}\n`);

const byToken = new Map();
for (const s of sets) {
  const k = tokenLabel(s.cell.token);
  const cur = byToken.get(k) ?? { cells: 0, alone: 0, best: 0 };
  cur.cells++; if (s.effective < 1.5) cur.alone++;
  cur.best = Math.max(cur.best, s.effective);
  byToken.set(k, cur);
}
console.log(`PER ASSET`);
console.log(`  ${"asset".padEnd(12)} ${"cells".padStart(6)} ${"alone".padStart(6)} ${"best crowd".padStart(11)}`);
for (const [k, v] of [...byToken.entries()].sort((a, b) => b[1].cells - a[1].cells)) {
  console.log(`  ${k.padEnd(12)} ${String(v.cells).padStart(6)} ${String(v.alone).padStart(6)} ${v.best.toFixed(2).padStart(11)}`);
}

const big = clean.sort((a, b) => (b.amount > a.amount ? 1 : -1)).slice(0, 3);
console.log(`\nLARGEST PUBLIC EDGES (visible to anyone)`);
for (const e of big) {
  console.log(`  ${e.kind.padEnd(10)} ${formatAmount(e.token, e.amount).padStart(16)} ${tokenLabel(e.token).padEnd(6)} block ${e.block}`);
}
