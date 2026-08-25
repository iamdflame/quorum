/**
 * What is already linkable in the live STRK20 pool, with nothing broken.
 *
 *   node examples/linkage.mjs
 */
import { fetchTransactions, blockNumber, observePool, identifyInfrastructure }
  from "../packages/chain/dist/index.js";
import { analyseLinkage } from "../packages/linkage/dist/index.js";

const head = await blockNumber();
process.stderr.write(`reading pool transactions ${head - 600_000}..${head}\n`);
const txs = await fetchTransactions(head - 600_000, head);

// Identify plumbing from chain state before attributing anything to a person.
const obs = await observePool(head - 600_000, head);
const infra = await identifyInfrastructure(obs.edges, head - 600_000, head);
const r = analyseLinkage(txs, { infrastructure: infra.all });
process.stderr.write(`excluded ${infra.anonymizers.size} anonymizers, ${infra.sinks.size} sinks\n`);

console.log(`\nSTRK20 POOL LINKAGE — mainnet, block ${head}`);
console.log(`  ${r.transactions} pool transactions analysed\n`);

console.log(`ALREADY LINKED, NO CRYPTOGRAPHY BROKEN`);
console.log(`  public addresses bound to private notes ... ${r.exposedAddresses.size}`);
console.log(`  private notes attributable to an address .. ${r.exposedNotes.size}\n`);

console.log(`FAILURES                          users   via anonymizer`);
const label = { binding:"deposit bound to note creation", "round-trip":"shield + unshield in ONE tx",
  onboarding:"registration alongside a move", exit:"nullifier + public withdrawal" };
for (const [k,v] of Object.entries(r.byKind)) {
  console.log(`  ${label[k].padEnd(32)} ${String(v.user).padStart(5)} ${String(v.viaAnonymizer).padStart(14)}`);
}
console.log(`\nMOST EXPOSED ADDRESSES`);
for (const w of r.worst.slice(0,5)) {
  console.log(`  ${String(w.notes).padStart(3)} notes traceable   ${w.address.slice(0,34)}…`);
}
const rt = r.linkages.find(l => l.kind === "round-trip" && !l.viaAnonymizer);
if (rt) { console.log(`\nEXAMPLE — round-trip at block ${rt.block}`); console.log(`  ${rt.detail}`); }
