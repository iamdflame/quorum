import { test } from "node:test";
import assert from "node:assert/strict";
import { sinkCandidates } from "../src/index.ts";
import type { PublicEdge } from "../src/types.ts";

const w = (operator: bigint, token: bigint, block: number): PublicEdge =>
  ({ kind: "withdrawal", operator, token, amount: 1n, block, tx: `0x${block}` });
const d = (operator: bigint, token: bigint, block: number): PublicEdge =>
  ({ kind: "deposit", operator, token, amount: 1n, block, tx: `0x${block}` });

test("a single-asset payee is still a payee", () => {
  /*
   * The pool's paymaster receives in nearly every transaction but only ever in
   * one or two tokens. While breadth and volume were an AND it failed the
   * breadth test, was counted as a person, and every transaction that paid it
   * became a user who had apparently shielded and unshielded atomically —
   * dozens of reported privacy failures, not one of them real.
   */
  const edges = Array.from({ length: 40 }, (_, i) => w(0x127021an, 0x4aan, i));
  assert.ok(sinkCandidates(edges).has((0x127021an).toString(16)));
});

test("breadth alone is enough, without the volume", () => {
  const edges = [w(0xfeen, 0x1n, 1), w(0xfeen, 0x2n, 2), w(0xfeen, 0x3n, 3)];
  assert.ok(sinkCandidates(edges).has((0xfeen).toString(16)));
});

test("someone who deposits is a participant, however much they receive", () => {
  // The rule that protects real users from being deleted out of the crowd.
  const edges = [d(0xbeefn, 0x4aan, 0), ...Array.from({ length: 40 }, (_, i) => w(0xbeefn, 0x4aan, i + 1))];
  assert.ok(!sinkCandidates(edges).has((0xbeefn).toString(16)));
});

test("an occasional receiver is not plumbing", () => {
  const edges = [w(0xcafen, 0x4aan, 1), w(0xcafen, 0x4aan, 2)];
  assert.equal(sinkCandidates(edges).size, 0);
});
