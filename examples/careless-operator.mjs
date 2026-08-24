/**
 * A worked example: the exposure an ordinary, careful-seeming operator
 * accumulates without doing anything wrong.
 *
 *   node examples/careless-operator.mjs
 */
import { analyse } from "../packages/oracle/dist/index.js";

const TOKEN = 0x53746fn;

// Sixty unremarkable 1000-unit deposits by other operators. This is the
// anonymity set: the population an observer compares our operator against.
const background = Array.from({ length: 60 }, (_, i) => ({
  kind: "deposit", token: TOKEN, amount: 1000n, block: i * 11, own: false,
}));

const report = analyse({
  head: 10_000,
  blockTimeSeconds: 30,
  // Onboarding opened a channel and deposited in the same block — the default
  // behaviour of every wallet flow that treats setup as part of first use.
  channels: [{ channel: "c1", block: 9_000, own: true }],
  edges: [
    ...background,
    { kind: "deposit",    token: TOKEN, amount: 250_000n,     block: 9_000, own: true },
    { kind: "withdrawal", token: TOKEN, amount: 137_442_931n, block: 9_020, own: true },
  ],
  // Ordinary spending has fragmented the position into nine uneven change notes.
  notes: [400n, 300n, 220n, 90n, 40n, 12n, 7n, 3n, 1n].map((amount, i) => ({
    token: TOKEN, amount, created: 9_100 + i, channel: "self",
    index: i, open: false, change: i > 0,
  })),
});

console.log(`EXPOSURE ${report.score.toFixed(1)} / 100   ->  ${report.grade.toUpperCase()}`);
console.log(`headline: ${report.headline}\n`);
for (const m of report.metrics) {
  console.log(`  ${String(Math.round(m.score)).padStart(3)}  ${m.label.padEnd(26)} (${m.limitation})`);
}
console.log(`\n  ${report.findings.length} findings, most severe first:`);
for (const f of report.findings) {
  console.log(`   [${f.severity.toUpperCase().padEnd(8)}] ${f.title}`);
}
