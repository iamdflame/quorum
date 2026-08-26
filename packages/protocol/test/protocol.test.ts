import { test } from "node:test";
import assert from "node:assert/strict";
import {
  fireCommitment, refundCommitment, foldPledge, pledgeRoot, TAGS,
  secretFromSignature, pledgeKeyFromSignature,
} from "../src/commit.ts";
import {
  hashTerms, verifyTerms, prepareCampaign, timeRemaining, CampaignError, BLOCKS_PER_DAY,
  type Terms,
} from "../src/campaign.ts";
import { createActions, commitActions, fireActions, reclaimActions, OP } from "../src/actions.ts";
import { verifyCampaign, replayRoots, type OnChainCampaign, type CommittedEvent } from "../src/verify.ts";

const TERMS: Terms = {
  statement: "We will not accept the new contract.",
  action: "Each pledge funds one day of the strike fund.",
  organiser: "shop floor",
};

// ------------------------------------------------------------ commitments

test("commitments match the values pinned in the Cairo test", () => {
  // If either side drifts, pledges become unreclaimable and nothing throws.
  assert.equal(BigInt(fireCommitment("0x6f7267616e697365722d6b6579")),
    0x5e4f5b6a2de88f499f97193a56c996146e4da86ecb5717efe43c96b99468470n);
  assert.equal(BigInt(refundCommitment("0x61")),
    0x723a1fdb89394b78490e7f0a5679b744121ae254f15a3877e886cd0cb09622cn);
  assert.equal(BigInt(foldPledge(0n, "0x61")),
    0x5991bef78f95d42e2b187573b6143e6f3081fa41359124785262ae781a2ce82n);
});

test("domain tags are disjoint, so a preimage is inert outside its context", () => {
  const secret = "0x1234";
  const f = BigInt(fireCommitment(secret));
  const r = BigInt(refundCommitment(secret));
  assert.notEqual(f, r, "the same secret must not open both a fire and a refund");
  assert.equal(new Set(Object.values(TAGS)).size, 3, "all three tags distinct");
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
  assert.equal(secretFromSignature(sig), secretFromSignature([...sig]),
    "the same wallet on a new machine must derive the same secret");
});

test("different signatures give different secrets", () => {
  assert.notEqual(secretFromSignature(["0xaaa", "0xbbb"]), secretFromSignature(["0xaaa", "0xccc"]));
});

test("the secret is not the raw signature", () => {
  // A raw r would leak anywhere the same message is ever signed again.
  const sig = ["0xaaa", "0xbbb"];
  assert.notEqual(BigInt(secretFromSignature(sig)), BigInt(sig[0]!));
});

test("an empty signature is refused rather than producing a guessable secret", () => {
  assert.throws(() => secretFromSignature([]), /Empty signature/);
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

const SPEC = {
  id: "0xcamp", terms: TERMS, token: "0x111",
  threshold: 5, expiryBlock: 1000, fireSecret: "0xsecret",
};

test("a valid campaign prepares cleanly", () => {
  const c = prepareCampaign(SPEC, 10);
  assert.equal(c.threshold, 5);
  assert.equal(BigInt(c.terms), BigInt(hashTerms(TERMS)));
  assert.equal(BigInt(c.fireCommitment), BigInt(fireCommitment("0xsecret")));
});

test("a threshold below two is refused", () => {
  // It would fire on the first pledge, which is a donation, not coordination.
  assert.throws(() => prepareCampaign({ ...SPEC, threshold: 1 }, 10), CampaignError);
});

test("an expiry in the past is refused", () => {
  // Pledges could never be made, and never refunded.
  assert.throws(() => prepareCampaign({ ...SPEC, expiryBlock: 5 }, 10), CampaignError);
});

test("a campaign with no statement is refused", () => {
  assert.throws(() => prepareCampaign({ ...SPEC, terms: { statement: "  ", action: "a" } }, 10),
    /commit to nothing/);
});

test("time remaining reads in human units and knows when it is over", () => {
  assert.equal(timeRemaining(1000, 1000).expired, true);
  assert.equal(timeRemaining(1000, 1001).human, "closed");
  assert.ok(timeRemaining(10 + BLOCKS_PER_DAY * 7, 10).human.includes("days"));
});

// --------------------------------------------------------------- actions

test("create encodes the campaign, escrows nothing, and mints no note", () => {
  const a = createActions("0xmachine", prepareCampaign(SPEC, 10));
  assert.equal(a.length, 1, "opening a campaign moves no value");
  assert.equal(a[0]!.type, "invoke");
  assert.equal(BigInt((a[0]!.calldata as string[])[0]!), BigInt(OP.Create));
});

test("commit deposits and parks, crediting nothing back", () => {
  const a = commitActions("0xmachine", "0xcamp", "0x111", 100n, "0xcommit");
  assert.deepEqual(a.map((x) => x.type), ["deposit", "invoke"]);
  const cd = a[1]!.calldata as string[];
  assert.equal(BigInt(cd[0]!), BigInt(OP.Commit));
  assert.equal(BigInt(cd[cd.length - 1]!), 0n, "empty payout span: nothing is credited");
});

test("reclaim mints an open note for the refund to land in", () => {
  const a = reclaimActions("0xmachine", "0xcamp", "0x111", "0xsecret");
  assert.deepEqual(a.map((x) => x.type), ["transfer", "invoke"]);
  assert.equal(a[0]!["amount"], "OPEN");
  const cd = a[1]!.calldata as string[];
  assert.ok(cd.includes("${openNoteIds[0]}"),
    "the wallet fills the note id, so the dapp never learns it");
});

test("fire serialises a payout span correctly", () => {
  const a = fireActions("0xmachine", "0xcamp", "0xsecret", "0xwon", [
    { noteId: "0x1", token: "0x111", amount: 300n },
    { noteId: "0x2", token: "0x111", amount: 200n },
  ]);
  const cd = a[0]!.calldata as string[];
  // 12 fixed params, then length 2, then two flattened deposits of 3 felts each.
  assert.equal(cd.length, 12 + 1 + 6);
  assert.equal(BigInt(cd[12]!), 2n, "span length precedes the elements");
  assert.equal(BigInt(cd[15]!), 300n);
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
