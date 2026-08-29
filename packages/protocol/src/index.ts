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
    machine: "0x00dca84ff35ee793c69c983abfc29e3e1aa8790f7dcd7e0288b705f600fcdaf7",
    pool: "0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a",
  },
  sepolia: {
    machine: "0x07d639ca00289a59a6949a12f6470feadf74d905d01bcce331f6c9d1d775fc73",
    pool: "0x0254a6b2997ef52e9f830ce1f543f6b29768295e8d17e2267d672c552cfe0d91",
  },
} as const;

/** Charged per pool transaction, read from the live pool's `get_fee_amount`. */
export const POOL_FEE = 6_000_000_000_000_000_000n;
