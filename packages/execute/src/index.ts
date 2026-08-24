import type { RoutePlan, RouteLeg } from "@shoal/router";
import { NOTE_MATURITY_BLOCKS, PROVING_LAG_BLOCKS, type BlockNumber } from "@shoal/oracle";

/**
 * THE SCHEDULER.
 *
 * A route plan says which crowds to join. It does not say when a proof may be
 * generated, when it dies, or what the crowd costs. Those come from the pool,
 * and they are what make a plan executable rather than aspirational.
 *
 * Three live constants govern every leg, read from the mainnet pool rather than
 * assumed:
 *
 *   proof_validity_blocks = 450   a proof is anchored to a recent block and the
 *                                 contract rejects it once the anchor falls more
 *                                 than this far behind the tip
 *   fee_amount = 6 STRK           charged per pool transaction, not per leg
 *   note maturity = 10 blocks     a note is spendable only 10 blocks after it
 *                                 was created
 *
 * The first has a consequence people miss: **you cannot pre-prove a leg that is
 * scheduled hours out.** Proving is not a step you do once at planning time and
 * replay later — each leg has a window, opening when its proof would still be
 * alive at submission and closing when the leg's window closes. A scheduler that
 * ignores this produces a plan whose later legs are all dead on arrival.
 *
 * The second sets a price on privacy. Fees are charged per transaction, so
 * splitting into six legs costs six times the fee. That is the real tension in
 * this system, and it runs in both directions at once:
 *
 *   fees push toward batching     one transaction, one fee, one observation
 *   anonymity pushes toward spreading
 *
 * Shoal refuses to hide that tradeoff behind a single number. A schedule reports
 * what the crowd cost, so the choice belongs to the person paying for it.
 */

/** Live values from the mainnet pool at block 13,770,138. */
export const MAINNET_CONSTANTS: ProtocolConstants = {
  proofValidityBlocks: 450,
  feeAmount: 6_000_000_000_000_000_000n,
  feeToken: "STRK",
  noteMaturityBlocks: NOTE_MATURITY_BLOCKS,
  provingLagBlocks: PROVING_LAG_BLOCKS,
};

export interface ProtocolConstants {
  readonly proofValidityBlocks: number;
  readonly feeAmount: bigint;
  readonly feeToken: string;
  readonly noteMaturityBlocks: number;
  readonly provingLagBlocks: number;
}

export interface ScheduledLeg extends RouteLeg {
  /**
   * The block this leg actually aims to land in — a decorrelated point inside
   * its window rather than the window's first block. Every leg submitting on a
   * window boundary would itself be a pattern, and a boundary gives a proof
   * nowhere to breathe.
   */
  readonly submitAt: BlockNumber;
  /** Earliest block at which proving may start and still be alive at `submitAt`. */
  readonly proveAfter: BlockNumber;
  /** The block by which the proof must be on chain, or it is rejected. */
  readonly expiresAt: BlockNumber;
  /** Blocks of headroom between the intended submission and proof expiry. */
  readonly slack: number;
}

export interface Schedule {
  readonly legs: readonly ScheduledLeg[];
  /** Total pool fees, charged per transaction. */
  readonly feeTotal: bigint;
  /** Crowd bought per unit of fee — the honest efficiency of the plan. */
  readonly crowdPerFee: number;
  /** The plan's crowd, carried through from the route. */
  readonly effectiveSet: number;
  /** What a single unsplit transaction would have cost and bought. */
  readonly baseline: { fee: bigint; crowd: number };
  readonly warnings: readonly string[];
}

/**
 * Convert a route plan into a schedule of provable, submittable legs.
 *
 * `now` is the current chain head. Legs already inside their proving window are
 * marked ready; the rest carry the block at which proving may begin.
 */
/**
 * Blocks of headroom demanded between intended submission and proof expiry.
 *
 * Proving is documented at roughly 29 seconds, and submission then has to be
 * built, signed, relayed and included. Fifteen minutes of margin turns a plan
 * that is correct on paper into one that survives a slow prover or a congested
 * block.
 */
export const DEFAULT_MARGIN_BLOCKS = 30;

/** Width of a routing window, in blocks — legs are placed inside one. */
export const WINDOW_BLOCKS = 720;

export function schedule(
  plan: RoutePlan,
  now: BlockNumber,
  constants: ProtocolConstants = MAINNET_CONSTANTS,
  opts: { marginBlocks?: number; windowBlocks?: number } = {},
): Schedule {
  const margin = opts.marginBlocks ?? DEFAULT_MARGIN_BLOCKS;
  const windowBlocks = opts.windowBlocks ?? WINDOW_BLOCKS;
  const warnings: string[] = [...plan.warnings];
  const legs: ScheduledLeg[] = [];

  plan.legs.forEach((leg, i) => {
    // Aim for a deterministic but irregular point inside the window rather than
    // its first block. A proof cannot cover a whole 720-block window anyway —
    // validity is 450 — so the leg commits to a submission point and the
    // proving window is built around that.
    const offset = windowBlocks * (0.25 + ((i * 37) % 50) / 100);
    const submitAt = Math.round(leg.earliestBlock + offset);

    // The proof anchors at `head - provingLag` and dies `proofValidityBlocks`
    // after its anchor, so proving this early leaves exactly `margin` blocks of
    // headroom at the intended submission.
    const proveAfter = Math.max(
      now,
      submitAt - constants.proofValidityBlocks + constants.provingLagBlocks + margin,
    );
    const expiresAt = proveAfter - constants.provingLagBlocks + constants.proofValidityBlocks;
    const slack = expiresAt - submitAt;

    if (slack < margin) {
      warnings.push(
        `A leg aiming at block ${submitAt} has only ${slack} blocks of proof headroom, ` +
        `under the ${margin} required. Proving is not instant and inclusion is not ` +
        `guaranteed; move the leg later or shorten the wait.`,
      );
    }
    legs.push({ ...leg, submitAt, proveAfter, expiresAt, slack });
  });

  // Fees are per transaction. Legs deliberately land in separate windows, so
  // each one is its own transaction and its own fee.
  const feeTotal = constants.feeAmount * BigInt(legs.length);
  const baselineFee = legs.length === 0 ? 0n : constants.feeAmount;

  if (legs.length > 1) {
    const extra = feeTotal - baselineFee;
    warnings.push(
      `Splitting into ${legs.length} legs costs ${format(extra, constants.feeToken)} more in ` +
      `pool fees than moving once. Batching would be cheaper and would put every leg in ` +
      `one observation, which is what the split exists to prevent.`,
    );
  }

  const feeUnits = Number(feeTotal) / 1e18;
  return {
    legs,
    feeTotal,
    crowdPerFee: feeUnits > 0 ? plan.effectiveSet / feeUnits : 0,
    effectiveSet: plan.effectiveSet,
    baseline: { fee: baselineFee, crowd: plan.baseline },
    warnings,
  };
}

function format(amount: bigint, symbol: string): string {
  const whole = amount / 1_000_000_000_000_000_000n;
  const frac = (amount % 1_000_000_000_000_000_000n) / 1_000_000_000_000_000n;
  return `${whole}.${frac.toString().padStart(3, "0")} ${symbol}`;
}

/**
 * The STRK20 SDK operation a leg becomes.
 *
 * Emitted rather than executed so a plan can be reviewed, tested and diffed
 * without keys, funds, or a chain — and so what Shoal intends to sign is legible
 * before anything is signed. A privacy tool that will not show you its
 * transactions before it makes them is asking for trust it has not earned.
 */
export interface SdkOperation {
  readonly kind: "shield" | "transfer" | "consolidate";
  readonly token: string;
  readonly amount: bigint;
  readonly proveAfter: BlockNumber;
  readonly submitBy: BlockNumber;
  /** `provingBlockId` for this leg: always `head - 10` at proving time. */
  readonly provingLag: number;
  /** `autoSelectNotes` mode the SDK should use. */
  readonly autoSelectNotes: "naive" | "all";
  /** Human-readable form of the exact SDK call. */
  readonly call: string;
}

/**
 * Render a schedule as concrete SDK operations.
 *
 * `consolidate` uses `autoSelectNotes: "all"`, which the SDK documents as
 * consuming every note and producing surplus — the one mode that actually
 * collapses a fragmented set back into a single note.
 */
export function toOperations(
  sched: Schedule,
  token: string,
  recipient: string,
  opts: { consolidateFirst?: boolean } = {},
): SdkOperation[] {
  const ops: SdkOperation[] = [];

  if (opts.consolidateFirst && sched.legs.length > 0) {
    const first = sched.legs[0]!;
    ops.push({
      kind: "consolidate",
      token,
      amount: 0n,
      proveAfter: first.proveAfter,
      submitBy: first.expiresAt,
      provingLag: PROVING_LAG_BLOCKS,
      autoSelectNotes: "all",
      call:
        `transfers.build({ autoSelectNotes: "all", autoDiscover: { notes: "refresh" } })\n` +
        `  .surplusTo(account.address)\n` +
        `  .execute({ provingBlockId: head - ${PROVING_LAG_BLOCKS} })`,
    });
  }

  for (const leg of sched.legs) {
    ops.push({
      kind: "transfer",
      token,
      amount: leg.amount,
      proveAfter: leg.proveAfter,
      submitBy: leg.expiresAt,
      provingLag: PROVING_LAG_BLOCKS,
      autoSelectNotes: "naive",
      call:
        `transfers.build({ autoSelectNotes: "naive", autoDiscover: { notes: "missing" } })\n` +
        `  .surplusTo(account.address)\n` +
        `  .with("${token}", (t) => t.transfer({ recipient: "${recipient}", amount: ${leg.amount}n }))\n` +
        `  .execute({ provingBlockId: head - ${PROVING_LAG_BLOCKS} })   // window ${leg.window}`,
    });
  }
  return ops;
}
