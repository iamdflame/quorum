/**
 * The whole product, on live mainnet data.
 *
 *   node examples/pipeline.mjs
 *
 * measure the crowd  ->  route into it  ->  schedule it  ->  emit the SDK calls
 */
import { observePool, blockNumber, identifyInfrastructure, excludeInfrastructure, tokenLabel }
  from "../packages/chain/dist/index.js";
import { anonymitySets, projectedSet } from "../packages/oracle/dist/index.js";
import { route } from "../packages/router/dist/index.js";
import { schedule, toOperations, MAINNET_CONSTANTS } from "../packages/execute/dist/index.js";

const WINDOW = 720;
const STRK = 0x4718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938dn;

const head = await blockNumber();
const from = head - 2_000_000;
process.stderr.write(`reading mainnet ${from}..${head}\n`);

const all = [];
for (let i = 0; i < 5; i++) {
  const a = from + i * 400_000, b = Math.min(head, a + 399_999);
  all.push(...(await observePool(a, b)).edges);
}
const infra = await identifyInfrastructure(all, from, head);
const obs = { head, notes: [], edges: excludeInfrastructure(all, infra),
              channels: [], blockTimeSeconds: 30 };

const AMOUNT = 3_000_000_000_000_000_000_000n; // 3,000 STRK

console.log(`\n1 · MEASURE  — block ${head}`);
const naive = projectedSet(obs, STRK, AMOUNT, head, WINDOW);
console.log(`   moving 3,000 STRK right now lands in a crowd of ${naive.effective.toFixed(1)}`);
const sets = [...anonymitySets(obs, WINDOW).values()].filter(s => s.cell.token === STRK);
console.log(`   ${sets.length} STRK cells observed, best crowd ${Math.max(...sets.map(s=>s.effective)).toFixed(1)}`);

console.log(`\n2 · ROUTE`);
const plan = route(obs, STRK, AMOUNT, WINDOW);
console.log(`   ${plan.legs.length} legs, crowd of ${plan.effectiveSet.toFixed(1)} (${plan.improvement.toFixed(1)}x baseline)`);
for (const l of plan.legs) {
  console.log(`     ${(Number(l.amount)/1e18).toFixed(0).padStart(6)} STRK -> window ${l.window}, crowd ${l.effectiveSet.toFixed(1)}`);
}

console.log(`\n3 · SCHEDULE  — proof validity ${MAINNET_CONSTANTS.proofValidityBlocks} blocks, fee ${Number(MAINNET_CONSTANTS.feeAmount)/1e18} STRK/tx`);
const sched = schedule(plan, head);
for (const l of sched.legs) {
  console.log(`     prove after ${l.proveAfter}  submit by ${l.expiresAt}  (slack ${l.slack})`);
}
const feeStrk = Number(sched.feeTotal) / 1e18;
const movedStrk = Number(AMOUNT) / 1e18;
console.log(`   fees: ${feeStrk} STRK for ${sched.legs.length} transaction(s)`);
console.log(`   the crowd costs ${((feeStrk / movedStrk) * 100).toFixed(2)}% of the amount moved`);

console.log(`\n4 · EMIT`);
const ops = toOperations(sched, "0x0471...938d", "0xRECIPIENT", { consolidateFirst: true });
console.log(`   ${ops.length} operations:\n`);
for (const op of ops.slice(0, 2)) {
  console.log(`   [${op.kind}]  prove after ${op.proveAfter}, submit by ${op.submitBy}`);
  console.log("   " + op.call.split("\n").join("\n   ") + "\n");
}

if (sched.warnings.length) {
  console.log(`WARNINGS`);
  for (const w of sched.warnings) console.log(`   ! ${w}`);
}
