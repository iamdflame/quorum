import type { PublicEdge, PoolObservation, Address, BlockNumber } from "@shoal/oracle";

/**
 * Live STRK20 pool reader.
 *
 * Everything Shoal needs is emitted by the pool in the clear, because the
 * protocol says so: "Edges are public by design." We are not defeating anything
 * here — we are reading what any observer reads, which is exactly the point.
 * The adversary can compute the anonymity set. Shoal computes it first, and
 * tells the person standing in it.
 *
 * Requires no key material, no funds, and no permission.
 */

/** The STRK20 privacy pool on Starknet mainnet. */
export const MAINNET_POOL =
  "0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a";

/** The same pool on Sepolia, per the STRK20 SDK docs. */
export const SEPOLIA_POOL =
  "0x0254a6b2997ef52e9f830ce1f543f6b29768295e8d17e2267d672c552cfe0d91";

/**
 * Event selectors, `starknet_keccak(name)`.
 *
 * `Deposit(user_addr key, token key, amount data)` and
 * `Withdrawal(enc_user_addr data, to_addr key, token key, amount data)` are the
 * two public edges of the pool. Note the asymmetry the protocol chose: a
 * deposit names the depositor in the clear, while a withdrawal encrypts the
 * *user* and exposes only the destination. Both still expose token and amount,
 * which is all the set model needs.
 */
export const SELECTORS = {
  Deposit: "0x9149d2123147c5f43d258257fef0b7b969db78269369ebcf5ebb9eef8592f2",
  Withdrawal: "0x2eed7e29b3502a726faf503ac4316b7101f3da813654e8df02c13449e03da8",
} as const;

/** Public mainnet RPCs, tried in order. */
export const DEFAULT_RPCS = [
  "https://api.cartridge.gg/x/starknet/mainnet",
  "https://rpc.starknet.lava.build:443",
] as const;

export interface RawEvent {
  readonly keys: readonly string[];
  readonly data: readonly string[];
  readonly block_number: number;
  readonly transaction_hash: string;
}

export class RpcError extends Error {}

async function call(rpc: string, method: string, params: unknown[]): Promise<any> {
  const res = await fetch(rpc, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  if (!res.ok) throw new RpcError(`${rpc} returned HTTP ${res.status}`);
  const json = (await res.json()) as { result?: unknown; error?: unknown };
  if (json.error) throw new RpcError(`${rpc}: ${JSON.stringify(json.error)}`);
  return json.result;
}

/** Try each endpoint in turn; public RPCs fail often enough to warrant it. */
async function withFailover<T>(
  rpcs: readonly string[], fn: (rpc: string) => Promise<T>,
): Promise<T> {
  let last: unknown;
  for (const rpc of rpcs) {
    try {
      return await fn(rpc);
    } catch (err) {
      last = err;
    }
  }
  throw new RpcError(`all RPC endpoints failed; last: ${String(last)}`);
}

export async function blockNumber(rpcs: readonly string[] = DEFAULT_RPCS): Promise<number> {
  return withFailover(rpcs, (r) => call(r, "starknet_blockNumber", []) as Promise<number>);
}

/**
 * Page through pool events of one kind.
 *
 * `chunkSize` is deliberately modest: public endpoints cap response size, and a
 * rejected large page costs more than two accepted small ones.
 */
export async function fetchEvents(
  selector: string,
  fromBlock: number,
  toBlock: number,
  opts: { pool?: string; rpcs?: readonly string[]; chunkSize?: number; maxPages?: number } = {},
): Promise<RawEvent[]> {
  const pool = opts.pool ?? MAINNET_POOL;
  const rpcs = opts.rpcs ?? DEFAULT_RPCS;
  const chunkSize = opts.chunkSize ?? 100;
  const maxPages = opts.maxPages ?? 200;

  const out: RawEvent[] = [];
  let token: string | undefined;
  for (let page = 0; page < maxPages; page++) {
    const filter: Record<string, unknown> = {
      from_block: { block_number: fromBlock },
      to_block: { block_number: toBlock },
      address: pool,
      keys: [[selector]],
      chunk_size: chunkSize,
    };
    if (token !== undefined) filter["continuation_token"] = token;

    const res: { events: RawEvent[]; continuation_token?: string } = await withFailover(
      rpcs, (r) => call(r, "starknet_getEvents", [filter]),
    );
    out.push(...res.events);
    if (!res.continuation_token) break;
    token = res.continuation_token;
  }
  return out;
}

/**
 * Decode a `Deposit`: keys = [selector, user_addr, token], data = [amount].
 * The depositor is a key, so it is indexed and unambiguous — this is the
 * attribution that lets the set model see concentration rather than assuming a
 * crowd of strangers.
 */
export function decodeDeposit(e: RawEvent): PublicEdge | null {
  const operator = e.keys[1];
  const token = e.keys[2];
  const amount = e.data[0];
  if (operator === undefined || token === undefined || amount === undefined) return null;
  return {
    kind: "deposit",
    token: BigInt(token),
    amount: BigInt(amount),
    block: e.block_number,
    own: false,
    operator: BigInt(operator),
  };
}

/**
 * Decode a `Withdrawal`: keys = [selector, to_addr, token],
 * data = [...enc_user_addr, amount]. The withdrawing user is encrypted to the
 * auditor, so the destination address is the only attributable party — which is
 * itself the leak, since a destination that recurs is as good as an identity.
 */
export function decodeWithdrawal(e: RawEvent): PublicEdge | null {
  const to = e.keys[1];
  const token = e.keys[2];
  const amount = e.data[e.data.length - 1];
  if (to === undefined || token === undefined || amount === undefined) return null;
  return {
    kind: "withdrawal",
    token: BigInt(token),
    amount: BigInt(amount),
    block: e.block_number,
    own: false,
    operator: BigInt(to),
  };
}

/** Read the pool's public edges over a block range into an observation. */
export async function observePool(
  fromBlock: number,
  toBlock: number,
  opts: { pool?: string; rpcs?: readonly string[]; blockTimeSeconds?: number } = {},
): Promise<PoolObservation> {
  const [deposits, withdrawals] = await Promise.all([
    fetchEvents(SELECTORS.Deposit, fromBlock, toBlock, opts),
    fetchEvents(SELECTORS.Withdrawal, fromBlock, toBlock, opts),
  ]);
  const edges: PublicEdge[] = [
    ...deposits.map(decodeDeposit),
    ...withdrawals.map(decodeWithdrawal),
  ].filter((e): e is PublicEdge => e !== null);
  edges.sort((a, b) => a.block - b.block);

  return {
    head: toBlock,
    notes: [],
    edges,
    channels: [],
    blockTimeSeconds: opts.blockTimeSeconds ?? 30,
  };
}

/** Known mainnet assets, for display only. */
export const KNOWN_TOKENS: ReadonlyMap<string, { symbol: string; decimals: number }> = new Map([
  ["0x4718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d", { symbol: "STRK", decimals: 18 }],
  ["0x53c91253bc9682c04929ca02ed00b3e423f6710d2ee7e0d5ebb06f3ecf368a8", { symbol: "USDC", decimals: 6 }],
  ["0x33068f6539f8e6e6b131e6b2b814e6c34a5224bc66947c47dab9dfee93b35fb", { symbol: "USDC", decimals: 6 }],
  ["0x49d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7", { symbol: "ETH", decimals: 18 }],
  ["0x68f5c6a61780768455de69077e07e89787839bf8166decfbf92b645209c0fb8", { symbol: "USDT", decimals: 6 }],
]);

export function tokenLabel(token: Address): string {
  const hex = token.toString(16);
  const known = KNOWN_TOKENS.get(`0x${hex}`) ?? KNOWN_TOKENS.get(`0x0${hex}`);
  return known ? known.symbol : `0x${hex.slice(0, 6)}…`;
}

export function formatAmount(token: Address, amount: bigint): string {
  const hex = token.toString(16);
  const known = KNOWN_TOKENS.get(`0x${hex}`) ?? KNOWN_TOKENS.get(`0x0${hex}`);
  if (!known) return amount.toString();
  const d = BigInt(10) ** BigInt(known.decimals);
  const whole = amount / d;
  const frac = ((amount % d) * 1000n) / d;
  return `${whole}.${frac.toString().padStart(3, "0")}`;
}

/**
 * `ExternalContractInvoked(contract_address key, selector key)` — the pool
 * announces every anonymizer it calls, so the set of helper contracts is
 * authoritative rather than guessed.
 */
export const EXTERNAL_INVOKED_SELECTOR =
  "0xa8fb36d0894f5e87797c38533a55c4486a1f35e9e9eced10f995b9639a8955";

/**
 * Addresses that are infrastructure rather than participants.
 *
 * This distinction decides whether the measured anonymity set means anything.
 * A private swap withdraws to an anonymizer contract, and relayers and fee
 * sinks receive constantly — none of those are "someone you could have been",
 * so counting them inflates the crowd with entities that were never candidates.
 *
 * Two sources, both derived from chain state rather than a maintained list:
 *
 *   1. Anonymizers, taken directly from `ExternalContractInvoked`.
 *   2. Sinks: deployed contracts that receive withdrawals across several assets
 *      and never once deposit. A participant puts value in before taking it
 *      out; something that only ever drains the pool is plumbing.
 */
export interface Infrastructure {
  readonly anonymizers: ReadonlySet<string>;
  readonly sinks: ReadonlySet<string>;
  readonly all: ReadonlySet<string>;
}

/** A receiver spanning at least this many assets, with no deposits, is a sink. */
const SINK_MIN_TOKENS = 3;

/** ...and must have received at least this many times, to exclude coincidence. */
const SINK_MIN_RECEIPTS = 10;

export async function identifyInfrastructure(
  edges: readonly PublicEdge[],
  fromBlock: number,
  toBlock: number,
  opts: { pool?: string; rpcs?: readonly string[] } = {},
): Promise<Infrastructure> {
  const anonymizers = new Set<string>();
  try {
    const invoked = await fetchEvents(EXTERNAL_INVOKED_SELECTOR, fromBlock, toBlock, opts);
    for (const e of invoked) {
      const a = e.keys[1];
      if (a !== undefined) anonymizers.add(BigInt(a).toString(16));
    }
  } catch {
    // A missing invoke history degrades precision, not correctness: the sink
    // heuristic below still catches the high-volume helpers.
  }

  const deposited = new Set<string>();
  const received = new Map<string, Set<string>>();
  const receipts = new Map<string, number>();
  for (const e of edges) {
    if (e.operator === undefined) continue;
    const a = e.operator.toString(16);
    if (e.kind === "deposit") {
      deposited.add(a);
    } else {
      const toks = received.get(a) ?? new Set<string>();
      toks.add(e.token.toString(16));
      received.set(a, toks);
      receipts.set(a, (receipts.get(a) ?? 0) + 1);
    }
  }

  const rpcs = opts.rpcs ?? DEFAULT_RPCS;
  const sinks = new Set<string>();
  for (const [addr, tokens] of received) {
    if (deposited.has(addr)) continue;
    if (tokens.size < SINK_MIN_TOKENS) continue;
    if ((receipts.get(addr) ?? 0) < SINK_MIN_RECEIPTS) continue;
    // Only a deployed contract can be plumbing; an EOA receiving a lot is just
    // a heavy user, and excluding them would understate the real crowd.
    try {
      const cls = await withFailover(rpcs, (r) =>
        call(r, "starknet_getClassHashAt", ["latest", `0x${addr}`]));
      if (cls) sinks.add(addr);
    } catch {
      // Not deployed, or the node refused: treat as a participant. Erring
      // toward inclusion keeps us from deleting real people from the crowd.
    }
  }

  return { anonymizers, sinks, all: new Set([...anonymizers, ...sinks]) };
}

/** Drop edges whose counterparty is infrastructure. */
export function excludeInfrastructure(
  edges: readonly PublicEdge[], infra: Infrastructure,
): PublicEdge[] {
  return edges.filter(
    (e) => e.operator === undefined || !infra.all.has(e.operator.toString(16)),
  );
}

/** Every event the pool emits, by `starknet_keccak(name)`. */
export const ALL_SELECTORS = {
  Deposit: SELECTORS.Deposit,
  Withdrawal: SELECTORS.Withdrawal,
  OpenNoteDeposited: "0x25b6da03c4858d11cb0708d5cb6be79b190fb32eb7a7ce83804e07cbbb9bead",
  OpenNoteCreated: "0x22330482fd296a27cf9096807b4a3622cd619d31cce42c1e55655914e8459ee",
  EncNoteCreated: "0x23c20207be8b1ef4430c25eef8ce779c9745ebe04139555ae81bd4f8fdd6ec5",
  NoteUsed: "0x247fc60d782e0094e7f98c47f277d92a3345d07a436f1f56b27a9b62be2322e",
  ViewingKeySet: "0x1321a492485b4f19851fb787ab3800a0030b595332cba93cd5fe40dfb5a4daf",
  ExternalContractInvoked: EXTERNAL_INVOKED_SELECTOR,
} as const;

export type EventKind = keyof typeof ALL_SELECTORS | "Unknown";

const KIND_BY_SELECTOR = new Map<string, EventKind>(
  Object.entries(ALL_SELECTORS).map(([k, v]) => [BigInt(v).toString(16), k as EventKind]),
);

export function eventKind(e: RawEvent): EventKind {
  const k0 = e.keys[0];
  if (k0 === undefined) return "Unknown";
  return KIND_BY_SELECTOR.get(BigInt(k0).toString(16)) ?? "Unknown";
}

export interface PoolEvent {
  readonly kind: EventKind;
  readonly keys: readonly string[];
  readonly data: readonly string[];
}

/**
 * One pool transaction and every event it emitted.
 *
 * Grouping by transaction is the whole point. Each event on its own is
 * carefully anonymous; a *set* of them sharing a transaction hash is not,
 * because everything in one transaction was caused by one actor. That is where
 * the pool's real linkage lives, and it is invisible if you read event streams
 * one selector at a time.
 */
export interface PoolTransaction {
  readonly hash: string;
  readonly block: BlockNumber;
  readonly events: readonly PoolEvent[];
}

/** Fetch every pool event in a range, grouped by transaction. */
export async function fetchTransactions(
  fromBlock: number,
  toBlock: number,
  opts: { pool?: string; rpcs?: readonly string[]; chunkSize?: number; maxPages?: number } = {},
): Promise<PoolTransaction[]> {
  const pool = opts.pool ?? MAINNET_POOL;
  const rpcs = opts.rpcs ?? DEFAULT_RPCS;
  const chunkSize = opts.chunkSize ?? 1000;
  const maxPages = opts.maxPages ?? 400;

  const grouped = new Map<string, { block: number; events: PoolEvent[] }>();
  let token: string | undefined;
  for (let page = 0; page < maxPages; page++) {
    // No key filter: co-occurrence is the signal, so every event matters.
    const filter: Record<string, unknown> = {
      from_block: { block_number: fromBlock },
      to_block: { block_number: toBlock },
      address: pool,
      chunk_size: chunkSize,
    };
    if (token !== undefined) filter["continuation_token"] = token;

    const res: { events: RawEvent[]; continuation_token?: string } = await withFailover(
      rpcs, (r) => call(r, "starknet_getEvents", [filter]),
    );
    for (const e of res.events) {
      const entry = grouped.get(e.transaction_hash)
        ?? { block: e.block_number, events: [] as PoolEvent[] };
      entry.events.push({ kind: eventKind(e), keys: e.keys, data: e.data });
      grouped.set(e.transaction_hash, entry);
    }
    if (!res.continuation_token) break;
    token = res.continuation_token;
  }
  return [...grouped.entries()].map(([hash, v]) => ({ hash, block: v.block, events: v.events }))
    .sort((a, b) => a.block - b.block);
}
