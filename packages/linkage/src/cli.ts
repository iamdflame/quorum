#!/usr/bin/env node
/**
 * `npx @quorum/linkage` — check what the STRK20 pool already reveals.
 *
 * Two modes, and the distinction is deliberate:
 *
 *   no arguments      aggregate statistics only. How many addresses are bound
 *                     to notes, which mistakes are common, how large the
 *                     effective anonymity set really is. No address is named.
 *
 *   --address 0x…     everything known about ONE address. Point it at your own.
 *
 * There is no mode that ranks other people's exposure. That report would be
 * useful to exactly one kind of reader, and the tool would be a deanonymiser
 * with a safety notice on it. What it will do is tell you about yourself, and
 * tell everyone how bad the general picture is, which is what a person needs to
 * decide whether to trust the pool with anything.
 */
import { fetchTransactions, blockNumber, observePool, identifyInfrastructure }
  from "@quorum/chain";
import { analyseLinkage } from "./index.ts";
import { clusterEntities } from "./cluster.ts";

const argv = process.argv.slice(2);
const arg = (name: string): string | undefined => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};

if (argv.includes("--help") || argv.includes("-h")) {
  console.log(`
  @quorum/linkage — what the STRK20 pool already reveals, with nothing broken.

    npx @quorum/linkage                    aggregate report, no address named
    npx @quorum/linkage --address 0x…      what is known about one address
    npx @quorum/linkage --span 200000      blocks to read back (default 600000)
    npx @quorum/linkage --json             machine-readable

  Every finding is a join the chain itself makes. No key material is used, no
  proof is broken, and no heuristic is probabilistic: if it is reported, it is
  a fact the public record already states.
`);
  process.exit(0);
}

const json = argv.includes("--json");
const span = Number(arg("span") ?? 600_000);
const subject = arg("address");
const norm = (a: string) => { try { return BigInt(a).toString(16); } catch { return a.toLowerCase(); } };

const say = (s = "") => { if (!json) console.log(s); };
const note = (s: string) => { if (!json) process.stderr.write(s + "\n"); };

const head = await blockNumber();
const from = Math.max(0, head - span);
note(`reading STRK20 pool transactions ${from}..${head}`);

const [txs, obs] = await Promise.all([
  fetchTransactions(from, head),
  observePool(from, head),
]);
const infra = await identifyInfrastructure(obs.edges, from, head);
note(`excluding as plumbing: ${infra.anonymizers.size} anonymizers, ${infra.sinks.size} sinks` +
  (infra.feeCollector ? `, the fee collector` : `, NO fee collector found — counts will be inflated`));

const r = analyseLinkage(txs, { infrastructure: infra.all });
const c = clusterEntities(txs, { infrastructure: infra.all });

if (subject) {
  const key = norm(subject);
  const mine = r.linkages.filter((l) => l.addresses.some((a) => norm(a) === key));
  const entity = c.entities.find((e) => e.addresses.some((a) => norm(a) === key));
  const notes = new Set(mine.flatMap((l) => l.notes));

  if (json) {
    console.log(JSON.stringify({ address: subject, linkages: mine, entity, notes: [...notes] }, null, 2));
  } else if (mine.length === 0) {
    say(`\n  ${subject.slice(0, 20)}… is not linkable in blocks ${from}..${head}.`);
    say(`  That is the good outcome, and it is not permanent: one careless`);
    say(`  transaction is enough to change it retroactively for every note you`);
    say(`  already hold.\n`);
  } else {
    say(`\nWHAT THE CHAIN ALREADY SAYS ABOUT ${subject.slice(0, 20)}…\n`);
    say(`  ${notes.size} of your notes are attributable to this address.`);
    if (entity && entity.addresses.length > 1) {
      say(`  ${entity.addresses.length} addresses are provably the same party as this one,`);
      say(`  so your exposure is the union of all of them, not just this one.`);
    }
    say(`\n  HOW`);
    for (const l of mine.slice(0, 8)) say(`    block ${String(l.block).padStart(9)}  ${l.kind.padEnd(11)} ${l.detail.slice(0, 78)}`);
    if (mine.length > 8) say(`    … and ${mine.length - 8} more`);
    say();
  }
  process.exit(0);
}

if (json) {
  console.log(JSON.stringify({
    block: head, span, transactions: r.transactions,
    exposedAddresses: r.exposedAddresses.size, exposedNotes: r.exposedNotes.size,
    byKind: r.byKind, addresses: c.addresses, entities: c.entityCount,
    multiAddress: c.multiAddress, largestEntity: c.entities[0]?.addresses.length ?? 0,
  }, null, 2));
  process.exit(0);
}

say(`\nSTRK20 POOL — mainnet, block ${head}`);
say(`  ${r.transactions} pool transactions read over ${span.toLocaleString()} blocks\n`);
say(`ALREADY LINKED, WITH NOTHING BROKEN`);
say(`  public addresses bound to private notes ... ${r.exposedAddresses.size}`);
say(`  private notes attributable to an address .. ${r.exposedNotes.size}\n`);

const label: Record<string, string> = {
  binding: "deposit bound to note creation", "round-trip": "shield + unshield in ONE tx",
  onboarding: "registration alongside a move", exit: "nullifier + public withdrawal",
};
say(`HOW                               people   via anonymizer`);
for (const [k, v] of Object.entries(r.byKind))
  say(`  ${(label[k] ?? k).padEnd(32)} ${String(v.user).padStart(5)} ${String(v.viaAnonymizer).padStart(14)}`);

say(`\nWHO IS ACTUALLY IN THE POOL`);
say(`  distinct addresses ....................... ${c.addresses}`);
say(`  parties they collapse into ............... ${c.entityCount}`);
say(`  parties holding more than one address .... ${c.multiAddress}`);
say(`\n  The anonymity set is the second number, not the first. Addresses are`);
say(`  free; being a different person is not.\n`);
say(`  No address is named in this report. To see what is known about your own:`);
say(`    npx @quorum/linkage --address 0xYOURS\n`);
