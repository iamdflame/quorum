import { hash, shortString, num } from "starknet";

/**
 * Commitments, and where the secrets behind them come from.
 *
 * Every pledge is stored on-chain against `poseidon(REFUND_TAG, secret)`. That
 * secret is the pledger's only claim on their own money: lose it and the refund
 * is unreachable, because the contract deliberately has no idea who they are and
 * so has nobody to fall back to.
 *
 * A system whose safety net depends on a user not losing a random string does
 * not have a safety net. So secrets here are never random — they are **derived
 * from a signature the wallet can always reproduce**. Nothing to write down,
 * nothing to back up, nothing to lose. Reinstall the wallet on a new machine and
 * the same secret falls out.
 *
 * This is the difference between a mechanism that works in a demo and one a
 * person can be advised to put a month's rent behind.
 */

/** Domain tags, matching `contracts/src/quorum.cairo` exactly. */
export const TAGS = {
  pledgeAcc: shortString.encodeShortString("QUORUM_PLEDGE_ACC"),
  payoutAcc: shortString.encodeShortString("QUORUM_PAYOUT_ACC"),
  refund: shortString.encodeShortString("QUORUM_REFUND"),
} as const;

/**
 * Encode a value as a felt.
 *
 * Three cases, each failing differently if mishandled:
 *
 * - **Wallet placeholders** (`${openNoteIds[0]}`) pass through untouched. They
 *   are substituted by the wallet during action assembly; converting them
 *   produces calldata that is silently wrong rather than rejected.
 * - **Names** become Cairo short strings, so a campaign can be called
 *   `walkout-2026` rather than a hex blob. Over 31 characters will not fit and
 *   is refused loudly instead of truncated.
 * - **Numbers and hex** convert directly.
 */
export function toFelt(v: string | number | bigint): string {
  if (typeof v === "string") {
    if (v.startsWith("${")) return v;
    if (!/^0[xX][0-9a-fA-F]*$/.test(v)) {
      if (v.length > 31) {
        throw new Error(
          `"${v}" is ${v.length} characters; a Cairo short string holds 31. ` +
          "Shorten it, or pass a felt directly.",
        );
      }
      return shortString.encodeShortString(v);
    }
  }
  return num.toHex(v);
}

/** Poseidon over felts. Pinned against the Cairo implementation by a test in both. */
export function poseidon(...elements: (string | number | bigint)[]): string {
  return hash.computePoseidonHashOnElements(elements.map(toFelt));
}

/**
 * Fold a payout set the way the contract does.
 *
 * This is what makes theft impossible rather than merely detectable. The root is
 * committed at creation, before a single pledge exists, and fire must reproduce
 * it exactly — so every pledger can see where the money can go before they put
 * any in, and nobody can change it afterwards.
 *
 * The fold is order-dependent, so the same destinations in a different sequence
 * are a different set.
 */
export function payoutRoot(
  payouts: readonly { noteId: string | number | bigint; token: string | number | bigint; amount: bigint }[],
): string {
  let root: string | number | bigint = 0n;
  for (const p of payouts) root = poseidon(TAGS.payoutAcc, root, p.noteId, p.token, p.amount);
  return num.toHex(root);
}

/** `poseidon(REFUND_TAG, secret)` — the key a pledge is stored under. */
export function refundCommitment(secret: string | number | bigint): string {
  return poseidon(TAGS.refund, secret);
}

/** One step of the on-chain fold. Order-dependent, so it fixes a sequence. */
export function foldPledge(root: string | number | bigint, commitment: string | number | bigint): string {
  return poseidon(TAGS.pledgeAcc, root, commitment);
}

/** Replay the whole fold, to verify a root without trusting the chain's arithmetic. */
export function pledgeRoot(commitments: readonly (string | number | bigint)[]): string {
  let root: string | number | bigint = 0n;
  for (const c of commitments) root = foldPledge(root, c);
  return num.toHex(root);
}

/**
 * The message a wallet signs to derive a pledge secret.
 *
 * Bound to the campaign so one signature cannot be replayed across campaigns,
 * and typed rather than a raw hash so the wallet can show the user what they are
 * signing instead of an opaque blob.
 */
export function pledgeSecretMessage(campaignId: string, chainId: string) {
  return {
    domain: { name: "Quorum", version: "1", chainId, revision: "1" },
    message: {
      purpose: "Derive the secret that lets you reclaim this pledge",
      campaign: campaignId,
    },
    primaryType: "PledgeKey",
    types: {
      StarknetDomain: [
        { name: "name", type: "shortstring" },
        { name: "version", type: "shortstring" },
        { name: "chainId", type: "shortstring" },
        { name: "revision", type: "shortstring" },
      ],
      PledgeKey: [
        { name: "purpose", type: "string" },
        { name: "campaign", type: "felt" },
      ],
    },
  };
}

/**
 * Turn a wallet signature into a pledge secret, bound to one campaign.
 *
 * Two things matter here and the first version had only one of them.
 *
 * The signature is hashed rather than used directly: encodings differ between
 * wallets and account classes, and a raw `r` would leak anywhere the same
 * message is signed again.
 *
 * It is also **bound to the campaign id**. Without that, one wallet derives the
 * same secret everywhere, so a single leaked pledge — a screenshot, a support
 * ticket, a seized laptop — unlocks that person's pledge in every campaign they
 * ever joined, including ones nobody knew they were in. Domain separation here
 * is the difference between losing one pledge and losing a history.
 */
export function secretFromSignature(
  signature: readonly (string | number | bigint)[],
  campaignId: string | number | bigint,
  nonce: number = 0,
): string {
  if (signature.length === 0) throw new Error("Empty signature: nothing to derive from.");
  return poseidon(TAGS.refund, campaignId, nonce, poseidon(...signature));
}

/**
 * Everything a pledger needs to keep — which is nothing, because all of it is
 * recomputable from the wallet.
 */
export interface PledgeKey {
  readonly campaignId: string;
  readonly secret: string;
  readonly commitment: string;
}

/**
 * `nonce` lets one wallet hold more than one pledge in a campaign.
 *
 * That is the sybil the fixed unit prices rather than forbids — the contract
 * cannot tell two wallets from one, so it charges a full unit either way. It is
 * also simply necessary: a campaign has to be testable by one person before it
 * is trusted by forty.
 */
export function pledgeKeyFromSignature(
  campaignId: string, signature: readonly (string | number | bigint)[], nonce = 0,
): PledgeKey {
  const secret = secretFromSignature(signature, campaignId, nonce);
  return { campaignId, secret, commitment: refundCommitment(secret) };
}
