import type { MetricResult, Finding, PoolObservation, Note, Address } from "../types.ts";
import { NOTE_MATURITY_BLOCKS } from "../types.ts";
import { clamp100, gini, median, saturate } from "../stats.ts";

/**
 * FRAGMENTATION — "distinctive patterns", from the spend side.
 *
 * Spending is all-or-nothing. To pay 30 out of a 100 note you consume the whole
 * note and mint change. Every consumed note publishes one nullifier, and the
 * *number of nullifiers in a transaction is public* even though each one is
 * individually unlinkable. So the shape of a spend leaks the shape of the note
 * set behind it: an operator who burns eleven nullifiers to make one payment has
 * announced that they hold a fragmented set, which is a durable fingerprint
 * across otherwise unlinkable transactions.
 *
 * Change accumulation makes this strictly worse over time, without the operator
 * ever doing anything wrong — which is precisely why it needs a maintenance
 * layer rather than a warning.
 *
 * Three sub-signals, per token:
 *   burst    the nullifier count a representative payment would publish
 *   dust     notes too small to carry a payment but still inflating that count
 *   skew     Gini of the amount distribution; one whale plus dust spends badly
 */

/** A payment large enough to be representative: half the spendable balance. */
const REPRESENTATIVE_FRACTION = 2n;

/** Notes below this fraction of the median are dust: they can only add nullifiers. */
const DUST_FRACTION = 0.05;

/** A burst of this many nullifiers scores 50 — see `saturate`. */
const BURST_MIDPOINT = 4;

function notesByToken(notes: readonly Note[]): Map<Address, Note[]> {
  const m = new Map<Address, Note[]>();
  for (const n of notes) {
    const list = m.get(n.token);
    if (list) list.push(n);
    else m.set(n.token, [n]);
  }
  return m;
}

/**
 * How many notes a naive selector consumes to cover `target`.
 * Mirrors the SDK's `autoSelectNotes: "naive"` — smallest set covering the
 * amount, largest-first — so the number we report is the number the pool
 * would actually publish.
 */
export function nullifierBurst(notes: readonly Note[], target: bigint): number {
  if (target <= 0n) return 0;
  const sorted = [...notes].sort((a, b) => (b.amount > a.amount ? 1 : b.amount < a.amount ? -1 : 0));
  let acc = 0n;
  let k = 0;
  for (const n of sorted) {
    acc += n.amount;
    k++;
    if (acc >= target) break;
  }
  return k;
}

export function fragmentation(obs: PoolObservation): MetricResult {
  const findings: Finding[] = [];
  const perTokenScores: number[] = [];

  for (const [token, all] of notesByToken(obs.notes)) {
    // Immature notes cannot be spent yet, so they cannot participate in a burst.
    const spendable = all.filter((n) => obs.head - n.created >= NOTE_MATURITY_BLOCKS);
    if (spendable.length === 0) continue;

    const amounts = spendable.map((n) => Number(n.amount));
    const med = median(amounts);
    const total = spendable.reduce((s, n) => s + n.amount, 0n);

    const burst = nullifierBurst(spendable, total / REPRESENTATIVE_FRACTION);
    const dust = spendable.filter((n) => med > 0 && Number(n.amount) < med * DUST_FRACTION);
    const skew = gini(amounts);

    // A single note publishes one nullifier and leaks nothing structural.
    const burstScore = saturate(Math.max(0, burst - 1), BURST_MIDPOINT);
    const dustScore = clamp100((dust.length / spendable.length) * 100);
    const skewScore = clamp100(skew * 100);

    // Burst governs: it is the signal an observer actually reads off-chain.
    // Dust and skew are aggravators — they make a bad set worse by consuming
    // the headroom above the burst floor, but they can never dilute it. A
    // uniform set of twelve notes still publishes six nullifiers, and averaging
    // that against a clean Gini would report it as healthy when it is not.
    const aggravation = 0.35 * (dustScore / 100) + 0.25 * (skewScore / 100);
    const score = clamp100(burstScore + (100 - burstScore) * aggravation);
    perTokenScores.push(score);

    const tokenHex = `0x${token.toString(16)}`;

    if (burst >= 3) {
      findings.push({
        severity: burst >= 8 ? "critical" : burst >= 5 ? "high" : "medium",
        title: `A representative payment publishes ${burst} nullifiers at once`,
        detail:
          `Paying half the shielded balance of ${tokenHex} consumes ${burst} of ` +
          `${spendable.length} notes. Nullifier counts are public, so this spend ` +
          `is distinguishable from the single-nullifier spends most operators make. ` +
          `Consolidating first reduces the burst to 1 and makes the payment ` +
          `indistinguishable from the pool's most common transaction shape.`,
        evidence: { token: tokenHex, nullifiers: burst, notes: spendable.length },
      });
    }

    if (dust.length > 0) {
      findings.push({
        severity: dust.length > spendable.length / 2 ? "high" : "low",
        title: `${dust.length} dust note${dust.length === 1 ? "" : "s"} inflating every spend`,
        detail:
          `${dust.length} note(s) hold less than ${Math.round(DUST_FRACTION * 100)}% of the ` +
          `median note value. They are too small to carry a payment on their own but ` +
          `are still selected as inputs, adding nullifiers — and therefore signal — ` +
          `to transactions that would otherwise be quiet.`,
        evidence: { token: tokenHex, dustNotes: dust.length, medianNote: Math.round(med) },
      });
    }

    if (skew > 0.6) {
      findings.push({
        severity: "medium",
        title: "Note amounts are heavily skewed",
        detail:
          `Gini ${skew.toFixed(2)} across ${spendable.length} notes: the set is one or two ` +
          `large notes surrounded by fragments. Large payments must break a whale note ` +
          `and mint conspicuous change; small payments can only be made from the fragments.`,
        evidence: { token: tokenHex, gini: Number(skew.toFixed(3)), notes: spendable.length },
      });
    }
  }

  const score = perTokenScores.length === 0 ? 0 : Math.max(...perTokenScores);

  return {
    id: "fragmentation",
    label: "Note fragmentation",
    score,
    weight: 0.25,
    limitation: "distinctive-patterns",
    findings,
  };
}
