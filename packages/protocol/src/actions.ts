import { toFelt } from "./commit.ts";
import type { CampaignCalldata } from "./campaign.ts";

/**
 * Turning campaign operations into STRK20 wallet actions.
 *
 * Every operation is one pool transaction, and the shape is always the same
 * sandwich: move value in, mint an open note where the result should land, then
 * invoke QuorumMachine and let it decide. The `${openNoteIds[0]}` and
 * `${poolAddress}` placeholders are filled in by the wallet as it assembles the
 * actions, so the dapp never learns the note id — which is exactly the part that
 * would otherwise let a campaign's organiser deanonymise their own participants.
 */

/** `QuorumOp`, matching the Cairo enum's variant order. */
export const OP = { Create: 0, Commit: 1, Fire: 2, Reclaim: 3, Unseal: 4 } as const;

/** `PayoutPolicy`, matching the Cairo enum's variant order. */
export const POLICY = { RefundAll: 0, BoundTreasury: 1 } as const;

/** Wallet-resolved placeholders. The dapp never sees the real values. */
export const OPEN_NOTE_0 = "${openNoteIds[0]}";
export const POOL_ADDRESS = "${poolAddress}";

const felt = toFelt;

/** Serialise `Span<OpenNoteDeposit>`: a length, then each element flattened. */
function span(
  deposits: readonly { noteId: string; token: string; amount: bigint }[],
): string[] {
  const out = [felt(deposits.length)];
  for (const d of deposits) out.push(felt(d.noteId), felt(d.token), felt(d.amount));
  return out;
}

/**
 * Calldata for `privacy_invoke`, in the order the Cairo signature declares.
 *
 * One builder rather than five, so the argument order lives in exactly one
 * place. A silent mismatch does not throw — it deserialises into the wrong
 * parameters, and the contract either rejects something confusing or, worse,
 * accepts it.
 */
function invoke(args: {
  op: number;
  campaignId: string;
  terms?: string;
  token?: string;
  policy?: number;
  payoutRoot?: string;
  unit?: bigint;
  threshold?: number;
  expiryBlock?: number;
  commitment?: string;
  secret?: string;
  noteId?: string;
  payload?: string;
  payouts?: readonly { noteId: string; token: string; amount: bigint }[];
}): string[] {
  return [
    felt(args.op),
    felt(args.campaignId),
    felt(args.terms ?? 0),
    felt(args.token ?? 0),
    felt(args.policy ?? 0),
    felt(args.payoutRoot ?? 0),
    felt(args.unit ?? 0n),
    felt(args.threshold ?? 0),
    felt(args.expiryBlock ?? 0),
    felt(args.commitment ?? 0),
    felt(args.secret ?? 0),
    felt(args.noteId ?? 0),
    felt(args.payload ?? 0),
    ...span(args.payouts ?? []),
  ];
}

export interface Strk20Action {
  readonly type: "deposit" | "transfer" | "withdraw" | "invoke";
  readonly [k: string]: unknown;
}

/**
 * Open a campaign, and join it.
 *
 * The deposit is not optional and not decoration: the pool refuses an invoke
 * that moves no value, so a create carrying nothing cannot be submitted at all.
 * Rather than pad it with a movement that means nothing, the deposit is the
 * organiser's own first pledge — which is the better arrangement anyway, since
 * whoever asks others to commit is then committed themselves.
 */
export function createActions(
  machine: string, c: CampaignCalldata, commitment: string,
  opts: { fee?: bigint } = {},
): Strk20Action[] {
  // The pool's fee is paid from the shielded balance, so the deposit has to
  // cover the pledge *and* the fee. Depositing only the pledge leaves the
  // transaction short by the fee, and the wallet reports that as nothing more
  // informative than a failed transaction.
  const fee = opts.fee ?? 0n;
  return [
    // Public tokens into the pool, as the pledger's own note.
    { type: "deposit", token: c.token, amount: felt(c.unit + fee) },
    // And out of the pool to the machine. This is the step that actually funds
    // the helper: a deposit alone leaves the value sitting in the pledger's own
    // note, where the contract's balance-delta accounting correctly sees
    // nothing. The docs put it plainly — "the pool withdraws input tokens to
    // the helper" — and without it every operation reverts on the unit check.
    { type: "withdraw", token: c.token, amount: felt(c.unit), recipient: machine },
    {
      type: "invoke",
      contract: machine,
      calldata: invoke({
        op: OP.Create,
        campaignId: c.id,
        terms: c.terms,
        token: c.token,
        policy: c.policy,
        payoutRoot: c.payoutRoot,
        unit: c.unit,
        threshold: c.threshold,
        expiryBlock: c.expiryBlock,
        commitment,
      }),
    },
  ];
}

/**
 * Pledge into a campaign.
 *
 * The deposit moves exactly one unit into the pool; the invoke hands the machine
 * a commitment and nothing else. It deliberately does not pass an amount — the
 * contract measures its own balance delta, because a helper that believes a
 * number in its own calldata strands surplus or bricks the campaign.
 */
export function commitActions(
  machine: string, campaignId: string, token: string, unit: bigint, commitment: string,
  opts: { fee?: bigint } = {},
): Strk20Action[] {
  const fee = opts.fee ?? 0n;
  return [
    { type: "deposit", token, amount: felt(unit + fee) },
    // The withdraw is what funds the helper; see `createActions`.
    { type: "withdraw", token, amount: felt(unit), recipient: machine },
    { type: "invoke", contract: machine, calldata: invoke({ op: OP.Commit, campaignId, commitment }) },
  ];
}

/**
 * Fire a campaign that reached quorum. Permissionless — there is no secret.
 *
 * For `RefundAll`, `payouts` must be empty; the contract refuses to move value
 * at all. For `BoundTreasury`, they must reproduce the set committed at creation
 * exactly, in order, or the fold differs and the transaction reverts.
 */
export function fireActions(
  machine: string,
  campaignId: string,
  opts: {
    payouts?: readonly { noteId: string; token: string; amount: bigint }[];
    /** Required for a RefundAll fire — see below. */
    token?: string;
    self?: string;
    dust?: bigint;
  } = {},
): Strk20Action[] {
  const payouts = opts.payouts ?? [];
  const invokeAction = {
    type: "invoke" as const,
    contract: machine,
    calldata: invoke({ op: OP.Fire, campaignId, payouts }),
  };

  // A RefundAll fire moves no value by design — that is the whole point of the
  // mode — but the pool will not accept an invoke that moves none. So it is
  // paired with the smallest legal movement there is: a private transfer of one
  // unit from the firer to themselves, which changes nobody's balance and exists
  // only to make the transaction well-formed.
  if (payouts.length === 0) {
    if (!opts.token || !opts.self) {
      throw new Error(
        "A refund-all fire needs `token` and `self`: the pool rejects an invoke that " +
        "moves no value, so the call must be paired with a self-transfer.",
      );
    }
    return [
      { type: "transfer", token: opts.token, amount: felt(opts.dust ?? 1n), recipient: opts.self },
      invokeAction,
    ];
  }
  return [invokeAction];
}

/**
 * Take a pledge back — after expiry below quorum, or after a `RefundAll` fire.
 *
 * Mints an open note first: the refund has to land somewhere, and the wallet
 * fills in its id. The only operation a participant can perform entirely alone,
 * deliberately, since it is the guarantee that makes pledging safe.
 */
export function reclaimActions(
  machine: string, campaignId: string, token: string, secret: string,
): Strk20Action[] {
  return [
    { type: "transfer", token, amount: "OPEN", recipient: POOL_ADDRESS },
    {
      type: "invoke",
      contract: machine,
      calldata: invoke({ op: OP.Reclaim, campaignId, secret, noteId: OPEN_NOTE_0 }),
    },
  ];
}

/**
 * Publish a sealed payload, which the chain accepts only once the campaign has
 * fired. Below quorum this reverts — the contract refuses a disclosure even from
 * someone who has decided to make one, and that refusal is what protects
 * whoever would otherwise be first.
 */
export function unsealActions(
  machine: string, campaignId: string, secret: string, payload: string,
): Strk20Action[] {
  return [
    { type: "invoke", contract: machine, calldata: invoke({ op: OP.Unseal, campaignId, secret, payload }) },
  ];
}
