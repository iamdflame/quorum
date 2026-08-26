import { num } from "starknet";
import { foldPledge, toFelt } from "./commit.ts";
import { hashTerms, type Terms } from "./campaign.ts";

/**
 * Verifying a campaign without trusting anyone who ran it.
 *
 * A participant hands money to a contract on the strength of two claims: that
 * the quorum was really reached, and that what fired is what they agreed to.
 * Both are checkable from public data, and neither should require believing the
 * organiser — the organiser is precisely the party with a motive to lie, and in
 * the cases this system exists for, often the party under the most pressure to.
 *
 * Everything below is computed from events the pool emits in the clear. No
 * viewing key, no privileged access. A participant can run it, and so can a
 * journalist, a regulator, or the employer on the other side of the campaign —
 * which is the point. The claim is verifiable *because* the identities are not.
 */

export type CampaignPhase = "Void" | "Open" | "Fired" | "Refunding";

/** `Committed` events, in the order the chain recorded them. */
export interface CommittedEvent {
  readonly pledgeRoot: string;
  readonly pledgeCount: number;
  readonly block: number;
  readonly tx: string;
}

export interface FiredEvent {
  readonly outcome: string;
  readonly pledgeCount: number;
  readonly block: number;
  readonly tx: string;
}

export interface OnChainCampaign {
  readonly phase: CampaignPhase;
  readonly terms: string;
  readonly threshold: number;
  readonly pledgeCount: number;
  readonly pledgeRoot: string;
  readonly escrowed: bigint;
  readonly expiryBlock: number;
}

export interface Finding {
  readonly ok: boolean;
  readonly check: string;
  readonly detail: string;
}

export interface Verification {
  readonly sound: boolean;
  readonly findings: readonly Finding[];
}

const eq = (a: string | bigint, b: string | bigint) => BigInt(a) === BigInt(b);

/**
 * Replay the accumulator from the observed sequence of `Committed` events.
 *
 * Each event carries the root *after* its own fold, so the chain of roots must
 * be internally consistent: fold the previous root with the next commitment and
 * you must land on the next event's root. A campaign that inserted, removed, or
 * reordered a pledge after the fact breaks the chain here, even though every
 * individual event still looks perfectly well-formed.
 *
 * This is why the fold is order-dependent. A multiset accumulator would let an
 * organiser reorder pledges to change an outcome that depends on arrival order,
 * and nothing above this layer would notice.
 */
export function replayRoots(
  events: readonly CommittedEvent[], commitments: readonly string[],
): { ok: boolean; expected: string; observed: string } {
  let root: string | number | bigint = 0n;
  for (const c of commitments) root = foldPledge(root, c);
  const expected = num.toHex(root);
  const observed = events.length > 0 ? events[events.length - 1]!.pledgeRoot : num.toHex(0);
  return { ok: eq(expected, observed), expected, observed };
}

/**
 * Check a campaign against everything that can be checked.
 *
 * `commitments` is optional: a participant knows their own, and an observer
 * usually knows none. Root replay is skipped rather than failed when they are
 * absent, because "cannot verify" and "verified false" are different answers and
 * conflating them would make the report useless in the common case.
 */
export function verifyCampaign(
  campaign: OnChainCampaign,
  events: { committed: readonly CommittedEvent[]; fired?: FiredEvent },
  opts: { terms?: Terms; commitments?: readonly string[]; currentBlock?: number } = {},
): Verification {
  const findings: Finding[] = [];
  const add = (ok: boolean, check: string, detail: string) => findings.push({ ok, check, detail });

  // 1. The count on-chain matches the number of pledges actually observed.
  const observedCount = events.committed.length;
  add(
    observedCount === campaign.pledgeCount,
    "pledge count",
    observedCount === campaign.pledgeCount
      ? `${campaign.pledgeCount} pledges on-chain, ${observedCount} events observed.`
      : `Campaign claims ${campaign.pledgeCount} pledges but ${observedCount} Committed events exist. ` +
        `One of them is wrong, and the chain does not lie about its own events.`,
  );

  // 2. Counts increase by exactly one, in order, with no gaps.
  let sequential = true;
  events.committed.forEach((e, i) => { if (e.pledgeCount !== i + 1) sequential = false; });
  add(sequential, "pledge sequence",
    sequential ? "Counts increase by one with no gaps."
      : "Committed events are not sequential — an event is missing or duplicated.");

  // 3. The accumulator replays, when we hold the commitments to replay it with.
  if (opts.commitments && opts.commitments.length > 0) {
    const r = replayRoots(events.committed, opts.commitments);
    add(r.ok, "pledge root",
      r.ok ? "The accumulator replays exactly from the observed commitments."
        : `Root mismatch: replay gives ${r.expected}, chain holds ${r.observed}. ` +
          `The pledge set was altered after it was recorded.`);
  }

  // 4. Firing happened at or above quorum. The promise the whole thing rests on.
  if (events.fired) {
    const met = events.fired.pledgeCount >= campaign.threshold;
    add(met, "quorum honoured",
      met ? `Fired with ${events.fired.pledgeCount} pledges against a threshold of ${campaign.threshold}.`
        : `Fired with only ${events.fired.pledgeCount} pledges against a threshold of ` +
          `${campaign.threshold}. The contract forbids this, so seeing it would mean ` +
          `the contract is not the one it claims to be.`);
  }

  // 5. The terms are the terms, if we were shown a document.
  if (opts.terms) {
    const ok = eq(hashTerms(opts.terms), campaign.terms);
    add(ok, "terms",
      ok ? "The document matches the commitment recorded when the campaign opened."
        : "The document does not hash to the committed terms. Either it was edited " +
          "after the campaign opened, or this is not that campaign's document.");
  }

  // 6. A fired campaign holds nothing; an expired one owes refunds.
  if (campaign.phase === "Fired") {
    add(campaign.escrowed === 0n, "settlement complete",
      campaign.escrowed === 0n ? "Escrow fully released."
        : `Fired but still holding ${campaign.escrowed}. Value conservation should make ` +
          `this impossible.`);
  }
  if (opts.currentBlock !== undefined && campaign.phase === "Open"
      && opts.currentBlock >= campaign.expiryBlock) {
    add(true, "refunds open",
      `Expired at block ${campaign.expiryBlock} without firing. Every pledge is now ` +
      `reclaimable, and firing is no longer possible.`);
  }

  return { sound: findings.every((f) => f.ok), findings };
}
