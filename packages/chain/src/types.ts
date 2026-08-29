/**
 * What an observer of the pool can see.
 *
 * These describe chain observations rather than any particular analysis of
 * them, so they live here rather than in whatever happens to consume them. They
 * were originally defined in an anonymity-set package; that package is archived
 * and these outlived it.
 */

/** Starknet felt-addressed value. Always bigint: the SDK keys AddressMap by bigint. */
export type Address = bigint;

/** Block height. */
export type BlockNumber = number;

/**
 * A public edge of the pool.
 *
 * Deposits and withdrawals are plaintext ERC-20 legs — the STRK20 docs are
 * explicit that only movement *inside* the pool is encrypted. That publicity is
 * what makes any of this measurable from outside, which is the point: the
 * adversary can compute it, so we compute it first.
 */
export interface PublicEdge {
  readonly kind: "deposit" | "withdrawal";
  readonly token: Address;
  readonly amount: bigint;
  readonly block: BlockNumber;
  /** Whether this edge belongs to the party being analysed. */
  readonly own: boolean;
  /**
   * The address behind the edge. A deposit names its depositor and a withdrawal
   * names its destination, so this is observable in practice — and attributing
   * flow to it is what lets a crowd be told apart from one busy participant.
   */
  readonly operator?: Address;
}

/** A channel-open, observable as a storage write. */
export interface ChannelOpen {
  readonly channel: string;
  readonly block: BlockNumber;
  readonly own: boolean;
}

/** A note held inside the pool. */
export interface Note {
  readonly token: Address;
  readonly amount: bigint;
  readonly created: BlockNumber;
  readonly channel: string;
  readonly index: number;
  readonly open: boolean;
  readonly change: boolean;
}

/** Everything needed to reason about one pool over one range of blocks. */
export interface PoolObservation {
  readonly head: BlockNumber;
  readonly notes: readonly Note[];
  readonly edges: readonly PublicEdge[];
  readonly channels: readonly ChannelOpen[];
  readonly blockTimeSeconds: number;
}
