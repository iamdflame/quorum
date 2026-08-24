import type { MetricResult, Finding, PoolObservation } from "../types.ts";
import { clamp100, entropyBits, mean } from "../stats.ts";

/**
 * TIMING — "rapid in-and-out sequences ... weaken the anonymity set."
 *
 * The pool hides who moved value, never when. Every deposit and withdrawal is
 * timestamped by the block that carried it, so an observer can always build a
 * clean timeline of the pool's public edges. Privacy then depends on that
 * timeline being ambiguous.
 *
 * It stops being ambiguous in two ways. Short dwell — value entering and leaving
 * within a narrow window — collapses the candidate set to whoever was in the pool
 * during that window. And a *clock fingerprint* survives even perfect dwell
 * discipline: an operator who only ever acts between 09:00 and 17:00 in one
 * timezone has published their working hours across every transaction they will
 * ever make, and no amount of shielding removes it.
 *
 * The remedy the docs give is "spread setup and movement over time". That is a
 * scheduling problem, which is why Chaff schedules rather than warns.
 */

/** Dwell shorter than this is treated as effectively simultaneous. */
const TIGHT_DWELL_SECONDS = 60 * 30;

/** Dwell beyond this contributes no exposure. */
const SAFE_DWELL_SECONDS = 60 * 60 * 48;

/** Hours in a day — the support of the clock-fingerprint histogram. */
const HOURS = 24;

/** Uniform activity across 24 hours carries this much entropy. */
const MAX_CLOCK_ENTROPY = Math.log2(HOURS);

/** Below this fraction of maximum clock entropy, the schedule is a fingerprint. */
const CLOCK_ENTROPY_FLOOR = 0.75;

export function timing(obs: PoolObservation): MetricResult {
  const findings: Finding[] = [];
  const toSeconds = (blocks: number) => blocks * obs.blockTimeSeconds;

  const own = obs.edges.filter((e) => e.own).sort((a, b) => a.block - b.block);
  const deposits = own.filter((e) => e.kind === "deposit");
  const withdrawals = own.filter((e) => e.kind === "withdrawal");

  // --- Dwell: how long value actually rested inside the pool ---
  const dwells: number[] = [];
  for (const w of withdrawals) {
    const prior = deposits.filter((d) => d.block <= w.block);
    if (prior.length === 0) continue;
    const nearest = prior[prior.length - 1]!;
    const seconds = toSeconds(w.block - nearest.block);
    dwells.push(seconds);

    if (seconds <= SAFE_DWELL_SECONDS) {
      const hours = seconds / 3600;
      findings.push({
        severity:
          seconds <= TIGHT_DWELL_SECONDS ? "critical" : seconds <= 60 * 60 * 6 ? "high" : "medium",
        title: `Value left the pool ${hours < 1 ? `${Math.round(seconds / 60)} minutes` : `${hours.toFixed(1)} hours`} after entering`,
        detail:
          `A deposit at block ${nearest.block} was followed by a withdrawal at block ` +
          `${w.block}. The anonymity set for this movement is only the operators who ` +
          `independently held value in the pool across that same window — a far smaller ` +
          `group than the pool as a whole, and one an observer can enumerate.`,
        evidence: {
          depositBlock: nearest.block,
          withdrawalBlock: w.block,
          dwellSeconds: Math.round(seconds),
          amount: w.amount.toString(),
        },
      });
    }
  }

  const dwellScore =
    dwells.length === 0
      ? 0
      : clamp100(
          100 *
            mean(
              dwells.map((d) => Math.max(0, 1 - d / SAFE_DWELL_SECONDS)),
            ),
        );

  // --- Clock fingerprint: does activity cluster into a working day? ---
  let clockScore = 0;
  if (own.length >= 4) {
    const hist = new Array<number>(HOURS).fill(0);
    for (const e of own) {
      const seconds = toSeconds(e.block);
      hist[Math.floor((seconds / 3600) % HOURS)]!++;
    }
    const h = entropyBits(hist);
    const ratio = MAX_CLOCK_ENTROPY === 0 ? 1 : h / MAX_CLOCK_ENTROPY;
    if (ratio < CLOCK_ENTROPY_FLOOR) {
      clockScore = clamp100((1 - ratio / CLOCK_ENTROPY_FLOOR) * 100);
      const active = hist.filter((c) => c > 0).length;
      findings.push({
        severity: ratio < 0.45 ? "high" : "medium",
        title: `Activity clusters into ${active} hour${active === 1 ? "" : "s"} of the day`,
        detail:
          `${own.length} public edges carry ${h.toFixed(2)} bits of clock entropy against a ` +
          `maximum of ${MAX_CLOCK_ENTROPY.toFixed(2)}. A recurring daily window links otherwise ` +
          `unrelated transactions to one operator and narrows their plausible timezone. ` +
          `Unlike amounts or note structure, this leak cannot be fixed retroactively — ` +
          `only future activity can be scheduled out of the pattern.`,
        evidence: {
          edges: own.length,
          activeHours: active,
          clockEntropyBits: Number(h.toFixed(2)),
        },
      });
    }
  }

  return {
    id: "timing",
    label: "Timing correlation",
    score: clamp100(Math.max(dwellScore, clockScore)),
    weight: 0.25,
    limitation: "distinctive-patterns",
    findings,
  };
}
