import { test } from "node:test";
import assert from "node:assert/strict";
import { schedule, toOperations, MAINNET_CONSTANTS } from "../src/index.ts";
import type { RoutePlan } from "@shoal/router";

const TOKEN = 0x53746fn;

function plan(legs: { amount: bigint; block: number; set: number }[], over = {}): RoutePlan {
  return {
    token: TOKEN, total: legs.reduce((s, l) => s + l.amount, 0n),
    legs: legs.map((l, i) => ({
      amount: l.amount, window: 100 + i, earliestBlock: l.block,
      effectiveSet: l.set, exposed: l.set < 2,
    })),
    effectiveSet: legs.length ? Math.min(...legs.map((l) => l.set)) : 1,
    baseline: 1, improvement: 1, warnings: [], ...over,
  };
}

test("live mainnet constants are carried, not assumed", () => {
  assert.equal(MAINNET_CONSTANTS.proofValidityBlocks, 450);
  assert.equal(MAINNET_CONSTANTS.feeAmount, 6_000_000_000_000_000_000n);
  assert.equal(MAINNET_CONSTANTS.noteMaturityBlocks, 10);
});

test("proving cannot start before now", () => {
  const s = schedule(plan([{ amount: 100n, block: 1_000, set: 8 }]), 900);
  assert.ok(s.legs[0]!.proveAfter >= 900, "a leg cannot be proven in the past");
});

test("a distant leg defers proving instead of pre-proving", () => {
  const s = schedule(plan([{ amount: 100n, block: 6_000, set: 8 }]), 1_000);
  const leg = s.legs[0]!;
  assert.ok(leg.proveAfter > 1_000, "proving must be deferred, not done at planning time");
  assert.equal(leg.proveAfter, leg.submitAt - 450 + 10 + 30);
});

test("every leg keeps real headroom between submission and proof expiry", () => {
  const s = schedule(plan([
    { amount: 100n, block: 6_000, set: 8 },
    { amount: 100n, block: 20_000, set: 8 },
    { amount: 100n, block: 90_000, set: 8 },
  ]), 1_000);
  for (const leg of s.legs) {
    assert.ok(leg.slack >= 30,
      `leg at ${leg.submitAt} had ${leg.slack} blocks of headroom, needs >= 30`);
    assert.ok(leg.submitAt < leg.expiresAt, "must submit before the proof dies");
    assert.ok(leg.submitAt >= leg.earliestBlock, "must not submit before its window");
  }
  assert.equal(s.warnings.filter(w => w.includes("headroom")).length, 0);
});

test("legs aim inside their window, not at its boundary", () => {
  const s = schedule(plan([
    { amount: 100n, block: 6_000, set: 8 },
    { amount: 100n, block: 20_000, set: 8 },
  ]), 1_000);
  for (const leg of s.legs) {
    assert.notEqual(leg.submitAt, leg.earliestBlock,
      "submitting on a window boundary is itself a pattern");
    assert.ok(leg.submitAt - leg.earliestBlock < 720, "must stay inside the window");
  }
  const offsets = s.legs.map(l => l.submitAt - l.earliestBlock);
  assert.notEqual(offsets[0], offsets[1], "offsets must vary between legs");
});

test("a near leg is provable immediately with headroom to spare", () => {
  const s = schedule(plan([{ amount: 100n, block: 1_010, set: 8 }]), 1_000);
  assert.equal(s.legs[0]!.proveAfter, 1_000, "already inside its proving window");
  assert.ok(s.legs[0]!.slack > 30);
});

test("fees are charged per transaction, so splitting multiplies them", () => {
  const one = schedule(plan([{ amount: 100n, block: 1_010, set: 8 }]), 1_000);
  const six = schedule(plan(Array.from({ length: 6 }, (_, i) =>
    ({ amount: 100n, block: 1_010 + i * 40, set: 8 }))), 1_000);
  assert.equal(one.feeTotal, MAINNET_CONSTANTS.feeAmount);
  assert.equal(six.feeTotal, MAINNET_CONSTANTS.feeAmount * 6n);
  assert.equal(six.baseline.fee, MAINNET_CONSTANTS.feeAmount);
});

test("the batching tension is stated, not hidden", () => {
  const s = schedule(plan(Array.from({ length: 4 }, (_, i) =>
    ({ amount: 100n, block: 1_010 + i * 40, set: 8 }))), 1_000);
  const w = s.warnings.find((x) => x.includes("more in pool fees"));
  assert.ok(w, `expected a fee-cost warning, got ${JSON.stringify(s.warnings)}`);
  assert.ok(w!.includes("18.000 STRK"), `expected 3 extra fees quantified, got: ${w}`);
});

test("crowd per fee falls when splitting buys no extra crowd", () => {
  const one = schedule(plan([{ amount: 600n, block: 1_010, set: 8 }]), 1_000);
  const six = schedule(plan(Array.from({ length: 6 }, (_, i) =>
    ({ amount: 100n, block: 1_010 + i * 40, set: 8 }))), 1_000);
  assert.equal(one.effectiveSet, six.effectiveSet, "same crowd either way");
  assert.ok(six.crowdPerFee < one.crowdPerFee,
    "paying six fees for the same crowd must score worse");
});

test("route warnings survive into the schedule", () => {
  const s = schedule(plan([{ amount: 100n, block: 1_010, set: 8 }],
    { warnings: ["50 could not be expressed in any denomination"] }), 1_000);
  assert.ok(s.warnings.some((w) => w.includes("could not be expressed")));
});

test("operations emit the SDK's consolidation mode only for consolidation", () => {
  const s = schedule(plan([{ amount: 100n, block: 1_010, set: 8 }]), 1_000);
  const ops = toOperations(s, "0x53746f", "0xbob", { consolidateFirst: true });
  assert.equal(ops[0]!.kind, "consolidate");
  assert.equal(ops[0]!.autoSelectNotes, "all", "only 'all' actually collapses a note set");
  assert.ok(ops[0]!.call.includes("surplusTo"), "'all' requires surplusTo");
  assert.equal(ops[1]!.kind, "transfer");
  assert.equal(ops[1]!.autoSelectNotes, "naive");
  assert.ok(ops[1]!.call.includes("provingBlockId: head - 10"));
});

test("an empty plan schedules nothing and costs nothing", () => {
  const s = schedule(plan([]), 1_000);
  assert.equal(s.legs.length, 0);
  assert.equal(s.feeTotal, 0n);
  assert.equal(s.crowdPerFee, 0);
});
