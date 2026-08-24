/**
 * The STRK20 note model, as Chaff needs to reason about it.
 *
 * A note is an immutable (owner, token, amount) record living at
 *   note_id = h(NOTE_ID_TAG, channel_key, token, index, 0)
 * inside a per-token subchannel of a directional sender -> recipient channel.
 * Spending publishes
 *   nullifier = h(NULLIFIER_TAG, channel_key, token, index, 0, owner_private_key)
 * and, because spends are all-or-nothing, mints change back into the
 * self-channel. That change is the raw material every metric here works on.
 *
 * Reference: https://strk20-by-example.org/notes-and-nullifiers
 */

/** Starknet felt-addressed value. Always bigint: the SDK keys AddressMap by bigint. */
export type Address = bigint;

/** Block height. Notes mature — become spendable — 10 blocks after creation. */
export type BlockNumber = number;

/** Notes are spendable only once this many blocks have passed since creation. */
export const NOTE_MATURITY_BLOCKS = 10;

/** Proofs are generated against `head - PROVING_LAG` to survive reorgs. */
export const PROVING_LAG_BLOCKS = 10;

/** Open notes use the protocol-reserved salt 1; encrypted notes use salt >= 2. */
export const OPEN_NOTE_SALT = 1n;

/**
 * A single unspent note belonging to the operator.
 *
 * `channelKey` is opaque here — Chaff never handles viewing-key material
 * directly, it only needs to know which notes share a lane, because notes in
 * one subchannel carry a dense sequential index an observer can count.
 */
export interface Note {
  readonly token: Address;
  readonly amount: bigint;
  /** Block the note was created in. */
  readonly created: BlockNumber;
  /** Opaque per-channel identity; notes sharing it live in the same lane. */
  readonly channel: string;
  /** Dense sequential index inside (channel, token). */
  readonly index: number;
  /**
   * Open notes carry a plaintext amount on-chain — the anonymizer filled it
   * after proof time. Their value is public even though their owner is not.
   */
  readonly open: boolean;
  /** True when this note is change minted back to the operator by their own spend. */
  readonly change: boolean;
}

/**
 * A public edge of the pool: deposits and withdrawals are plaintext ERC-20 legs.
 * "Edges are public by design" — the docs are explicit that only movement
 * *inside* the pool is encrypted. Chaff reads these to model what an observer
 * standing outside the pool can actually see.
 */
export interface PublicEdge {
  readonly kind: "deposit" | "withdrawal";
  readonly token: Address;
  readonly amount: bigint;
  readonly block: BlockNumber;
  /** Whether this edge belongs to the operator being analysed. */
  readonly own: boolean;
  /**
   * The public address behind this edge. Deposits expose the depositor and
   * withdrawals expose the recipient, so this is observable in practice — and
   * attributing flow to it is what lets the set model see concentration. When
   * absent, each edge is conservatively treated as its own operator, which
   * understates concentration rather than inventing a crowd.
   */
  readonly operator?: Address;
}

/** A channel-open event, which is itself observable as a registration/storage write. */
export interface ChannelOpen {
  readonly channel: string;
  readonly block: BlockNumber;
  readonly own: boolean;
}

/**
 * Everything Chaff needs to score one operator against one pool.
 * All of it is obtainable without spend authority: `discoverNotes` and
 * `discoverChannels` are queries, and the edges are public chain data.
 */
export interface PoolObservation {
  readonly head: BlockNumber;
  readonly notes: readonly Note[];
  readonly edges: readonly PublicEdge[];
  readonly channels: readonly ChannelOpen[];
  /** Blocks per unit time, used to convert block deltas into wall-clock windows. */
  readonly blockTimeSeconds: number;
}

/** Which documented STRK20 limitation a finding maps to. */
export type Limitation =
  | "channel-open-linkability"
  | "distinctive-patterns"
  | "public-edges"
  | "anonymity-set";

export interface MetricResult {
  readonly id: string;
  readonly label: string;
  /** 0 = no observable exposure, 100 = fully exposed on this axis. */
  readonly score: number;
  /** Relative contribution to the composite score. */
  readonly weight: number;
  readonly limitation: Limitation;
  /** Human-readable, evidence-bearing explanation. Never a bare number. */
  readonly findings: readonly Finding[];
}

export interface Finding {
  readonly severity: "critical" | "high" | "medium" | "low";
  readonly title: string;
  readonly detail: string;
  /** Concrete on-chain evidence: amounts, blocks, counts. */
  readonly evidence: Readonly<Record<string, string | number>>;
}
