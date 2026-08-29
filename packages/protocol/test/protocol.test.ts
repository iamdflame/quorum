import { test } from "node:test";
import assert from "node:assert/strict";
import {
  payoutRoot, refundCommitment, foldPledge, pledgeRoot, TAGS, toFelt,
  secretFromSignature, pledgeKeyFromSignature,
} from "../src/commit.ts";
import {
  hashTerms, verifyTerms, prepareCampaign, timeRemaining, CampaignError, type Terms,
} from "../src/campaign.ts";
import {
  createActions, commitActions, fireActions, reclaimActions, unsealActions, OP, POLICY,
} from "../src/actions.ts";
import { verifyCampaign, replayRoots, type OnChainCampaign, type CommittedEvent } from "../src/verify.ts";

const TERMS: Terms = {
  statement: "We will not accept the new contract.",
  action: "Each pledge funds one day of the strike fund.",
  organiser: "shop floor",
};

// ------------------------------------------------------------ commitments

test("commitments match the values pinned in the Cairo test", () => {
  // If either side drifts, pledges become unreclaimable and nothing throws.
  assert.equal(BigInt(refundCommitment("0x61")),
    0x723a1fdb89394b78490e7f0a5679b744121ae254f15a3877e886cd0cb09622cn);
  assert.equal(BigInt(foldPledge(0n, "0x61")),
    0x5991bef78f95d42e2b187573b6143e6f3081fa41359124785262ae781a2ce82n);
});

test("domain tags are disjoint, so a preimage is inert outside its context", () => {
  assert.equal(new Set(Object.values(TAGS)).size, 3, "all three tags distinct");
});

test("the payout fold is order-dependent", () => {
  // Same destinations, same amounts, different order is a different commitment —
  // otherwise a firer could permute a set to change who is paid first.
  const a = { noteId: "0x1", token: "0x111", amount: 200n };
  const b = { noteId: "0x2", token: "0x111", amount: 300n };
  assert.notEqual(BigInt(payoutRoot([a, b])), BigInt(payoutRoot([b, a])));
});

test("an empty payout set folds to zero", () => {
  assert.equal(BigInt(payoutRoot([])), 0n);
});

test("the accumulator is order-dependent", () => {
  const ab = pledgeRoot(["0x1", "0x2"]);
  const ba = pledgeRoot(["0x2", "0x1"]);
  assert.notEqual(BigInt(ab), BigInt(ba),
    "reordering pledges must change the root, or arrival order can be rewritten");
});

test("an empty campaign has the zero root", () => {
  assert.equal(BigInt(pledgeRoot([])), 0n);
});

// ------------------------------------------------- deterministic secrets

test("a pledge secret is reproducible from the same signature", () => {
  const sig = ["0xaaa", "0xbbb"];
  assert.equal(secretFromSignature(sig, "0xcamp"), secretFromSignature([...sig], "0xcamp"),
    "the same wallet on a new machine must derive the same secret");
});

test("different signatures give different secrets", () => {
  assert.notEqual(secretFromSignature(["0xaaa", "0xbbb"], "0xcamp"),
    secretFromSignature(["0xaaa", "0xccc"], "0xcamp"));
});

test("the same wallet derives a different secret per campaign", () => {
  // Without this, one leaked pledge unlocks that person's pledge in every
  // campaign they ever joined - including ones nobody knew they were in.
  const sig = ["0xaaa", "0xbbb"];
  assert.notEqual(secretFromSignature(sig, "0xcamp-a"), secretFromSignature(sig, "0xcamp-b"));
});

test("the secret is not the raw signature", () => {
  const sig = ["0xaaa", "0xbbb"];
  assert.notEqual(BigInt(secretFromSignature(sig, "0xcamp")), BigInt(sig[0]!));
});

test("an empty signature is refused rather than producing a guessable secret", () => {
  assert.throws(() => secretFromSignature([], "0xcamp"), /Empty signature/);
});

test("a pledge key carries its own commitment", () => {
  const k = pledgeKeyFromSignature("0xcamp", ["0xaaa", "0xbbb"]);
  assert.equal(k.commitment, refundCommitment(k.secret));
  assert.equal(k.campaignId, "0xcamp");
});

// ----------------------------------------------------------------- terms

test("terms hash deterministically regardless of key order", () => {
  const a = hashTerms(TERMS);
  const b = hashTerms({ action: TERMS.action, statement: TERMS.statement, organiser: TERMS.organiser } as Terms);
  assert.equal(BigInt(a), BigInt(b));
});

test("an edited document no longer matches its commitment", () => {
  const committed = hashTerms(TERMS);
  assert.ok(verifyTerms(TERMS, committed));
  assert.ok(!verifyTerms({ ...TERMS, statement: "We accept the new contract." }, committed),
    "changing the statement must break verification");
});

test("optional fields do not change the hash when absent versus empty", () => {
  const withEmpty = hashTerms({ statement: "s", action: "a", organiser: "", detail: "" });
  const without = hashTerms({ statement: "s", action: "a" });
  assert.equal(BigInt(withEmpty), BigInt(without));
});

// ------------------------------------------------------------- campaigns

const WEEK_BLOCKS = 355_000;  // ~7 days at 1.7s
const SPEC = {
  id: "walkout-2026", terms: TERMS, token: "0x111", unit: 100n,
  threshold: 5, expiryBlock: 10 + WEEK_BLOCKS,
  policy: { kind: "RefundAll" } as const,
};

test("a valid campaign prepares cleanly", () => {
  const c = prepareCampaign(SPEC, 10);
  assert.equal(c.threshold, 5);
  assert.equal(BigInt(c.terms), BigInt(hashTerms(TERMS)));
  assert.equal(c.policy, POLICY.RefundAll);
  assert.equal(BigInt(c.payoutRoot), 0n, "refund-all commits no destinations");
});

test("a treasury campaign must name its destinations up front", () => {
  assert.throws(() => prepareCampaign({ ...SPEC,
    policy: { kind: "BoundTreasury", payouts: [] } }, 10), /before anyone pledges/);
});

test("treasury payouts must equal exactly what a quorum escrows", () => {
  // Otherwise the campaign reaches quorum and can then never be fired, because
  // the contract requires the sums equal. Better to refuse it at creation.
  assert.throws(() => prepareCampaign({ ...SPEC,
    policy: { kind: "BoundTreasury",
      payouts: [{ noteId: "0x1", token: "0x111", amount: 499n }] } }, 10),
    /never be fireable/);
  const ok = prepareCampaign({ ...SPEC,
    policy: { kind: "BoundTreasury",
      payouts: [{ noteId: "0x1", token: "0x111", amount: 500n }] } }, 10);
  assert.equal(ok.policy, POLICY.BoundTreasury);
  assert.notEqual(BigInt(ok.payoutRoot), 0n);
});

test("a zero unit is refused", () => {
  assert.throws(() => prepareCampaign({ ...SPEC, unit: 0n }, 10), /identical unit/);
});

test("a threshold below two is refused", () => {
  // It would fire on the first pledge, which is a donation, not coordination.
  assert.throws(() => prepareCampaign({ ...SPEC, threshold: 1 }, 10), CampaignError);
});

test("an expiry in the past is refused", () => {
  // Pledges could never be made, and never refunded.
  assert.throws(() => prepareCampaign({ ...SPEC, expiryBlock: 5 }, 10), CampaignError);
});

test("a campaign id can be a human name", () => {
  // An organiser names a campaign; they should not have to think in felts.
  const c = prepareCampaign(SPEC, 10);
  assert.equal(c.id, "walkout-2026");
});

test("a campaign with no statement is refused", () => {
  assert.throws(() => prepareCampaign({ ...SPEC, terms: { statement: "  ", action: "a" } }, 10),
    /commit to nothing/);
});

test("an expired campaign reads as closed", () => {
  assert.equal(timeRemaining(1000, 1001).human, "closed");
});

// --------------------------------------------------------------- actions

test("create deposits the organiser's own pledge", () => {
  // The pool refuses an invoke that moves no value, so a create carrying
  // nothing cannot be submitted. The deposit is the organiser's first pledge.
  const a = createActions("0x79bab0", prepareCampaign(SPEC, 10), refundCommitment("0xorg"));
  // A deposit alone leaves the value in the pledger's own note. The withdraw is
  // what moves it to the helper, which is what the contract measures.
  assert.deepEqual(a.map((x) => x.type), ["deposit", "withdraw", "invoke"]);
  assert.equal(a[1]!["recipient"], "0x79bab0", "the withdraw funds the machine");
  assert.equal(BigInt((a[2]!.calldata as string[])[0]!), BigInt(OP.Create));
});

test("a refund-all fire is paired with a self-transfer", () => {
  // It moves no value by design, and the pool rejects an invoke that moves none.
  const a = fireActions("0x79bab0", "walkout-2026", { token: "0x4718f5a0", self: "0xaaa" });
  assert.deepEqual(a.map((x) => x.type), ["transfer", "invoke"]);
  assert.equal(a[0]!["recipient"], "0xaaa", "to the firer, changing nobody's balance");
});

test("a refund-all fire refuses to build without somewhere to send the pairing", () => {
  assert.throws(() => fireActions("0x79bab0", "walkout-2026"), /moves no value/);
});

test("a treasury fire needs no pairing, because it moves the payouts", () => {
  const a = fireActions("0x79bab0", "walkout-2026", {
    payouts: [{ noteId: "0x1", token: "0x4718f5a0", amount: 500n }],
  });
  assert.equal(a.length, 1);
  assert.equal(a[0]!.type, "invoke");
});

test("commit passes no amount at all — the contract measures its own balance", () => {
  const a = commitActions("0x79bab0", "walkout-2026", "0x111", 100n, "0xcommit");
  assert.deepEqual(a.map((x) => x.type), ["deposit", "withdraw", "invoke"]);
  const cd = a[2]!.calldata as string[];
  assert.equal(BigInt(cd[0]!), BigInt(OP.Commit));
  assert.equal(BigInt(cd[cd.length - 1]!), 0n, "empty payout span: nothing is credited");
  // Passing an amount would invite it to be believed; the withdraw is the fact.
  assert.equal(a[1]!["amount"], "0x64");
});

test("firing a refund-all campaign carries no payouts", () => {
  const a = fireActions("0x79bab0", "walkout-2026", { token: "0x4718f5a0", self: "0xaaa" });
  const cd = a[1]!.calldata as string[];
  assert.equal(BigInt(cd[0]!), BigInt(OP.Fire));
  assert.equal(BigInt(cd[cd.length - 1]!), 0n, "no destinations, so nothing can be redirected");
});

test("unseal carries a payload and no value", () => {
  const a = unsealActions("0xmachine", "walkout-2026", "0xsecret", "0xpayload");
  assert.equal(a.length, 1, "unsealing moves nothing");
  const cd = a[0]!.calldata as string[];
  assert.equal(BigInt(cd[0]!), BigInt(OP.Unseal));
});

test("reclaim mints an open note for the refund to land in", () => {
  const a = reclaimActions("0xmachine", "walkout-2026", "0x111", "0xsecret");
  assert.deepEqual(a.map((x) => x.type), ["transfer", "invoke"]);
  assert.equal(a[0]!["amount"], "OPEN");
  const cd = a[1]!.calldata as string[];
  assert.ok(cd.includes("${openNoteIds[0]}"),
    "the wallet fills the note id, so the dapp never learns it");
});

test("fire serialises a payout span correctly", () => {
  const a = fireActions("0x79bab0", "walkout-2026", { payouts: [
    { noteId: "0x1", token: "0x111", amount: 300n },
    { noteId: "0x2", token: "0x111", amount: 200n },
  ] });
  const cd = a[0]!.calldata as string[];
  // 13 fixed params, then length 2, then two flattened deposits of 3 felts each.
  assert.equal(cd.length, 13 + 1 + 6);
  assert.equal(BigInt(cd[13]!), 2n, "span length precedes the elements");
  assert.equal(BigInt(cd[16]!), 300n);
});

// ---------------------------------------------------------- verification

const chain: OnChainCampaign = {
  phase: "Open", terms: hashTerms(TERMS), threshold: 5,
  pledgeCount: 3, pledgeRoot: pledgeRoot(["0x1", "0x2", "0x3"]),
  escrowed: 300n, expiryBlock: 1000,
};
const committed: CommittedEvent[] = [
  { pledgeRoot: pledgeRoot(["0x1"]), pledgeCount: 1, block: 10, tx: "0xa" },
  { pledgeRoot: pledgeRoot(["0x1", "0x2"]), pledgeCount: 2, block: 20, tx: "0xb" },
  { pledgeRoot: pledgeRoot(["0x1", "0x2", "0x3"]), pledgeCount: 3, block: 30, tx: "0xc" },
];

test("an honest campaign verifies", () => {
  const v = verifyCampaign(chain, { committed },
    { terms: TERMS, commitments: ["0x1", "0x2", "0x3"] });
  assert.ok(v.sound, JSON.stringify(v.findings.filter((f) => !f.ok), null, 1));
});

test("a rewritten pledge set fails root replay", () => {
  const v = verifyCampaign(chain, { committed },
    { commitments: ["0x1", "0x3", "0x2"] });  // reordered
  const f = v.findings.find((x) => x.check === "pledge root")!;
  assert.ok(!f.ok);
  assert.ok(f.detail.includes("altered after it was recorded"));
});

test("a substituted document fails the terms check", () => {
  const v = verifyCampaign(chain, { committed },
    { terms: { ...TERMS, statement: "different" } });
  assert.ok(!v.findings.find((x) => x.check === "terms")!.ok);
});

test("a missing pledge event is caught by the count", () => {
  const v = verifyCampaign(chain, { committed: committed.slice(0, 2) }, {});
  assert.ok(!v.findings.find((x) => x.check === "pledge count")!.ok);
});

test("a non-sequential event stream is caught", () => {
  const gap: CommittedEvent[] = [committed[0]!, { ...committed[2]! }];
  const v = verifyCampaign({ ...chain, pledgeCount: 2 }, { committed: gap }, {});
  assert.ok(!v.findings.find((x) => x.check === "pledge sequence")!.ok);
});

test("firing below quorum is reported as impossible-if-honest", () => {
  const v = verifyCampaign({ ...chain, phase: "Fired", escrowed: 0n },
    { committed, fired: { outcome: "0x1", pledgeCount: 3, block: 40, tx: "0xd" } }, {});
  const f = v.findings.find((x) => x.check === "quorum honoured")!;
  assert.ok(!f.ok);
  assert.ok(f.detail.includes("not the one it claims to be"));
});

test("expiry without firing is reported as refunds being open", () => {
  const v = verifyCampaign(chain, { committed }, { currentBlock: 1001 });
  const f = v.findings.find((x) => x.check === "refunds open")!;
  assert.ok(f.ok);
  assert.ok(f.detail.includes("firing is no longer possible"));
});

test("unverifiable is not the same as false", () => {
  // An observer holding no commitments must not see a root failure.
  const v = verifyCampaign(chain, { committed }, {});
  assert.ok(!v.findings.some((f) => f.check === "pledge root"),
    "root replay is skipped, not failed, when there is nothing to replay with");
  assert.ok(v.sound);
});

// ------------------------------------------------------------ block time

import {
  blocksFor, blocksPerDay, humanDuration, measureBlockTime, FALLBACK_CLOCK,
  OBSERVED_BLOCK_SECONDS, DAY,
} from "../src/blocktime.ts";

test("a day is about fifty thousand blocks, not two thousand", () => {
  // The 30s assumption gave 2,880 and was wrong by roughly eighteen times.
  const d = blocksPerDay();
  assert.ok(d > 45_000 && d < 55_000, `expected ~50,800 blocks/day, got ${d}`);
  assert.equal(OBSERVED_BLOCK_SECONDS, 1.7);
});

test("proof validity of 450 blocks is minutes, not hours", () => {
  // The scheduler had this as 3.75 hours. It is closer to thirteen minutes,
  // which changes when a proof may be generated relative to submission.
  const s = 450 * OBSERVED_BLOCK_SECONDS;
  assert.ok(s > 700 && s < 800, `expected ~765s, got ${s}`);
  assert.ok(humanDuration(450).includes("minutes"));
});

test("durations round up, so a deadline never lands early", () => {
  assert.equal(blocksFor(1.7), 1);
  assert.equal(blocksFor(1.8), 2, "a partial block still needs a whole block");
});

test("measured block time beats the fallback when a sample is large enough", async () => {
  // 1.0s/block over 200k blocks.
  const clock = await measureBlockTime(200_000, async (b) => b * 1, 200_000);
  assert.ok(clock.measured);
  assert.ok(Math.abs(clock.secondsPerBlock - 1) < 1e-9);
  assert.equal(clock.sampleBlocks, 200_000);
});

test("a sample too small to trust falls back rather than reporting jitter", () => {
  // The 1,000-block sample read 2.03 s/block against a true 1.70 — using it
  // would make every deadline 20% wrong in a direction nobody checks.
  return measureBlockTime(1_000, async (b) => b * 99, 1_000).then((clock) => {
    assert.ok(!clock.measured);
    assert.equal(clock.secondsPerBlock, OBSERVED_BLOCK_SECONDS);
  });
});

test("an unreachable node falls back instead of throwing", async () => {
  const clock = await measureBlockTime(200_000, async () => { throw new Error("down"); });
  assert.ok(!clock.measured);
});

test("a campaign closing in minutes is refused as a units mistake", () => {
  // 2880 blocks was "a day" under the old assumption. It is under an hour.
  assert.throws(
    () => prepareCampaign({ ...SPEC, expiryBlock: 10 + 200 }, 10),
    /units mistake/,
  );
});

test("a genuine week-long campaign is accepted", () => {
  const week = blocksFor(7 * DAY);
  const c = prepareCampaign({ ...SPEC, expiryBlock: 10 + week }, 10);
  assert.equal(c.expiryBlock, 10 + week);
  assert.ok(week > 300_000, `a week should be ~355,000 blocks, got ${week}`);
});

test("time remaining reports in units an organiser can check", () => {
  assert.equal(timeRemaining(1000, 1000).expired, true);
  assert.ok(timeRemaining(10 + blocksFor(7 * DAY), 10).human.includes("days"));
  assert.ok(timeRemaining(10 + blocksFor(600), 10).human.includes("minutes"));
});

// ------------------------------------------------------- wallet API shape

/**
 * `ADDRESS` is `FELT`, whose pattern forbids leading zeros except for a bare
 * `0x0`. Starknet addresses are conventionally written padded to 64 hex digits,
 * so the canonical form of a contract address is *rejected by the wallet* —
 * before it proves anything, with `INVALID_REQUEST_PAYLOAD`, which names no
 * field. Worth a test, because the failure gives no clue what it is about.
 */
const FELT_PATTERN = /^0x(0|[a-fA-F1-9]{1}[a-fA-F0-9]{0,62})$/;

test("the wallet's FELT pattern rejects padded addresses", () => {
  const padded = "0x00dca84ff35ee793c69c983abfc29e3e1aa8790f7dcd7e0288b705f600fcdaf7";
  assert.ok(!FELT_PATTERN.test(padded), "a padded address must be recognised as invalid");
  assert.ok(FELT_PATTERN.test("0x" + BigInt(padded).toString(16)));
});

test("every felt we emit in calldata is acceptable to the wallet", () => {
  const spec = {
    ...SPEC,
    policy: { kind: "BoundTreasury" as const,
      payouts: [{ noteId: "0x1", token: "0x111", amount: 500n }] },
  };
  const actions = [
    ...createActions("0x79bab0", prepareCampaign(spec, 10), refundCommitment("0xorg")),
    ...commitActions("0x79bab0", "walkout-2026", "0x4718f5a0", 100n, refundCommitment("0xa")),
    ...fireActions("0x79bab0", "walkout-2026",
      { payouts: [{ noteId: "0x1", token: "0x4718f5a0", amount: 500n }] }),
    ...reclaimActions("0x79bab0", "walkout-2026", "0x4718f5a0", "0xsecret"),
    ...unsealActions("0x79bab0", "walkout-2026", "0xsecret", "0xpayload"),
  ];
  for (const a of actions) {
    for (const item of (a["calldata"] as string[] | undefined) ?? []) {
      // Wallet placeholders are exempt: the wallet substitutes them itself.
      if (item.startsWith("${")) continue;
      assert.ok(FELT_PATTERN.test(item), `calldata item "${item}" would be rejected`);
    }
    for (const key of ["contract", "token", "recipient"]) {
      const v = a[key] as string | undefined;
      if (typeof v !== "string" || v.startsWith("${")) continue;
      assert.ok(FELT_PATTERN.test(v), `${key} "${v}" would be rejected`);
    }
  }
});

test("a decimal string is a number, not a name", () => {
  // Wallets return signature components as decimal. Treating one as a name
  // tries to encode a 76-digit integer as a Cairo short string.
  const decimal = "1359875869018127880684032253361965086718885364505183201468179827409842874670";
  assert.equal(BigInt(toFelt(decimal)), BigInt(decimal));
});

test("a signature of decimal components derives a secret", () => {
  const sig = [
    "1359875869018127880684032253361965086718885364505183201468179827409842874670",
    "2891234567890123456789012345678901234567890123456789012345678901234567890123",
  ];
  const secret = secretFromSignature(sig, "walkout-2026");
  assert.ok(FELT_PATTERN.test(secret), "the derived secret must itself be a valid felt");
  assert.equal(secret, secretFromSignature([...sig], "walkout-2026"), "and be reproducible");
});

test("names are still names", () => {
  assert.equal(BigInt(toFelt("walkout-2026")), BigInt("0x77616c6b6f75742d32303236"));
});
