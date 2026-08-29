/**
 * @quorum/protocol — threshold coordination on the STRK20 pool.
 *
 * Pure and offline. Nothing here opens a socket, holds a key, or signs
 * anything: it turns campaign intentions into calldata and turns chain state
 * back into answers. That keeps the part a participant has to trust small
 * enough to read.
 */
export * from "./commit.ts";
export * from "./campaign.ts";
export * from "./actions.ts";
export * from "./verify.ts";
export * from "./blocktime.ts";

/** QuorumMachine, live. */
export const DEPLOYMENTS = {
  mainnet: {
    machine: "0x0079bab03056fd05dde50e921cf5ea8c3405aaaa2f05492a8a0e1fb6c811ff76",
    pool: "0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a",
  },
  sepolia: {
    machine: "0x06e13e8e129b91085bcb6bde0f3bac7b8cf3ceb504ed4eb0149becc4c9b41736",
    pool: "0x0254a6b2997ef52e9f830ce1f543f6b29768295e8d17e2267d672c552cfe0d91",
  },
} as const;

/** Charged per pool transaction, read from the live pool's `get_fee_amount`. */
export const POOL_FEE = 6_000_000_000_000_000_000n;
