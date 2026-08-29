import { hash, num, shortString } from "starknet";
import { payoutRoot } from "./commit.ts";
import { FALLBACK_CLOCK, humanDuration, blocksFor, DAY, type BlockClock } from "./blocktime.ts";

/**
 * A campaign: what people are pledging to, how many are needed, and by when.
 *
 * ## Why the terms are a hash on-chain
 *
 * The contract stores `poseidon(terms)`, never the text. That is not squeamishness
 * — a campaign's *subject* is often more dangerous than its participant list.
 * "Forty of us will walk out on the 3rd" published on a public chain tells an
 * employer exactly what is coming and exactly when, months before it has the
 * numbers to survive being noticed.
 *
 * So the text travels to participants directly, and the chain holds only a
 * commitment to it. Anyone shown the text can verify it is the text that was
 * committed; nobody else learns anything. When the campaign fires, publishing
 * the terms becomes a choice rather than a condition of using the system.
 */

/** A campaign's terms: the thing participants are actually agreeing to. */
export interface Terms {
  /** One line, shown to every participant before they commit. */
  readonly statement: string;
  /** What firing actually does, in the participants' words. */
  readonly action: string;
  /** Who is organising, if they choose to say. */
  readonly organiser?: string;
  /** Anything else the participants need in order to consent. */
  readonly detail?: string;
}

/**
 * Hash terms into the felt the contract stores.
 *
 * Serialised deterministically — sorted keys, no incidental whitespace — so the
 * same terms always produce the same commitment regardless of how the object was
 * built. A participant verifying a campaign must be able to reproduce this
 * exactly from the text they were shown.
 */
export function hashTerms(terms: Terms): string {
  const canonical = JSON.stringify({
    statement: terms.statement,
    action: terms.action,
    organiser: terms.organiser ?? "",
    detail: terms.detail ?? "",
  });
  // Poseidon over felts; the text is chunked into 31-byte short strings, which
  // is the largest a felt holds.
  const chunks: string[] = [];
  for (let i = 0; i < canonical.length; i += 31) {
    chunks.push(shortString.encodeShortString(canonical.slice(i, i + 31)));
  }
  return hash.computePoseidonHashOnElements(chunks);
}

/** Confirm that a document is the one a campaign committed to. */
export function verifyTerms(terms: Terms, committed: string): boolean {
  return BigInt(hashTerms(terms)) === BigInt(committed);
}

/**
 * Where value may go, decided before anyone pledges.
 *
 * There is no third option on purpose. Letting the destination be chosen at fire
 * time is what turns an information escrow into a pot with a keyholder.
 */
export type Policy =
  /** Value never moves; quorum only opens the set to the people in it. */
  | { readonly kind: "RefundAll" }
  /** Value goes exactly here, fixed before the first pledge. */
  | { readonly kind: "BoundTreasury";
      readonly payouts: readonly { noteId: string; token: string; amount: bigint }[] };

export interface CampaignSpec {
  /** Chosen by the organiser; must be unused. */
  readonly id: string;
  readonly terms: Terms;
  /** ERC-20 pledged and settled in. */
  readonly token: string;
  /** Exact size of every pledge. Identical pledges make the public transfer
   *  uninformative and put a price on a sybil. */
  readonly unit: bigint;
  /** Pledges required before the campaign may fire. */
  readonly threshold: number;
  /** Pledges close, and refunds open, at this block. */
  readonly expiryBlock: number;
  readonly policy: Policy;
}

export interface CampaignCalldata {
  readonly id: string;
  readonly terms: string;
  readonly token: string;
  readonly policy: 0 | 1;          // RefundAll | BoundTreasury
  readonly payoutRoot: string;
  readonly unit: bigint;
  readonly threshold: number;
  readonly expiryBlock: number;
}

export { blocksFor, blocksPerDay, humanDuration, DAY, HOUR, MINUTE } from "./blocktime.ts";

export class CampaignError extends Error {}

/**
 * Validate and prepare a campaign for creation.
 *
 * The checks here are not ceremony. A threshold of one is not coordination, it
 * is a donation with extra steps; an expiry in the past means pledges can never
 * be made and never be refunded; and a threshold nobody could plausibly reach
 * quietly traps money for the full window. Each of these is a way to build
 * something that looks like a quorum and behaves like a trap.
 */
export function prepareCampaign(
  spec: CampaignSpec, currentBlock: number, opts: { clock?: BlockClock } = {},
): CampaignCalldata {
  if (spec.threshold < 2) {
    throw new CampaignError(
      "A threshold below two is not coordination — it fires on the first pledge. " +
      "If that is what you want, send the money directly.",
    );
  }
  if (spec.expiryBlock <= currentBlock) {
    throw new CampaignError(
      `Expiry block ${spec.expiryBlock} is not in the future (current ${currentBlock}). ` +
      "Pledges could never be made, and never refunded.",
    );
  }
  if (spec.terms.statement.trim() === "") {
    throw new CampaignError("A campaign with no statement asks people to commit to nothing.");
  }
  // A window this short is almost always a units mistake rather than an
  // intention, and expiry cannot be changed once the campaign exists. The
  // failure it produces - everyone refunded before anyone could join - is
  // indistinguishable from nobody wanting to join.
  const window = spec.expiryBlock - currentBlock;
  const clock = opts.clock ?? FALLBACK_CLOCK;
  if (window < blocksFor(15 * 60, clock)) {
    throw new CampaignError(
      `The campaign would close in ${humanDuration(window, clock)}. At ` +
      `${clock.secondsPerBlock.toFixed(2)}s per block that is ${window} blocks, which is ` +
      "almost certainly a units mistake — Starknet produces a block roughly every 1.7 " +
      "seconds, not every 30. Expiry cannot be changed once the campaign exists.",
    );
  }
  if (spec.unit <= 0n) {
    throw new CampaignError("Every pledge must be a positive, identical unit.");
  }
  if (spec.policy.kind === "BoundTreasury") {
    if (spec.policy.payouts.length === 0) {
      throw new CampaignError(
        "A treasury campaign must name its destinations before anyone pledges. " +
        "Choosing them at fire time is what makes an organiser a keyholder.",
      );
    }
    const total = spec.policy.payouts.reduce((s, p) => s + p.amount, 0n);
    const expected = spec.unit * BigInt(spec.threshold);
    if (total !== expected) {
      throw new CampaignError(
        `Payouts total ${total} but a quorum escrows exactly ${expected} ` +
        `(${spec.threshold} x ${spec.unit}). The contract requires them equal, so this ` +
        "campaign could reach quorum and then never be fireable.",
      );
    }
  }

  return {
    id: spec.id,
    terms: hashTerms(spec.terms),
    token: spec.token,
    policy: spec.policy.kind === "RefundAll" ? 0 : 1,
    payoutRoot: spec.policy.kind === "BoundTreasury" ? payoutRoot(spec.policy.payouts) : "0x0",
    unit: spec.unit,
    threshold: spec.threshold,
    expiryBlock: spec.expiryBlock,
  };
}

/**
 * How long a campaign has left.
 *
 * Takes a clock rather than assuming one. The whole reason this function exists
 * is so an organiser can sanity-check a deadline before committing to it, and a
 * function that lies about the units is worse than no function.
 */
export function timeRemaining(
  expiryBlock: number, currentBlock: number, clock: BlockClock = FALLBACK_CLOCK,
): { blocks: number; expired: boolean; human: string } {
  const blocks = expiryBlock - currentBlock;
  if (blocks <= 0) return { blocks: 0, expired: true, human: "closed" };
  return { blocks, expired: false, human: humanDuration(blocks, clock) };
}

export { num };
