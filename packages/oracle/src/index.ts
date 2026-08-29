/**
 * @quorum/oracle — the note-layer exposure model for the STRK20 shielded pool.
 *
 * Pure and offline by design. Nothing here touches the network, holds a viewing
 * key, or needs spend authority: it takes an observation of a pool and returns
 * what an observer of that pool could work out. That keeps the threat model
 * auditable on its own terms and lets the same scorer run in a browser, in CI,
 * or against a historical snapshot.
 */
export * from "./types.ts";
export * from "./stats.ts";
export { analyse, grade, METRICS } from "./exposure.ts";
export type { ExposureReport, Grade } from "./exposure.ts";
export { fragmentation, nullifierBurst } from "./metrics/fragmentation.ts";
export { denomination, denominationBucket, roundness } from "./metrics/denomination.ts";
export { timing } from "./metrics/timing.ts";
export { linkability } from "./metrics/linkability.ts";
export * from "./set.ts";
