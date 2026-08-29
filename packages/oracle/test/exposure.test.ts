import { test } from "node:test";
import assert from "node:assert/strict";
import { analyse, grade } from "../src/exposure.ts";
import { nullifierBurst } from "../src/metrics/fragmentation.ts";
import { denominationBucket, roundness } from "../src/metrics/denomination.ts";
import { gini, entropyBits, trailingZeros, saturate } from "../src/stats.ts";
import type { PoolObservation, Note, PublicEdge, ChannelOpen } from "../src/types.ts";

const TOKEN = 0x53746fn;
const BLOCK_TIME = 30;

function note(p: Partial<Note> & { amount: bigint }): Note {
  return {
    token: TOKEN, created: 0, channel: "self", index: 0,
    open: false, change: false, ...p,
  };
}
function obs(p: Partial<PoolObservation> = {}): PoolObservation {
  return { head: 10_000, notes: [], edges: [], channels: [], blockTimeSeconds: BLOCK_TIME, ...p };
}
/** Background traffic so amount-rarity has a population to compare against. */
function background(n: number, amount: bigint): PublicEdge[] {
  return Array.from({ length: n }, (_, i) => ({
    kind: "deposit" as const, token: TOKEN, amount, block: i * 7, own: false,
  }));
}

test("stats: gini spans even to fully concentrated", () => {
  assert.equal(gini([5, 5, 5, 5]), 0);
  assert.ok(gini([0, 0, 0, 100]) > 0.7);
});

test("stats: entropy is maximal when uniform", () => {
  assert.equal(entropyBits([1, 1, 1, 1]), 2);
  assert.equal(entropyBits([9, 0, 0, 0]), 0);
});

test("stats: saturate is monotonic, bounded, and 50 at the midpoint", () => {
  assert.equal(saturate(0, 10), 0);
  assert.equal(Math.round(saturate(10, 10)), 50);
  assert.ok(saturate(1e9, 10) < 100);
  assert.ok(saturate(5, 10) < saturate(6, 10));
});

test("trailingZeros counts base-10 zeros", () => {
  assert.equal(trailingZeros(50_000n), 4);
  assert.equal(trailingZeros(51_379n), 0);
});

test("roundness separates human amounts from change arithmetic", () => {
  assert.ok(roundness(50_000n) > 0.6);
  assert.ok(roundness(51_379n) < 0.1);
});

test("denominationBucket collapses near-equal amounts, separates magnitudes", () => {
  assert.equal(denominationBucket(1000n), denominationBucket(1002n));
  assert.notEqual(denominationBucket(1000n), denominationBucket(9000n));
});

test("nullifierBurst matches naive largest-first selection", () => {
  const notes = [note({ amount: 10n }), note({ amount: 5n }), note({ amount: 1n })];
  assert.equal(nullifierBurst(notes, 10n), 1);
  assert.equal(nullifierBurst(notes, 12n), 2);
  assert.equal(nullifierBurst(notes, 16n), 3);
  assert.equal(nullifierBurst(notes, 0n), 0);
});

test("a clean position scores quiet", () => {
  const r = analyse(obs({
    notes: [note({ amount: 1000n, created: 100 })],
    edges: background(50, 1000n),
  }));
  assert.equal(r.grade, "quiet");
  assert.equal(r.findings.length, 0);
});

test("fragmentation is detected and explained with evidence", () => {
  const notes = Array.from({ length: 12 }, (_, i) =>
    note({ amount: 100n, created: i, index: i }));
  const r = analyse(obs({ notes, edges: background(50, 1000n) }));
  const frag = r.metrics.find((m) => m.id === "fragmentation")!;
  assert.ok(frag.score > 40, `expected fragmented set to score high, got ${frag.score}`);
  const f = frag.findings.find((x) => x.title.includes("nullifiers"))!;
  assert.ok(f, "expected a nullifier-burst finding");
  assert.equal(f.evidence["notes"], 12);
});

test("immature notes are excluded from burst analysis", () => {
  // All notes created at head: none are spendable yet, so none can leak a burst.
  const notes = Array.from({ length: 12 }, (_, i) =>
    note({ amount: 100n, created: 10_000, index: i }));
  const frag = analyse(obs({ notes })).metrics.find((m) => m.id === "fragmentation")!;
  assert.equal(frag.score, 0);
});

test("a unique amount against a uniform pool is critical", () => {
  const r = analyse(obs({
    edges: [
      ...background(80, 1000n),
      { kind: "withdrawal", token: TOKEN, amount: 137_442_931n, block: 500, own: true },
    ],
  }));
  const f = r.findings.find((x) => x.title.includes("unique in the pool"));
  assert.ok(f, "expected uniqueness finding");
  assert.equal(f!.severity, "critical");
});

test("rapid in-and-out is flagged with dwell evidence", () => {
  const r = analyse(obs({
    edges: [
      ...background(50, 1000n),
      { kind: "deposit", token: TOKEN, amount: 1000n, block: 900, own: true },
      { kind: "withdrawal", token: TOKEN, amount: 1000n, block: 910, own: true },
    ],
  }));
  const f = r.findings.find((x) => x.title.includes("left the pool"))!;
  assert.ok(f, "expected dwell finding");
  assert.equal(f.severity, "critical");
  assert.equal(f.evidence["dwellSeconds"], 300);
});

test("same-block channel open and deposit is critical", () => {
  const channels: ChannelOpen[] = [{ channel: "c1", block: 900, own: true }];
  const r = analyse(obs({
    channels,
    edges: [...background(50, 1000n),
      { kind: "deposit", token: TOKEN, amount: 1000n, block: 900, own: true }],
  }));
  const link = r.metrics.find((m) => m.id === "linkability")!;
  assert.equal(link.score, 100);
  assert.equal(link.findings[0]!.severity, "critical");
});

test("separated setup and movement is not flagged", () => {
  const r = analyse(obs({
    channels: [{ channel: "c1", block: 100, own: true }],
    edges: [...background(50, 1000n),
      { kind: "deposit", token: TOKEN, amount: 1000n, block: 5_000, own: true }],
  }));
  assert.equal(r.metrics.find((m) => m.id === "linkability")!.score, 0);
});

test("composite never sits below its worst axis being severe", () => {
  // One fatal axis, three clean: an averaging scorer would call this fine.
  const r = analyse(obs({
    channels: [{ channel: "c1", block: 900, own: true }],
    edges: [...background(50, 1000n),
      { kind: "deposit", token: TOKEN, amount: 1000n, block: 900, own: true }],
  }));
  assert.ok(r.score >= 50, `conjunctive privacy requires a high score, got ${r.score}`);
  assert.equal(r.findings[0]!.severity, "critical");
});

test("grade boundaries are ordered and total", () => {
  assert.equal(grade(0), "quiet");
  assert.equal(grade(20), "strong");
  assert.equal(grade(40), "fair");
  assert.equal(grade(60), "weak");
  assert.equal(grade(100), "exposed");
});

test("headline surfaces the most severe finding", () => {
  const r = analyse(obs({
    channels: [{ channel: "c1", block: 900, own: true }],
    edges: [...background(50, 1000n),
      { kind: "deposit", token: TOKEN, amount: 1000n, block: 900, own: true }],
  }));
  assert.equal(r.headline, r.findings[0]!.title);
});

test("empty observation is inert, not a crash", () => {
  const r = analyse(obs());
  assert.equal(r.score, 0);
  assert.equal(r.headline, "No shielded position observed.");
});
