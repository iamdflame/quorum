import type { MetricResult, Finding, PoolObservation } from "../types.ts";
import { clamp100, saturate } from "../stats.ts";

/**
 * CHANNEL-OPEN LINKABILITY — the first limitation the docs name:
 *
 *   "opening a channel and depositing or withdrawing in the same transaction
 *    (or in tight succession) can link a recipient to their public activity.
 *    Spread setup and movement over time."
 *
 * A channel open is a storage write an observer can see. A deposit is a
 * plaintext ERC-20 leg an observer can see. Neither reveals anything alone.
 * Adjacent in time they reveal that the address performing the public leg is the
 * same party who just opened a private lane — which is exactly the binding the
 * pool exists to break.
 *
 * This is the cheapest exposure to avoid and the easiest to create by accident,
 * because every wallet's natural onboarding flow does setup and first deposit
 * back to back.
 */

/** Same-block setup and movement: the binding is unambiguous. */
const SAME_BLOCK = 0;

/** Beyond this separation the two events stop being "tight succession". */
const SAFE_SEPARATION_BLOCKS = 900;

/** Separation of this many blocks scores 50. */
const SEPARATION_MIDPOINT = 120;

export function linkability(obs: PoolObservation): MetricResult {
  const findings: Finding[] = [];
  const ownOpens = obs.channels.filter((c) => c.own);
  const ownEdges = obs.edges.filter((e) => e.own);

  if (ownOpens.length === 0 || ownEdges.length === 0) {
    return {
      id: "linkability",
      label: "Channel-open linkability",
      score: 0,
      weight: 0.2,
      limitation: "channel-open-linkability",
      findings,
    };
  }

  let worst = 0;
  for (const open of ownOpens) {
    let nearest: { blocks: number; edge: (typeof ownEdges)[number] } | null = null;
    for (const edge of ownEdges) {
      const blocks = Math.abs(edge.block - open.block);
      if (nearest === null || blocks < nearest.blocks) nearest = { blocks, edge };
    }
    if (nearest === null || nearest.blocks > SAFE_SEPARATION_BLOCKS) continue;

    // Inverted saturation: zero separation is total exposure, decaying with distance.
    const score = clamp100(100 - saturate(nearest.blocks, SEPARATION_MIDPOINT));
    worst = Math.max(worst, score);

    const seconds = nearest.blocks * obs.blockTimeSeconds;
    findings.push({
      severity:
        nearest.blocks <= SAME_BLOCK ? "critical" : nearest.blocks <= 30 ? "high" : "medium",
      title:
        nearest.blocks === SAME_BLOCK
          ? `Channel opened in the same block as a ${nearest.edge.kind}`
          : `Channel opened ${nearest.blocks} block${nearest.blocks === 1 ? "" : "s"} from a ${nearest.edge.kind}`,
      detail:
        `The channel open at block ${open.block} sits ${nearest.blocks} block(s) — about ` +
        `${seconds < 120 ? `${Math.round(seconds)} seconds` : `${(seconds / 60).toFixed(0)} minutes`} — ` +
        `from a public ${nearest.edge.kind} of ${nearest.edge.amount}. The docs call for ` +
        `spreading setup and movement over time; at this separation an observer can bind ` +
        `the public address to the private lane with high confidence.`,
      evidence: {
        channelBlock: open.block,
        edgeBlock: nearest.edge.block,
        separationBlocks: nearest.blocks,
        edgeKind: nearest.edge.kind,
      },
    });
  }

  return {
    id: "linkability",
    label: "Channel-open linkability",
    score: worst,
    weight: 0.2,
    limitation: "channel-open-linkability",
    findings,
  };
}
