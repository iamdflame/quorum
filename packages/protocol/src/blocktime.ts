/**
 * Block time, measured rather than assumed.
 *
 * Starknet mainnet produces a block roughly every **1.7 seconds**. We had 30s
 * hardcoded — the figure from an older Starknet, and wrong by a factor of
 * about eighteen. Caught by PugarHuda on starkience/strk20-hackathon#121 and
 * confirmed here over three spans:
 *
 * ```
 *   1,000 blocks  2.028 s/block
 *  20,000 blocks  1.716 s/block
 * 200,000 blocks  1.699 s/block
 * ```
 *
 * The consequence was not cosmetic. A campaign expiry expressed as "seven days"
 * became **2.8 hours** on-chain, and expiry cannot be changed after creation —
 * so every pledge would have refunded long before anyone could reach quorum, in
 * a contract whose entire purpose is to hold a set together long enough to act.
 * The mechanism would have failed silently, in the one direction that looks
 * like nobody wanted to join.
 *
 * A constant that decides when someone's campaign dies should not be a guess, so
 * it is measured from the chain and only falls back to a literal when it cannot be.
 */

/** Measured on mainnet, 2026-08-26, over 200,000 blocks. A fallback, not a truth. */
export const OBSERVED_BLOCK_SECONDS = 1.7;

/** Sample sizes below this are dominated by jitter — the 1,000-block sample read 2.03. */
const MIN_RELIABLE_SPAN = 20_000;

export interface BlockClock {
  readonly secondsPerBlock: number;
  readonly measured: boolean;
  readonly sampleBlocks: number;
}

/** The fallback clock, for offline use and tests. */
export const FALLBACK_CLOCK: BlockClock = {
  secondsPerBlock: OBSERVED_BLOCK_SECONDS,
  measured: false,
  sampleBlocks: 0,
};

/**
 * Measure block time across a span, given a way to read block timestamps.
 *
 * Takes a reader rather than an RPC client so this stays dependency-free and
 * testable: the caller supplies whatever it already uses to talk to a node.
 */
export async function measureBlockTime(
  head: number,
  timestampAt: (block: number) => Promise<number>,
  span: number = 200_000,
): Promise<BlockClock> {
  const from = Math.max(0, head - span);
  const actualSpan = head - from;
  if (actualSpan < MIN_RELIABLE_SPAN) return FALLBACK_CLOCK;
  try {
    const [a, b] = await Promise.all([timestampAt(from), timestampAt(head)]);
    const elapsed = b - a;
    if (elapsed <= 0) return FALLBACK_CLOCK;
    return { secondsPerBlock: elapsed / actualSpan, measured: true, sampleBlocks: actualSpan };
  } catch {
    return FALLBACK_CLOCK;
  }
}

/** Blocks spanning a duration. Rounded up: a deadline should never land early. */
export function blocksFor(seconds: number, clock: BlockClock = FALLBACK_CLOCK): number {
  return Math.ceil(seconds / clock.secondsPerBlock);
}

/** Seconds spanned by a number of blocks. */
export function secondsFor(blocks: number, clock: BlockClock = FALLBACK_CLOCK): number {
  return blocks * clock.secondsPerBlock;
}

export const MINUTE = 60;
export const HOUR = 3600;
export const DAY = 86_400;

/** Blocks in a day at the measured rate — about 50,800, not 2,880. */
export function blocksPerDay(clock: BlockClock = FALLBACK_CLOCK): number {
  return blocksFor(DAY, clock);
}

/** Render a block count as something a human can sanity-check a deadline against. */
export function humanDuration(blocks: number, clock: BlockClock = FALLBACK_CLOCK): string {
  const s = secondsFor(blocks, clock);
  if (s < MINUTE) return `${Math.round(s)} seconds`;
  if (s < HOUR) return `${Math.round(s / MINUTE)} minutes`;
  if (s < 2 * DAY) return `${(s / HOUR).toFixed(1)} hours`;
  return `${(s / DAY).toFixed(1)} days`;
}
