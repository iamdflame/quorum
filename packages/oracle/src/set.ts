import type { PoolObservation, Address, BlockNumber } from "./types.ts";
import { denominationBucket } from "./metrics/denomination.ts";
import { entropyBits } from "./stats.ts";

/**
 * THE EFFECTIVE ANONYMITY SET.
 *
 * Privacy is not encryption. Privacy is the number of people you could have
 * been. A pool with ten thousand users protects you exactly as much as the
 * subset of them who look like you at the moment you act — and no more.
 *
 * The subset is much smaller than the pool, because an anonymity set fragments
 * along three axes at once, none of which are visible to the person relying on
 * it:
 *
 *   asset        STRK20 groups notes into per-token subchannels. Shield an
 *                unusual token and your crowd is whoever else shielded that
 *                token — not whoever else uses the pool.
 *   denomination Public edges carry plaintext amounts. Your crowd is whoever
 *                else moved roughly that much.
 *   time         Your crowd is whoever else was moving in the same window.
 *
 * Intersect the three and a pool with ten thousand users routinely offers an
 * effective set of three. That is the number this module computes, and to our
 * knowledge nobody publishes it.
 *
 * ## Why a count is the wrong measure
 *
 * Counting distinct operators in a cell overstates protection whenever the cell
 * is dominated by one of them. A hundred operators where one accounts for 99%
 * of the flow is not a crowd of a hundred; an observer guessing "the big one"
 * is right almost always. The honest measure is the *effective number* —
 * perplexity, `2^H` over the operator distribution — which equals the count
 * when flow is even and collapses toward one as it concentrates.
 *
 * That is the quantity Shoal routes to maximise.
 */

/** One cell of the fragmented set: an asset, a size, and a moment. */
export interface SetCell {
  readonly token: Address;
  readonly denomination: string;
  readonly window: number;
}

export interface AnonymitySet {
  readonly cell: SetCell;
  /** Distinct operators observed in this cell. The flattering number. */
  readonly participants: number;
  /** Shannon entropy of the flow distribution across those operators, in bits. */
  readonly entropyBits: number;
  /**
   * `2^H` — the crowd you are actually hiding in. Never exceeds `participants`,
   * and equals it only when every participant contributes evenly.
   */
  readonly effective: number;
  /** Observations backing this cell. Low counts mean the estimate is thin. */
  readonly observations: number;
}

/** Width of a timing window, in blocks. Roughly six hours at 30s blocks. */
export const DEFAULT_WINDOW_BLOCKS = 720;

export function cellKey(c: SetCell): string {
  return `${c.token.toString(16)}:${c.denomination}:${c.window}`;
}

/**
 * Build the effective anonymity set for every cell the pool has been observed in.
 *
 * Operator identity comes from the public edges — deposits and withdrawals expose
 * an address by design. That is precisely why the measurement is possible from
 * outside, and precisely why it matters: the observer computing this is the
 * adversary, and Shoal computes it first.
 */
export function anonymitySets(
  obs: PoolObservation,
  windowBlocks: number = DEFAULT_WINDOW_BLOCKS,
): Map<string, AnonymitySet> {
  // cell -> operator -> flow contributed
  const cells = new Map<string, { cell: SetCell; flow: Map<string, number> }>();

  for (const e of obs.edges) {
    const cell: SetCell = {
      token: e.token,
      denomination: denominationBucket(e.amount),
      window: Math.floor(e.block / windowBlocks),
    };
    const key = cellKey(cell);
    let entry = cells.get(key);
    if (!entry) {
      entry = { cell, flow: new Map() };
      cells.set(key, entry);
    }
    // Attribute flow to the address behind the edge so repeated activity by one
    // operator concentrates rather than inflating the apparent crowd. Falling
    // back to a per-edge identity understates concentration, which errs toward
    // reporting a *smaller* effective set than reality — the safe direction.
    const operator = e.own
      ? "self"
      : e.operator !== undefined
        ? `addr:${e.operator.toString(16)}`
        : `edge:${e.block}:${e.amount}`;
    entry.flow.set(operator, (entry.flow.get(operator) ?? 0) + Number(e.amount));
  }

  const out = new Map<string, AnonymitySet>();
  for (const [key, { cell, flow }] of cells) {
    const counts = [...flow.values()];
    const h = entropyBits(counts);
    out.set(key, {
      cell,
      participants: flow.size,
      entropyBits: h,
      // 2^H, floored at 1: you are always at least yourself.
      effective: Math.max(1, 2 ** h),
      observations: counts.length,
    });
  }
  return out;
}

/**
 * The effective set an operator would land in by acting with `amount` of `token`
 * at `block`. This is the forward-looking question — what crowd am I about to
 * join — as opposed to `anonymitySets`, which describes crowds that already exist.
 */
export function projectedSet(
  obs: PoolObservation,
  token: Address,
  amount: bigint,
  block: BlockNumber,
  windowBlocks: number = DEFAULT_WINDOW_BLOCKS,
): AnonymitySet {
  const cell: SetCell = {
    token,
    denomination: denominationBucket(amount),
    window: Math.floor(block / windowBlocks),
  };
  const existing = anonymitySets(obs, windowBlocks).get(cellKey(cell));
  if (!existing) {
    // An empty cell is the worst possible outcome and the easiest to walk into:
    // acting alone in a fresh cell means an effective set of exactly one.
    return { cell, participants: 0, entropyBits: 0, effective: 1, observations: 0 };
  }
  return existing;
}
