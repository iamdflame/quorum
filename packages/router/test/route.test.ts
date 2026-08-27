import { test } from "node:test";
import assert from "node:assert/strict";
import { route, decompose, denominations, MAX_LEGS } from "../src/index.ts";
import type { PoolObservation, PublicEdge } from "@shoal/oracle";

const TOKEN = 0x53746fn;
const RARE = 0x999n;

function obs(edges: PublicEdge[], head = 700_000): PoolObservation {
  return { head, notes: [], edges, channels: [], blockTimeSeconds: 30 };
}
function e(amount: bigint, block: number, operator: bigint, token = TOKEN): PublicEdge {
  return { kind: "deposit", token, amount, block, own: false, operator };
}

/** A pool with genuine crowds at 100 and 1000, spread over many windows. */
function busyPool(): PublicEdge[] {
  // Spaced for the real ~1.7s block time: a six-hour window is 12,700 blocks,
  // so activity has to span days to occupy more than one of them.
  const edges: PublicEdge[] = [];
  for (let i = 0; i < 120; i++) {
    edges.push(e(1000n, i * 5_000, BigInt(1000 + i)));
    edges.push(e(100n, i * 5_000 + 900, BigInt(2000 + i)));
  }
  return edges;
}

test("denominations are ranked by real crowd and exclude solo amounts", () => {
  const menu = denominations(obs([
    ...Array.from({ length: 5 }, (_, i) => e(1000n, i, BigInt(i))),
    e(7_777n, 99, 0xdeadn), // used exactly once — no crowd
  ]), TOKEN);
  assert.ok(menu.some((d) => d.amount === 1000n), "popular denomination present");
  assert.ok(!menu.some((d) => d.amount === 7_777n), "solo denomination excluded");
});

test("decompose is largest-first and reports what it cannot express", () => {
  const menu = [{ amount: 1000n, effectiveSet: 9 }, { amount: 100n, effectiveSet: 9 }];
  const { legs, remainder } = decompose(2_150n, menu);
  assert.deepEqual(legs.map((l) => l.amount), [1000n, 1000n, 100n]);
  assert.equal(remainder, 50n, "the 50 that fits no denomination is surfaced");
});

test("decompose never exceeds the leg cap", () => {
  const menu = [{ amount: 1n, effectiveSet: 9 }];
  const { legs, remainder } = decompose(10_000n, menu);
  assert.equal(legs.length, MAX_LEGS);
  assert.ok(remainder > 0n, "capping legs leaves a remainder rather than hiding it");
});

test("a plan is only as strong as its weakest leg", () => {
  const plan = route(obs(busyPool()), TOKEN, 2_100n);
  assert.ok(plan.legs.length > 1, "expected a split");
  const worst = Math.min(...plan.legs.map((l) => l.effectiveSet));
  assert.equal(plan.effectiveSet, worst,
    "plan crowd must be the minimum across legs, never the average");
});

test("routing into a real crowd beats acting alone", () => {
  // The case the router exists for: the operator is standing in a quiet window
  // while busy ones sit ahead. With a genuine six-hour window this is narrower
  // than it looks — if the current window already holds a crowd there is
  // nothing to gain, and the router correctly reports an improvement of 1.
  const edges = busyPool();
  const quietHead = 120 * 5_000 + 200_000;   // well past the last activity
  const plan = route(obs(edges, quietHead), TOKEN, 2_000n);
  assert.ok(plan.baseline <= 1.0001, `acting now should be lonely, got ${plan.baseline}`);
  assert.ok(plan.effectiveSet > 1, `expected a crowd to route into, got ${plan.effectiveSet}`);
  assert.ok(plan.improvement > 1, `expected improvement, got ${plan.improvement}`);
});

test("routing claims no improvement when the current window is already busy", () => {
  // Honesty in the other direction. A wider window means the crowd you need is
  // often already around you, and a router that always claims a multiple is
  // selling something.
  const edges = busyPool();
  const plan = route(obs(edges, 60_000), TOKEN, 2_000n);
  assert.ok(plan.improvement >= 1);
  assert.ok(plan.effectiveSet >= plan.baseline * 0.999,
    "routing must never land you in a smaller crowd than acting now");
});

test("an asset nobody else uses is honestly reported as unroutable", () => {
  const plan = route(obs([...busyPool(), e(5_000n, 10, 0xaan, RARE)]), RARE, 5_000n);
  assert.equal(plan.effectiveSet, 1);
  assert.equal(plan.legs.length, 0);
  assert.ok(plan.warnings[0]!.includes("no crowd to route into"),
    `expected an explicit warning, got: ${plan.warnings[0]}`);
});

test("legs are spread across distinct future windows", () => {
  const plan = route(obs(busyPool()), TOKEN, 3_000n);
  const windows = plan.legs.map((l) => l.window);
  assert.equal(new Set(windows).size, windows.length, "legs must not share a window");
  for (const l of plan.legs) {
    assert.ok(l.earliestBlock > 0);
    assert.ok(l.window > Math.floor(100_000 / 12_700), "legs are placed in the future");
  }
});

test("an unexpressible remainder is warned about, not silently absorbed", () => {
  const plan = route(obs(busyPool()), TOKEN, 1_057n);
  assert.ok(plan.warnings.some((w) => w.includes("could not be expressed")),
    `expected a remainder warning, got ${JSON.stringify(plan.warnings)}`);
  const moved = plan.legs.reduce((s, l) => s + l.amount, 0n);
  assert.ok(moved < 1_057n, "the remainder is left unmoved rather than rounded away");
});
