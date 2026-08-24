/**
 * The pitch, in one output.
 *
 *   node examples/the-crowd-you-are-in.mjs
 *
 * A pool that looks busy from the outside, and the crowd you are actually
 * standing in once it fragments along asset, denomination and time.
 */
import { anonymitySets } from "../packages/oracle/dist/index.js";
import { route } from "../packages/router/dist/index.js";

const USDC = 0x555344n;
const EXOTIC = 0x9911n;
const WINDOW = 720;

// A realistic pool. Traffic is bursty, not uniform: activity clusters in waking
// hours, so some windows are genuinely crowded and others are nearly empty.
// That unevenness is the whole point — the crowd exists, you are just usually
// not standing in it.
const edges = [];
let op = 0;
const WINDOWS_PER_DAY = 4;          // 720-block windows, ~6h each
const DAYS = 14;
for (let day = 0; day < DAYS; day++) {
  for (let w = 0; w < WINDOWS_PER_DAY; w++) {
    // Two busy windows a day, two quiet ones.
    const busy = w === 1 || w === 2;
    const n = busy ? 28 : 3;
    const windowStart = (day * WINDOWS_PER_DAY + w) * WINDOW;
    for (let i = 0; i < n; i++) {
      const amount = i % 3 === 0 ? 100n : 1_000n;
      edges.push({ kind: "deposit", token: USDC, amount,
        block: windowStart + (i * 23) % WINDOW, own: false, operator: BigInt(++op) });
    }
  }
}
// A long tail of one-off amounts: every one of these operators is alone.
for (let i = 0; i < 40; i++) {
  edges.push({ kind: "deposit", token: USDC, amount: BigInt(3_000 + i * 137),
    block: i * 900, own: false, operator: BigInt(++op) });
}
// One thinly-used asset. The asset itself is the identifier.
for (let i = 0; i < 6; i++) {
  edges.push({ kind: "deposit", token: EXOTIC, amount: 50_000n,
    block: i * 4_000, own: false, operator: BigInt(++op) });
}

const observation = { head: DAYS * WINDOWS_PER_DAY * WINDOW, notes: [], edges, channels: [], blockTimeSeconds: 30 };

const sets = [...anonymitySets(observation, WINDOW).values()];
const effective = sets.map((s) => s.effective).sort((a, b) => a - b);
const median = effective[Math.floor(effective.length / 2)];

console.log(`THE POOL LOOKS LIKE THIS`);
console.log(`  ${edges.length} public edges`);
console.log(`  ${op} distinct operators`);
console.log(`  ${sets.length} distinct (asset, denomination, window) cells\n`);

console.log(`THE CROWD YOU ARE ACTUALLY IN`);
console.log(`  median effective set across cells .......... ${median.toFixed(1)}`);
console.log(`  cells offering a crowd of 1 (you, alone) ... ${effective.filter((x) => x < 1.5).length} of ${sets.length}`);
console.log(`  largest crowd anywhere in the pool ......... ${Math.max(...effective).toFixed(1)}\n`);

for (const [label, token, amount] of [
  ["move 2,000 USDC", USDC, 2_000n],
  ["move 50,000 of a thin asset", EXOTIC, 50_000n],
]) {
  const plan = route(observation, token, amount, WINDOW);
  console.log(`ROUTING: ${label}`);
  console.log(`  naive, right now .......... crowd of ${plan.baseline.toFixed(1)}`);
  if (plan.legs.length === 0) {
    console.log(`  routed .................... not routable`);
  } else {
    console.log(`  routed .................... crowd of ${plan.effectiveSet.toFixed(1)}  (${plan.improvement.toFixed(1)}x)`);
    for (const l of plan.legs) {
      console.log(`      ${String(l.amount).padStart(6)}  ->  window ${l.window} (block ${l.earliestBlock})  crowd ${l.effectiveSet.toFixed(1)}`);
    }
  }
  for (const w of plan.warnings) console.log(`  ! ${w}`);
  console.log();
}
