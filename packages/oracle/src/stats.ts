/** Small numeric helpers. Kept dependency-free so the scorer runs anywhere. */

/** Clamp to the 0..100 range every metric reports in. */
export const clamp100 = (n: number): number => Math.max(0, Math.min(100, n));

/**
 * Map an unbounded non-negative quantity onto 0..100 with a soft knee.
 * `midpoint` is the value that scores 50. Monotonic, saturating, no cliffs —
 * so a score never jumps discontinuously as one note is added or spent.
 */
export function saturate(value: number, midpoint: number): number {
  if (value <= 0) return 0;
  return clamp100(100 * (value / (value + midpoint)));
}

export function median(xs: readonly number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

export function mean(xs: readonly number[]): number {
  return xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length;
}

export function stdev(xs: readonly number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1));
}

/**
 * Gini coefficient of a non-negative distribution: 0 = perfectly even,
 * 1 = all mass in one element. Used to detect a note set that is one whale
 * note plus dust, which spends far worse than an even set of the same total.
 */
export function gini(xs: readonly number[]): number {
  const v = xs.filter((x) => x >= 0).sort((a, b) => a - b);
  const n = v.length;
  if (n === 0) return 0;
  const total = v.reduce((a, b) => a + b, 0);
  if (total === 0) return 0;
  let weighted = 0;
  for (let i = 0; i < n; i++) weighted += (i + 1) * v[i]!;
  return (2 * weighted) / (n * total) - (n + 1) / n;
}

/**
 * Shannon entropy in bits of an empirical distribution given raw counts.
 * The anonymity-set metrics are all entropy arguments underneath: an observer's
 * residual uncertainty about which operator produced an artifact.
 */
export function entropyBits(counts: readonly number[]): number {
  const total = counts.reduce((a, b) => a + b, 0);
  if (total <= 0) return 0;
  let h = 0;
  for (const c of counts) {
    if (c <= 0) continue;
    const p = c / total;
    h -= p * Math.log2(p);
  }
  return h;
}

/**
 * Self-information of an observation, in bits: how surprising this value is
 * against a population histogram. High surprise = distinctive = identifying.
 * Laplace-smoothed so an amount never seen before yields a large but finite
 * score rather than Infinity.
 */
export function surprisalBits(count: number, total: number, support: number): number {
  const p = (count + 1) / (total + Math.max(support, 1));
  return -Math.log2(p);
}

/** Count trailing zero digits in a base-10 integer — a proxy for "round number". */
export function trailingZeros(value: bigint): number {
  if (value === 0n) return 0;
  let n = 0;
  let v = value;
  while (v % 10n === 0n) {
    v /= 10n;
    n++;
  }
  return n;
}

/** Total significant digits, so roundness can be judged relative to magnitude. */
export function digitCount(value: bigint): number {
  const v = value < 0n ? -value : value;
  return v === 0n ? 1 : v.toString().length;
}
