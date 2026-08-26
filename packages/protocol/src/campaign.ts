import { hash, num, shortString } from "starknet";
import { fireCommitment } from "./commit.ts";

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

export interface CampaignSpec {
  /** Chosen by the organiser; must be unused. */
  readonly id: string;
  readonly terms: Terms;
  /** ERC-20 pledged and settled in. */
  readonly token: string;
  /** Pledges required before the campaign may fire. */
  readonly threshold: number;
  /** Pledges close, and refunds open, at this block. */
  readonly expiryBlock: number;
  /** Secret that will be needed to fire. Never leaves the organiser. */
  readonly fireSecret: string;
}

export interface CampaignCalldata {
  readonly id: string;
  readonly terms: string;
  readonly token: string;
  readonly threshold: number;
  readonly expiryBlock: number;
  readonly fireCommitment: string;
}

/** Blocks per day at ~30s, for expressing deadlines in human units. */
export const BLOCKS_PER_DAY = 2880;

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
export function prepareCampaign(spec: CampaignSpec, currentBlock: number): CampaignCalldata {
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
  return {
    id: spec.id,
    terms: hashTerms(spec.terms),
    token: spec.token,
    threshold: spec.threshold,
    expiryBlock: spec.expiryBlock,
    fireCommitment: fireCommitment(spec.fireSecret),
  };
}

/** How long a campaign has left, in blocks and in plain language. */
export function timeRemaining(expiryBlock: number, currentBlock: number): {
  blocks: number; expired: boolean; human: string;
} {
  const blocks = expiryBlock - currentBlock;
  if (blocks <= 0) return { blocks: 0, expired: true, human: "closed" };
  const hours = (blocks * 30) / 3600;
  const human = hours < 1 ? `${Math.round(hours * 60)} minutes`
    : hours < 48 ? `${hours.toFixed(1)} hours`
    : `${Math.round(hours / 24)} days`;
  return { blocks, expired: false, human };
}

export { num };
