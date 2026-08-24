import type { MetricResult, Finding, PoolObservation } from "../types.ts";
import { clamp100, digitCount, surprisalBits, trailingZeros } from "../stats.ts";

/**
 * DENOMINATION — "recognizable amounts", from the value side.
 *
 * The docs are explicit that deposits and withdrawals are plaintext ERC-20 legs:
 * "Edges are public by design." An observer therefore holds two public lists —
 * amounts going in, amounts coming out — and the pool's privacy rests on those
 * lists being hard to match up.
 *
 * Matching is easy when an amount is rare. If exactly one deposit of
 * 137.4429 USDC ever entered the pool and exactly one withdrawal of a suspiciously
 * similar size later left it, the shielded hop between them protected nothing.
 * Roundness is the same failure from the other direction: a clean 50 000.000000
 * is memorable, and memorable amounts survive in an analyst's notes.
 *
 * Chaff quantifies both against the pool's own empirical histogram rather than
 * against intuition, so the score reflects the anonymity set that actually
 * exists today — which is the only one that protects anyone.
 */

/** Amounts within this relative distance are treated as the same denomination. */
const BUCKET_RELATIVE_WIDTH = 0.01;

/** A surprisal this high (bits) scores as fully distinctive. */
const SURPRISAL_CEILING_BITS = 12;

/**
 * Bucket an amount logarithmically so "about the same size" collapses together.
 * Matching by exact equality would overstate privacy: an analyst correlating
 * 1000.0 in with 999.7 out does not care about the difference.
 */
export function denominationBucket(amount: bigint): string {
  if (amount <= 0n) return "0";
  const magnitude = Math.log10(Number(amount));
  return (Math.round(magnitude / BUCKET_RELATIVE_WIDTH) * BUCKET_RELATIVE_WIDTH).toFixed(4);
}

/**
 * Roundness in 0..1. A number is round when it carries many trailing zeros
 * relative to its length: 50000 (4 of 5) is round, 51379 (0 of 5) is not.
 */
export function roundness(amount: bigint): number {
  const digits = digitCount(amount);
  if (digits <= 1) return 0;
  return trailingZeros(amount) / (digits - 1);
}

export function denomination(obs: PoolObservation): MetricResult {
  const findings: Finding[] = [];

  // The population an observer compares against: every public edge of the pool
  // that is not ours. This is the real anonymity set for amount-matching.
  const population = new Map<string, number>();
  let populationTotal = 0;
  for (const e of obs.edges) {
    if (e.own) continue;
    const b = denominationBucket(e.amount);
    population.set(b, (population.get(b) ?? 0) + 1);
    populationTotal++;
  }

  const ownEdges = obs.edges.filter((e) => e.own);
  // Open notes carry plaintext amounts on-chain, so they are exposed exactly
  // like a public edge even though they sit inside the pool.
  const ownOpen = obs.notes.filter((n) => n.open);

  const subjects: { amount: bigint; label: string; block: number }[] = [
    ...ownEdges.map((e) => ({ amount: e.amount, label: e.kind, block: e.block })),
    ...ownOpen.map((n) => ({ amount: n.amount, label: "open note", block: n.created })),
  ];

  if (subjects.length === 0) {
    return {
      id: "denomination",
      label: "Amount distinctiveness",
      score: 0,
      weight: 0.3,
      limitation: "distinctive-patterns",
      findings,
    };
  }

  let worst = 0;
  for (const s of subjects) {
    const bucket = denominationBucket(s.amount);
    const seen = population.get(bucket) ?? 0;
    const bits = surprisalBits(seen, populationTotal, population.size);
    const rarityScore = clamp100((bits / SURPRISAL_CEILING_BITS) * 100);
    const roundScore = clamp100(roundness(s.amount) * 100);

    // Rarity and roundness are separate failures, so the worse one governs
    // rather than being diluted by averaging with the milder one.
    const score = Math.max(rarityScore, roundScore * 0.8);
    worst = Math.max(worst, score);

    if (seen === 0 && populationTotal > 0) {
      findings.push({
        severity: "critical",
        title: `A ${s.label} of ${s.amount} is unique in the pool`,
        detail:
          `No other public edge in the observed pool falls in this denomination bucket. ` +
          `An observer matching the public in-list against the public out-list has ` +
          `exactly one candidate, so the shielded hop between them carries no ambiguity. ` +
          `Splitting the amount across common denominations restores the ambiguity.`,
        evidence: {
          amount: s.amount.toString(),
          block: s.block,
          matchingEdges: 0,
          surprisal: `${bits.toFixed(1)} bits`,
        },
      });
    } else if (bits > 6) {
      findings.push({
        severity: seen <= 2 ? "high" : "medium",
        title: `A ${s.label} of ${s.amount} is rare in the pool`,
        detail:
          `Only ${seen} other public edge(s) share this denomination — ${bits.toFixed(1)} bits ` +
          `of identifying information. The anonymity set for this amount is ${seen + 1}, ` +
          `not the size of the pool.`,
        evidence: {
          amount: s.amount.toString(),
          block: s.block,
          matchingEdges: seen,
          surprisal: `${bits.toFixed(1)} bits`,
        },
      });
    }

    if (roundness(s.amount) > 0.6 && digitCount(s.amount) >= 4) {
      findings.push({
        severity: "medium",
        title: `A ${s.label} of ${s.amount} is a conspicuously round number`,
        detail:
          `${trailingZeros(s.amount)} trailing zeros. Round amounts are chosen by humans, ` +
          `remembered by analysts, and rarely produced by the change arithmetic that ` +
          `generates most note values — which makes them easy to re-identify later.`,
        evidence: {
          amount: s.amount.toString(),
          trailingZeros: trailingZeros(s.amount),
          block: s.block,
        },
      });
    }
  }

  return {
    id: "denomination",
    label: "Amount distinctiveness",
    score: worst,
    weight: 0.3,
    limitation: "distinctive-patterns",
    findings,
  };
}
