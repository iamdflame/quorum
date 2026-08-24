import type { MetricResult, PoolObservation, Finding } from "./types.ts";
import { clamp100 } from "./stats.ts";
import { fragmentation } from "./metrics/fragmentation.ts";
import { denomination } from "./metrics/denomination.ts";
import { timing } from "./metrics/timing.ts";
import { linkability } from "./metrics/linkability.ts";

/**
 * The Chaff Exposure Score.
 *
 * One number, 0..100, answering a question the pool itself cannot: given
 * everything an observer can legitimately see, how much does this operator's
 * *use* of the pool give away?
 *
 * Every input maps to a limitation StarkWare documents rather than to a
 * vulnerability we invented — the protocol is sound, and none of these are
 * breaks in it. They are the residue the docs explicitly decline to hide:
 *
 *   channel-open-linkability   setup adjacent to public movement
 *   distinctive-patterns       recognisable amounts, spend shapes, rapid cycles
 *   public-edges               deposits and withdrawals are plaintext by design
 *
 * The composite deliberately refuses to average. A perfect score on three axes
 * does not repair a critical failure on the fourth: an observer only needs one
 * reliable correlation, and privacy is conjunctive. So the composite is a
 * weighted mean pulled toward its worst component, never below it.
 */

export type Grade = "exposed" | "weak" | "fair" | "strong" | "quiet";

export interface ExposureReport {
  /** 0 = nothing observable, 100 = fully identified. Lower is better. */
  readonly score: number;
  readonly grade: Grade;
  readonly metrics: readonly MetricResult[];
  readonly findings: readonly Finding[];
  /** Block height the observation was taken at. */
  readonly head: number;
  /** Plain-language summary of the single most damaging finding. */
  readonly headline: string;
}

export const METRICS = [fragmentation, denomination, timing, linkability] as const;

const SEVERITY_RANK = { critical: 0, high: 1, medium: 2, low: 3 } as const;

export function grade(score: number): Grade {
  if (score >= 75) return "exposed";
  if (score >= 55) return "weak";
  if (score >= 35) return "fair";
  if (score >= 15) return "strong";
  return "quiet";
}

/**
 * Weighted mean, then pulled toward the worst axis.
 *
 * `blend` controls how conjunctive the score is. At 0 it is a plain weighted
 * mean, which flatters an operator with one fatal leak. At 1 the worst axis
 * dominates entirely, which makes the other three unreadable. 0.5 keeps every
 * axis legible while guaranteeing the composite never sits below its worst
 * component's midpoint.
 */
const WORST_BLEND = 0.5;

export function analyse(obs: PoolObservation): ExposureReport {
  const metrics = METRICS.map((m) => m(obs));

  const totalWeight = metrics.reduce((s, m) => s + m.weight, 0);
  const weighted =
    totalWeight === 0 ? 0 : metrics.reduce((s, m) => s + m.score * m.weight, 0) / totalWeight;
  const worst = metrics.reduce((mx, m) => Math.max(mx, m.score), 0);

  const score = clamp100(weighted * (1 - WORST_BLEND) + Math.max(weighted, worst) * WORST_BLEND);

  const findings = metrics
    .flatMap((m) => m.findings)
    .sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);

  const headline =
    findings[0]?.title ??
    (obs.notes.length === 0
      ? "No shielded position observed."
      : "No observable exposure on any tracked axis.");

  return { score, grade: grade(score), metrics, findings, head: obs.head, headline };
}
