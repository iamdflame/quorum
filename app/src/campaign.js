import {
  prepareCampaign, createActions, commitActions, fireActions, reclaimActions,
  shieldActions, pledgeSecretMessage, pledgeKeyFromSignature, blocksFor, DAY,
} from "quorum-protocol";

/**
 * Driving a campaign from the browser.
 *
 * Every operation is one pool transaction and every pool transaction carries a
 * STARK proof. The wallet generates it, which is the only route open — the
 * mainnet proving-service URL is unpublished, so the SDK route is closed to
 * every team in the sprint.
 *
 * The wallet is slow at this. A prepare can take tens of seconds and looks
 * exactly like a hang, so each step reports what it is waiting for.
 */

/**
 * Addresses, normalised for the Wallet API.
 *
 * `ADDRESS` is `FELT`, and FELT's pattern is
 * `^0x(0|[a-fA-F1-9]{1}[a-fA-F0-9]{0,62})$` — which **forbids leading zeros**
 * except for a bare `0x0`. Starknet addresses are conventionally written padded
 * to 64 hex digits, so the canonical form of this contract, `0x0079bab0…`,
 * is rejected by the wallet before it ever tries to prove: the payload never
 * reaches the pool and the error is `INVALID_REQUEST_PAYLOAD`, which says
 * nothing about which field was wrong.
 *
 * Calldata happened to be fine because it goes through a hex conversion that
 * strips zeros. The address fields did not. Everything is normalised here so
 * the difference cannot bite again.
 */
const unpad = (a) => "0x" + BigInt(a).toString(16);

export const MACHINE = unpad("0x00dca84ff35ee793c69c983abfc29e3e1aa8790f7dcd7e0288b705f600fcdaf7");
export const STRK = unpad("0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d");
/** The padded form, for explorer links and anything shown to a person. */
export const MACHINE_DISPLAY = "0x00dca84ff35ee793c69c983abfc29e3e1aa8790f7dcd7e0288b705f600fcdaf7";
export const POOL_FEE_STRK = 6n;

/** Errors from wallets arrive in shapes that `String()` flattens to nothing. */
export function describeError(err) {
  const parts = [];
  if (err?.message) parts.push(err.message);
  if (err?.code !== undefined) parts.push(`code ${err.code}`);
  if (err?.data) parts.push(typeof err.data === "string" ? err.data : JSON.stringify(err.data));
  if (parts.length === 0) {
    try { parts.push(JSON.stringify(err)); } catch { parts.push(String(err)); }
  }
  const t = parts.join(" · ");
  return t === "{}" || t === "" ? "The wallet rejected the call without saying why." : t;
}

/**
 * Submit a set of STRK20 actions.
 *
 * `strk20InvokeTransaction` does the whole thing in one wallet call: it shows
 * the approval UI, generates the SNIP-36 proof, **adds the fee action**, and
 * submits.
 *
 * We previously did this in two steps — `strk20PrepareInvoke` and then
 * `executeWithProof` — and it failed on chain with `EMPTY_PROOF_FACTS` every
 * time. The proof came back populated and the facts were lost in the handoff:
 * when `executeWithProof` is not accepted, falling back to `account.execute`
 * with the proof in the options submits a transaction *without* attaching it,
 * so the pool sees no facts at all. The two-step path was also never adding the
 * fee action the wallet adds for itself.
 *
 * One call has none of those seams, which is why it is the one the wallet
 * documents.
 */
async function submit(account, actions, say) {
  say("Sending to the wallet. It will show an approval, then generate a STARK proof — this is slow.");
  const res = await account.strk20InvokeTransaction(actions);
  const hash = res?.transaction_hash;
  if (!hash) throw new Error("The wallet returned no transaction hash.");
  return hash;
}

/** Derive this wallet's pledge key for a campaign. Nothing is stored. */
/** Fail loudly rather than hanging forever on a wallet that never answers. */
function withTimeout(promise, ms, what) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(
        `${what} did not answer within ${Math.round(ms / 1000)}s. If the wallet showed no ` +
        "prompt, it rejected the request before displaying it.")), ms)),
  ]);
}

export async function derivePledgeKey(account, campaignId, chainId, nonce = 0) {
  const msg = pledgeSecretMessage(campaignId, chainId);
  const signature = await withTimeout(account.signMessage(msg), 90_000, "The signature request");
  // Wallets return this in several shapes: a bare array, an object with a
  // `signature` field, or `{ r, s }`. All of them arrive as decimal strings.
  const sig = Array.isArray(signature)
    ? signature
    : Array.isArray(signature?.signature)
      ? signature.signature
      : [signature?.r, signature?.s].filter((x) => x !== undefined);
  if (sig.length === 0) {
    throw new Error("The wallet returned a signature in a shape we do not recognise.");
  }
  return pledgeKeyFromSignature(campaignId, sig, nonce);
}

/**
 * Bring enough into the pool to cover both the pledge and the fee.
 *
 * The pool's 6 STRK fee is paid from the *shielded* balance, not from public
 * STRK — the same way the first shield of 10 STRK left only 4. So a transaction
 * that deposits exactly one unit and then owes six in fees fails on a balance
 * the user did not know they were short of, and the wallet reports it only as
 * a failed transaction.
 *
 * Depositing the unit plus the fee makes each operation self-funding, so it
 * cannot depend on what happens to be shielded already.
 */
export const FEE_WEI = 6n * 10n ** 18n;

/**
 * Shield STRK, as its own transaction.
 *
 * Every later step spends notes this creates, and a note is only spendable ten
 * blocks after it is created — so this cannot be folded into them. Shield
 * generously: each pool transaction also costs a six STRK fee, taken from the
 * shielded balance rather than from public STRK.
 */
export async function shield(account, amount, say) {
  return submit(account, shieldActions(STRK, amount), say);
}

export async function createCampaign(account, spec, currentBlock, chainId, say) {
  const calldata = prepareCampaign(spec, currentBlock);
  // Opening a campaign is joining it: the pool refuses an invoke that moves no
  // value, so the organiser's deposit is their own first pledge.
  say("Deriving your pledge key — sign the message. Nothing is stored.");
  const key = await derivePledgeKey(account, spec.id, chainId, 0);
  const hash = await submit(account, createActions(MACHINE, calldata, key.commitment), say);
  return { hash, calldata, key };
}

export async function pledge(account, campaignId, unit, commitment, say) {
  return submit(account, commitActions(MACHINE, campaignId, STRK, unit, commitment), say);
}

/**
 * Permissionless — there is no secret, so anyone watching can do this.
 *
 * A refund-all fire moves no value, and the pool will not accept an invoke that
 * moves none, so it is paired with a one-wei transfer from the firer to
 * themselves. It changes nobody's balance and exists only to make the
 * transaction well-formed.
 */
export async function fire(account, campaignId, payouts, say) {
  const self = "0x" + BigInt(account.address).toString(16);
  const opts = payouts?.length ? { payouts } : { token: STRK, self };
  return submit(account, fireActions(MACHINE, campaignId, opts), say);
}

export async function reclaim(account, campaignId, secret, say) {
  return submit(account, reclaimActions(MACHINE, campaignId, STRK, secret), say);
}

/** A sensible default campaign: refund-all, two pledges, a week to gather. */
export function defaultSpec(id, currentBlock) {
  return {
    id,
    terms: {
      statement: "We will not accept the new contract.",
      action: "Reaching quorum opens the set to the people in it. No value moves.",
      organiser: "shop floor",
    },
    token: STRK,
    unit: 1_000_000_000_000_000_000n,      // 1 STRK
    threshold: 2,
    expiryBlock: currentBlock + blocksFor(7 * DAY),
    policy: { kind: "RefundAll" },
  };
}
