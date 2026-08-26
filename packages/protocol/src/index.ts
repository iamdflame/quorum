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

/** QuorumMachine, live. */
export const DEPLOYMENTS = {
  mainnet: {
    machine: "0x06d3f070a8732b1272ac7e73527187ce08da502839b18fc30a481a79512b8c08",
    pool: "0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a",
  },
  sepolia: {
    machine: "0x01281b5f8e26c1ec0ab5fc439b1c23e1e37f183438a7b148b2894436f940da02",
    pool: "0x0254a6b2997ef52e9f830ce1f543f6b29768295e8d17e2267d672c552cfe0d91",
  },
} as const;

/** Charged per pool transaction, read from the live pool's `get_fee_amount`. */
export const POOL_FEE = 6_000_000_000_000_000_000n;
