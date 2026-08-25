/**
 * Who is actually in the pool.
 *
 *   node examples/entities.mjs
 *
 * Linkage names addresses. Clustering names people.
 */
import { fetchTransactions, blockNumber, observePool, identifyInfrastructure }
  from "../packages/chain/dist/index.js";
import { analyseLinkage, clusterEntities } from "../packages/linkage/dist/index.js";

const head = await blockNumber();
const from = head - 600_000;
process.stderr.write(`reading ${from}..${head}\n`);
const txs = await fetchTransactions(from, head);
const obs = await observePool(from, head);
const infra = await identifyInfrastructure(obs.edges, from, head);

const link = analyseLinkage(txs, { infrastructure: infra.all });
const c = clusterEntities(txs, { infrastructure: infra.all });

console.log(`\nSTRK20 POOL ENTITIES — mainnet, block ${head}`);
console.log(`  ${txs.length} transactions, ${infra.all.size} infrastructure addresses excluded\n`);
console.log(`  distinct addresses .................. ${c.addresses}`);
console.log(`  entities they collapse into ......... ${c.entityCount}`);
console.log(`  entities holding several addresses .. ${c.multiAddress}`);
const shrink = c.addresses > 0 ? (1 - c.entityCount / c.addresses) * 100 : 0;
console.log(`  population overstated by ............ ${shrink.toFixed(1)}%\n`);

const byRule = {};
for (const e of c.evidence) byRule[e.rule] = (byRule[e.rule] ?? 0) + 1;
console.log(`JOINS BY RULE (each one structural, never statistical)`);
for (const [k, v] of Object.entries(byRule).sort((a,b)=>b[1]-a[1]))
  console.log(`  ${k.padEnd(14)} ${String(v).padStart(4)}`);

console.log(`\nLARGEST ENTITIES`);
for (const e of c.entities.filter(e => e.addresses.length > 1).slice(0, 5)) {
  console.log(`  ${String(e.addresses.length).padStart(2)} addresses, ${String(e.notes.length).padStart(3)} notes  ${e.addresses[0].slice(0,20)}…`);
  const rules = [...new Set(e.evidence.map(x => x.rule))].join(", ");
  console.log(`     joined by: ${rules}`);
}
console.log(`\n  (linkage alone reported ${link.exposedAddresses.size} exposed addresses)`);
