import {
  anonymitySets, cellKey, DEFAULT_WINDOW_BLOCKS,
  type PoolObservation, type Address, type BlockNumber, type AnonymitySet,
} from "@shoal/oracle";

/**
 * THE ROUTER.
 *
 * Measuring the crowd is diagnosis. Routing is treatment.
 *
 * Given an intent — move this much of this asset — the router chooses *how* to
 * express it: which denominations to split it into, and which time windows to
 * place those legs in, such that every leg lands in a crowd that already exists.
 *
 * Two principles govern the search, and both are conjunctive:
 *
 *   1. You are as anonymous as your most identifying action. A plan's crowd is
 *      the MINIMUM across its legs, never the average. One leg in an empty cell
 *      undoes six good ones, because the observer only needs the one.
 *
 *   2. Every additional leg is another observation to correlate. Splitting into
 *      common denominations buys crowd; splitting endlessly sells it back. The
 *      router prices that trade rather than assuming more legs are better.
 *
 * The flywheel lives here: routed flow converges on shared denominations and
 * windows, so those cells grow, so routing gets better, so more flow routes.
 * The product improves by being used — and it improves for everyone in the cell,
 * not just the person who routed. That is the only kind of privacy improvement
 * that is real.
 */

export interface RouteLeg {
  readonly amount: bigint;
  /** Window index the leg should land in. */
  readonly window: number;
  /** First block of that window — the earliest the leg may be submitted. */
  readonly earliestBlock: BlockNumber;
  /** The crowd this leg lands in. */
  readonly effectiveSet: number;
  /** True when no existing cell matched and the leg would act alone. */
  readonly exposed: boolean;
}

export interface RoutePlan {
  readonly token: Address;
  readonly total: bigint;
  readonly legs: readonly RouteLeg[];
  /** The plan's crowd: the minimum across legs. */
  readonly effectiveSet: number;
  /** The crowd the naive one-shot action would have landed in. */
  readonly baseline: number;
  /** effectiveSet / baseline. The number the product is sold on. */
  readonly improvement: number;
  /** Honest account of what the plan could not fix. */
  readonly warnings: readonly string[];
}

/** Beyond this many legs, correlation risk outweighs crowd gained. */
export const MAX_LEGS = 6;

/** Windows to look ahead when placing legs. */
export const HORIZON_WINDOWS = 8;

/** A denomination must serve this many operators to be worth routing into. */
const MIN_USEFUL_SET = 2;

interface Denomination {
  readonly amount: bigint;
  readonly effectiveSet: number;
}

/**
 * The denominations worth using for a token: actual amounts the pool has seen,
 * ranked by the crowd they carry. Routing into an amount nobody else uses is
 * how you end up alone, so the menu is derived from observed behaviour rather
 * than from round numbers a human would pick.
 */
export function denominations(obs: PoolObservation, token: Address): Denomination[] {
  const byAmount = new Map<bigint, Set<string>>();
  for (const e of obs.edges) {
    if (e.token !== token) continue;
    const ops = byAmount.get(e.amount) ?? new Set<string>();
    ops.add(e.operator !== undefined ? e.operator.toString(16) : `edge:${e.block}`);
    byAmount.set(e.amount, ops);
  }
  return [...byAmount.entries()]
    .map(([amount, ops]) => ({ amount, effectiveSet: ops.size }))
    .filter((d) => d.effectiveSet >= MIN_USEFUL_SET && d.amount > 0n)
    .sort((a, b) => (b.amount > a.amount ? 1 : b.amount < a.amount ? -1 : 0));
}

/**
 * Decompose `total` into observed denominations, largest first.
 *
 * This is coin-change with the objective inverted: ordinary change-making
 * minimises the number of coins, while we are trying to maximise the crowd each
 * coin lands in, subject to a cap on how many observations we are willing to
 * create. Any remainder that no denomination covers is reported rather than
 * quietly folded into a leg — a remainder is exactly the distinctive amount the
 * whole exercise exists to avoid.
 */
export function decompose(total: bigint, menu: readonly Denomination[], maxLegs = MAX_LEGS): {
  legs: Denomination[];
  remainder: bigint;
} {
  const legs: Denomination[] = [];
  let left = total;
  for (const d of menu) {
    while (left >= d.amount && legs.length < maxLegs) {
      legs.push(d);
      left -= d.amount;
    }
    if (legs.length >= maxLegs) break;
  }
  return { legs, remainder: left };
}

/** Windows ahead of `from`, ranked by the crowd already present in them. */
function rankWindows(
  sets: Map<string, AnonymitySet>, token: Address, from: BlockNumber, windowBlocks: number,
): { window: number; set: number }[] {
  const current = Math.floor(from / windowBlocks);
  const density = new Map<number, number>();
  for (const s of sets.values()) {
    if (s.cell.token !== token) continue;
    density.set(s.cell.window, Math.max(density.get(s.cell.window) ?? 0, s.effective));
  }
  // Historical density is the best available predictor of future density: a
  // window that has been busy at this position in the cycle tends to be busy again.
  const out: { window: number; set: number }[] = [];
  for (let i = 1; i <= HORIZON_WINDOWS; i++) {
    const w = current + i;
    const historical = [...density.entries()]
      .filter(([hw]) => hw % HORIZON_WINDOWS === w % HORIZON_WINDOWS)
      .map(([, v]) => v);
    out.push({ window: w, set: historical.length ? Math.max(...historical) : 1 });
  }
  return out.sort((a, b) => b.set - a.set);
}

export function route(
  obs: PoolObservation,
  token: Address,
  total: bigint,
  windowBlocks: number = DEFAULT_WINDOW_BLOCKS,
): RoutePlan {
  const sets = anonymitySets(obs, windowBlocks);
  const warnings: string[] = [];

  // Baseline: move the whole amount now, as-is. What most wallets do.
  const nowWindow = Math.floor(obs.head / windowBlocks);
  const baselineCell = [...sets.values()].find(
    (s) => s.cell.token === token && s.cell.window === nowWindow,
  );
  const baseline = baselineCell?.effective ?? 1;

  const menu = denominations(obs, token);
  if (menu.length === 0) {
    warnings.push(
      "No denomination of this asset has been used by more than one operator. " +
      "There is no crowd to route into; the asset itself is the identifier.",
    );
    return {
      token, total, legs: [], effectiveSet: 1, baseline, improvement: 1, warnings,
    };
  }

  const { legs: chosen, remainder } = decompose(total, menu);
  if (remainder > 0n) {
    warnings.push(
      `${remainder} could not be expressed in any denomination the pool actually uses. ` +
      `Moving it will create a distinctive amount; consider adjusting the total, or ` +
      `holding the remainder until a matching denomination becomes common.`,
    );
  }

  // Spread legs across the busiest distinct windows available. Reusing one
  // window would cluster the legs back into a single observation, which is the
  // pattern splitting was meant to break.
  const windows = rankWindows(sets, token, obs.head, windowBlocks);
  const placed: RouteLeg[] = chosen.map((d, i) => {
    const w = windows[i % windows.length]!;
    return {
      amount: d.amount,
      window: w.window,
      earliestBlock: w.window * windowBlocks,
      // The leg's crowd is bounded by both the denomination's crowd and the
      // window's: being one of fifty at that size means nothing in an empty hour.
      effectiveSet: Math.min(d.effectiveSet, Math.max(w.set, 1)),
      exposed: d.effectiveSet < MIN_USEFUL_SET || w.set < MIN_USEFUL_SET,
    };
  });

  if (placed.length > windows.length) {
    warnings.push(
      `${placed.length} legs share ${windows.length} windows; some will co-occur and ` +
      `can be correlated with each other.`,
    );
  }

  // Conjunctive: the plan is only as good as its worst leg.
  const effectiveSet = placed.length === 0 ? 1 : Math.min(...placed.map((l) => l.effectiveSet));

  return {
    token,
    total,
    legs: placed,
    effectiveSet,
    baseline,
    improvement: baseline > 0 ? effectiveSet / baseline : 1,
    warnings,
  };
}
