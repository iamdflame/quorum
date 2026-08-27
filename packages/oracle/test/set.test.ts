import { test } from "node:test";
import assert from "node:assert/strict";
import { anonymitySets, projectedSet, cellKey, DEFAULT_WINDOW_BLOCKS } from "../src/set.ts";
import type { PoolObservation, PublicEdge } from "../src/types.ts";

const TOKEN = 0x53746fn;
const OTHER_TOKEN = 0x555344n;

function obs(edges: PublicEdge[]): PoolObservation {
  return { head: 100_000, notes: [], edges, channels: [], blockTimeSeconds: 30 };
}
function edge(p: Partial<PublicEdge> & { amount: bigint; block: number }): PublicEdge {
  return { kind: "deposit", token: TOKEN, own: false, ...p };
}

test("an even crowd has effective size equal to its count", () => {
  // Ten operators, identical flow, same cell.
  const sets = anonymitySets(obs(
    Array.from({ length: 10 }, (_, i) => edge({ amount: 1000n, block: i }))));
  const only = [...sets.values()][0]!;
  assert.equal(only.participants, 10);
  assert.ok(Math.abs(only.effective - 10) < 1e-9, `expected ~10, got ${only.effective}`);
});

test("a crowd dominated by one operator collapses toward one", () => {
  // One operator transacts in this cell 200 times; nine others transact once each.
  // The headline count is ten. The honest crowd is barely more than one.
  const whale = 0xbeefn;
  const edges = [
    ...Array.from({ length: 200 }, (_, i) =>
      edge({ amount: 1000n, block: i, operator: whale })),
    ...Array.from({ length: 9 }, (_, i) =>
      edge({ amount: 1000n, block: 300 + i, operator: BigInt(i + 1) })),
  ];
  const s = [...anonymitySets(obs(edges)).values()]
    .sort((a, b) => b.participants - a.participants)[0]!;
  assert.equal(s.participants, 10, "ten distinct addresses are present");
  assert.ok(s.effective < 3,
    `a cell this concentrated should collapse toward one, got ${s.effective}`);
});

test("attribution by address is what reveals concentration", () => {
  // Identical flow, but with operator identities stripped: every edge looks
  // like a separate person, and the cell appears far safer than it is.
  const anon = Array.from({ length: 200 }, (_, i) => edge({ amount: 1000n, block: i }));
  const s = [...anonymitySets(obs(anon)).values()][0]!;
  assert.ok(s.effective > 100, "without addresses the crowd looks large");
});

test("effective size never exceeds the participant count", () => {
  for (const n of [1, 2, 7, 40]) {
    const sets = anonymitySets(obs(
      Array.from({ length: n }, (_, i) => edge({ amount: 1000n + BigInt(i), block: i }))));
    for (const s of sets.values()) {
      assert.ok(s.effective <= s.participants + 1e-9,
        `effective ${s.effective} exceeded count ${s.participants}`);
    }
  }
});

test("the set fragments along asset, denomination and time independently", () => {
  const shared = { amount: 1000n, block: 10 };
  const base = anonymitySets(obs([edge(shared), edge(shared)]));
  assert.equal(base.size, 1, "same asset+denom+window is one cell");

  const byAsset = anonymitySets(obs([edge(shared), edge({ ...shared, token: OTHER_TOKEN })]));
  assert.equal(byAsset.size, 2, "a different token is a different crowd");

  const byDenom = anonymitySets(obs([edge(shared), edge({ ...shared, amount: 9_000_000n })]));
  assert.equal(byDenom.size, 2, "a different size is a different crowd");

  const byTime = anonymitySets(obs([
    edge(shared), edge({ ...shared, block: 10 + DEFAULT_WINDOW_BLOCKS * 3 })]));
  assert.equal(byTime.size, 2, "a different window is a different crowd");
});

test("a large pool still offers a tiny set once fragmented", () => {
  // 600 edges — a busy pool — spread across assets, sizes and windows. Blocks
  // are spaced for the real ~1.7s block time, so a six-hour window is 12,700
  // blocks and the spread has to cover days rather than minutes.
  const edges: PublicEdge[] = [];
  for (let i = 0; i < 600; i++) {
    edges.push(edge({
      token: i % 5 === 0 ? OTHER_TOKEN : TOKEN,
      amount: BigInt(1000 * (1 + (i % 12))),
      block: i * 640,
    }));
  }
  const sets = anonymitySets(obs(edges));
  const effective = [...sets.values()].map((s) => s.effective);
  const median = effective.sort((a, b) => a - b)[Math.floor(effective.length / 2)]!;
  assert.ok(edges.length === 600);
  assert.ok(median < 5,
    `600 edges should still fragment to a tiny median cell, got ${median}`);
});

test("acting alone in an unused cell yields an effective set of exactly one", () => {
  const s = projectedSet(obs([edge({ amount: 1000n, block: 5 })]), OTHER_TOKEN, 7_777_777n, 90_000);
  assert.equal(s.participants, 0);
  assert.equal(s.effective, 1);
});

test("projecting into a busy cell reports that cell's crowd", () => {
  const edges = Array.from({ length: 8 }, (_, i) => edge({ amount: 1000n, block: i }));
  const s = projectedSet(obs(edges), TOKEN, 1000n, 3);
  assert.equal(s.participants, 8);
  assert.ok(s.effective > 7);
});

test("cellKey is stable and distinguishes every axis", () => {
  const a = { token: TOKEN, denomination: "3.0000", window: 1 };
  assert.equal(cellKey(a), cellKey({ ...a }));
  assert.notEqual(cellKey(a), cellKey({ ...a, window: 2 }));
  assert.notEqual(cellKey(a), cellKey({ ...a, token: OTHER_TOKEN }));
});
