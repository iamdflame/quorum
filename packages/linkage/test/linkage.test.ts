import { test } from "node:test";
import assert from "node:assert/strict";
import { analyseLinkage } from "../src/index.ts";
import type { PoolTransaction, PoolEvent } from "quorum-chain";

const ADDR = "0xaaa", TOKEN = "0x111", NOTE = "0xn1", NULL1 = "0xnull";

const ev = (kind: PoolEvent["kind"], keys: string[], data: string[] = []): PoolEvent =>
  ({ kind, keys, data });
const tx = (events: PoolEvent[], hash = "0xtx", block = 100): PoolTransaction =>
  ({ hash, block, events });

const DEPOSIT = ev("Deposit", ["sel", ADDR, TOKEN], ["0x64"]);
const ENC_NOTE = ev("EncNoteCreated", ["sel", NOTE], ["0x0"]);
const WITHDRAWAL = ev("Withdrawal", ["sel", "0xbbb", TOKEN], ["0x0", "0x64"]);
const VKS = ev("ViewingKeySet", ["sel", ADDR, "0xpub"], []);
const NOTE_USED = ev("NoteUsed", ["sel", NULL1]);
const EXTERNAL = ev("ExternalContractInvoked", ["sel", "0xhelper", "0xsel"]);

test("a deposit and a note creation in one transaction binds the note", () => {
  const r = analyseLinkage([tx([DEPOSIT, ENC_NOTE])]);
  assert.equal(r.byKind.binding.user, 1);
  assert.ok(r.exposedAddresses.has(ADDR), "the depositor is exposed");
  assert.ok(r.exposedNotes.has(NOTE), "the note is attributable");
});

test("a deposit alone binds nothing", () => {
  const r = analyseLinkage([tx([DEPOSIT])]);
  assert.equal(r.byKind.binding.user, 0);
  assert.equal(r.exposedNotes.size, 0, "an unaccompanied deposit reveals no note");
});

test("a note created alone binds nothing", () => {
  const r = analyseLinkage([tx([ENC_NOTE])]);
  assert.equal(r.exposedAddresses.size, 0, "a note with no public leg names nobody");
});

test("shield and unshield in one transaction is a round-trip", () => {
  const r = analyseLinkage([tx([DEPOSIT, WITHDRAWAL])]);
  assert.equal(r.byKind["round-trip"].user, 1);
  assert.ok(r.linkages.some((l) => l.detail.includes("protected nothing")));
});

test("registration alongside movement is the documented onboarding failure", () => {
  const r = analyseLinkage([tx([VKS, DEPOSIT])]);
  assert.equal(r.byKind.onboarding.user, 1);
  assert.ok(r.linkages.find((l) => l.kind === "onboarding")!.detail.includes("spreading setup"));
});

test("registration with no movement is not a failure", () => {
  const r = analyseLinkage([tx([VKS])]);
  assert.equal(r.byKind.onboarding.user, 0);
});

test("a nullifier beside a public withdrawal is an exit link", () => {
  const r = analyseLinkage([tx([NOTE_USED, WITHDRAWAL])]);
  assert.equal(r.byKind.exit.user, 1);
});

test("anonymizer transactions are counted separately, never as people", () => {
  // This is the control that saved the whole measurement: a private swap
  // legitimately withdraws to a helper, and counting it as a user invents
  // exposure that does not exist.
  const r = analyseLinkage([tx([DEPOSIT, ENC_NOTE, EXTERNAL])]);
  assert.equal(r.byKind.binding.user, 0);
  assert.equal(r.byKind.binding.viaAnonymizer, 1);
  assert.equal(r.exposedAddresses.size, 0, "helper flows expose no person");
  assert.equal(r.exposedNotes.size, 0);
});

test("one transaction can trip several independent failures", () => {
  const r = analyseLinkage([tx([VKS, DEPOSIT, ENC_NOTE, NOTE_USED, WITHDRAWAL])]);
  assert.equal(r.byKind.binding.user, 1);
  assert.equal(r.byKind["round-trip"].user, 1);
  assert.equal(r.byKind.onboarding.user, 1);
  assert.equal(r.byKind.exit.user, 1);
});

test("exposure accumulates per address across transactions", () => {
  const r = analyseLinkage([
    tx([DEPOSIT, ev("EncNoteCreated", ["sel", "0xn1"])], "0xt1", 1),
    tx([DEPOSIT, ev("EncNoteCreated", ["sel", "0xn2"])], "0xt2", 2),
    tx([DEPOSIT, ev("EncNoteCreated", ["sel", "0xn3"])], "0xt3", 3),
  ]);
  assert.equal(r.worst[0]!.address, ADDR);
  assert.equal(r.worst[0]!.notes, 3, "three separate notes now trace to one address");
});

test("a clean pool reports nothing", () => {
  const r = analyseLinkage([tx([ENC_NOTE]), tx([NOTE_USED], "0xt2")]);
  assert.equal(r.linkages.length, 0);
  assert.equal(r.exposedAddresses.size, 0);
  assert.equal(r.worst.length, 0);
});

test("OpenNoteDeposited binds its note too", () => {
  // depositor at keys[1], note_id at keys[3], plaintext amount in data.
  const ond = ev("OpenNoteDeposited", ["sel", ADDR, TOKEN, "0xopen"], ["0x2710"]);
  const r = analyseLinkage([tx([DEPOSIT, ond])]);
  assert.ok(r.exposedNotes.has("0xopen"));
});

test("infrastructure addresses are excluded from attribution", () => {
  // The sink receives withdrawals in transactions that never *invoke* a helper,
  // so the per-transaction anonymizer check cannot see it. Left in, it becomes
  // the single most-exposed address in the pool — plumbing wearing a person's
  // shape, which is exactly the contamination this guards against.
  const SINK = "0x127021";
  const w = ev("Withdrawal", ["sel", SINK, TOKEN], ["0x0", "0x64"]);
  const dirty = analyseLinkage([tx([NOTE_USED, w])]);
  assert.ok(dirty.exposedAddresses.has(SINK), "unfiltered, the sink is attributed");

  const clean = analyseLinkage([tx([NOTE_USED, w])], { infrastructure: new Set([SINK]) });
  assert.equal(clean.exposedAddresses.size, 0, "filtered, the sink is not a person");
  // Once the only withdrawal is a fee leg, nobody left the pool, so there is no
  // exit failure to count either. The whole transaction was internal.
  assert.equal(clean.byKind.exit.user, 0, "a fee payment is not an exit");
});

test("infrastructure matching survives felt zero-padding", () => {
  const SINK_PADDED = "0x0000127021";
  const w = ev("Withdrawal", ["sel", "0x127021", TOKEN], ["0x0", "0x64"]);
  const r = analyseLinkage([tx([NOTE_USED, w])], { infrastructure: new Set([SINK_PADDED]) });
  assert.equal(r.exposedAddresses.size, 0, "0x127021 and 0x0000127021 are one address");
});

test("a fee leg is not a user leaving the pool", () => {
  // Every pool transaction pays a fee by paying the collector, which emits a
  // Withdrawal naming it. Counting that as an exit reports hundreds of users
  // "shielding and unshielding atomically" when none of them did.
  const FEE = "0x127021";
  const feeLeg = ev("Withdrawal", ["sel", FEE, TOKEN], ["0x0", "0x53444835ec580000"]);
  const infrastructure = new Set([FEE]);

  const naive = analyseLinkage([tx([DEPOSIT, feeLeg])]);
  assert.equal(naive.byKind["round-trip"].user, 1, "unfiltered, the fee looks like an exit");

  const real = analyseLinkage([tx([DEPOSIT, feeLeg])], { infrastructure });
  assert.equal(real.byKind["round-trip"].user, 0, "nobody left the pool here");
});

test("a genuine exit alongside a fee leg is still counted", () => {
  const FEE = "0x127021";
  const feeLeg = ev("Withdrawal", ["sel", FEE, TOKEN], ["0x0", "0x64"]);
  const realExit = ev("Withdrawal", ["sel", "0xhuman", TOKEN], ["0x0", "0x64"]);
  const r = analyseLinkage([tx([DEPOSIT, feeLeg, realExit])],
    { infrastructure: new Set([FEE]) });
  assert.equal(r.byKind["round-trip"].user, 1, "a real destination still registers");
  assert.ok(r.exposedAddresses.has("0xhuman"));
});
