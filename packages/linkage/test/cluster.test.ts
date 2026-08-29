import { test } from "node:test";
import assert from "node:assert/strict";
import { clusterEntities } from "../src/cluster.ts";
import type { PoolTransaction, PoolEvent } from "quorum-chain";

const T = "0x111";
const ev = (kind: PoolEvent["kind"], keys: string[], data: string[] = []): PoolEvent =>
  ({ kind, keys, data });
const tx = (events: PoolEvent[], hash = "0xtx", block = 1): PoolTransaction =>
  ({ hash, block, events });
const dep = (a: string) => ev("Deposit", ["sel", a, T], ["0x64"]);
const wit = (a: string) => ev("Withdrawal", ["sel", a, T], ["0x0", "0x64"]);
const note = (id: string) => ev("EncNoteCreated", ["sel", id], ["0x0"]);
const EXT = ev("ExternalContractInvoked", ["sel", "0xhelper", "0xs"]);

const addrs = (r: ReturnType<typeof clusterEntities>, a: string) =>
  r.entities.find((e) => e.addresses.includes(BigInt(a).toString(16)))!.addresses;

test("a round-trip proves the funding and destination addresses are one party", () => {
  const r = clusterEntities([tx([dep("0xaaa"), wit("0xbbb")])]);
  assert.equal(r.entityCount, 1, "two addresses, one person");
  assert.equal(r.multiAddress, 1);
  assert.equal(addrs(r, "0xaaa").length, 2);
  assert.equal(r.evidence[0]!.rule, "round-trip");
  assert.ok(r.evidence[0]!.detail.includes("the pool exists to hide"));
});

test("deposits authorised together share a payer", () => {
  const r = clusterEntities([tx([dep("0xaaa"), dep("0xbbb"), dep("0xccc")])]);
  assert.equal(r.entityCount, 1);
  assert.equal(addrs(r, "0xaaa").length, 3);
  assert.equal(r.evidence[0]!.rule, "co-deposit");
});

test("a note bound to two addresses joins them, since a note has one owner", () => {
  const r = clusterEntities([
    tx([dep("0xaaa"), note("0xn1")], "0xt1", 1),
    tx([dep("0xbbb"), note("0xn1")], "0xt2", 2),
  ]);
  assert.equal(r.entityCount, 1);
  assert.ok(r.evidence.some((e) => e.rule === "shared-note"));
});

test("clusters merge transitively across transactions", () => {
  // A~B by round-trip, B~C by co-deposit: A, B and C are one party.
  const r = clusterEntities([
    tx([dep("0xaaa"), wit("0xbbb")], "0xt1", 1),
    tx([dep("0xbbb"), dep("0xccc")], "0xt2", 2),
  ]);
  assert.equal(r.entityCount, 1);
  assert.equal(addrs(r, "0xaaa").length, 3, "transitive closure over the joins");
});

test("an entity's exposure is the union of its addresses' notes", () => {
  const r = clusterEntities([
    tx([dep("0xaaa"), wit("0xbbb"), note("0xn1")], "0xt1", 1),
    tx([dep("0xbbb"), note("0xn2")], "0xt2", 2),
  ]);
  assert.equal(r.entityCount, 1);
  assert.equal(r.largest!.notes.length, 2,
    "notes from both addresses belong to the one party");
});

test("unrelated addresses stay separate", () => {
  const r = clusterEntities([
    tx([dep("0xaaa"), note("0xn1")], "0xt1", 1),
    tx([dep("0xbbb"), note("0xn2")], "0xt2", 2),
  ]);
  assert.equal(r.entityCount, 2, "no rule fired, so no link is claimed");
  assert.equal(r.multiAddress, 0);
});

test("helper flows never link two people", () => {
  const r = clusterEntities([tx([dep("0xaaa"), wit("0xbbb"), EXT])]);
  assert.equal(r.entityCount, 0, "a private swap is one party's plumbing, not a link");
});

test("infrastructure is excluded from clustering", () => {
  const SINK = "0x127021";
  const r = clusterEntities([tx([dep("0xaaa"), wit(SINK)])],
    { infrastructure: new Set([SINK]) });
  assert.ok(!r.entities.some((e) => e.addresses.includes(BigInt(SINK).toString(16))),
    "paying a fee sink does not make you the fee sink");
});

test("zero-padded and bare felts are one address", () => {
  const r = clusterEntities([
    tx([dep("0x0000aaa"), wit("0xbbb")], "0xt1", 1),
    tx([dep("0xaaa"), wit("0xccc")], "0xt2", 2),
  ]);
  assert.equal(r.entityCount, 1, "padding must not split one person into two");
  assert.equal(addrs(r, "0xaaa").length, 3);
});

test("self-round-trip does not create a spurious join", () => {
  const r = clusterEntities([tx([dep("0xaaa"), wit("0xaaa")])]);
  assert.equal(r.multiAddress, 0, "one address is not a cluster of two");
});

test("an empty pool clusters nothing", () => {
  const r = clusterEntities([]);
  assert.equal(r.entityCount, 0);
  assert.equal(r.largest, null);
  assert.equal(r.evidence.length, 0);
});
