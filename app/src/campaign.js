import {
  prepareCampaign, createActions, commitActions, fireActions, reclaimActions,
  pledgeSecretMessage, pledgeKeyFromSignature, blocksFor, DAY,
} from "@quorum/protocol";

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

export const MACHINE = unpad("0x0079bab03056fd05dde50e921cf5ea8c3405aaaa2f05492a8a0e1fb6c811ff76");
export const STRK = unpad("0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d");
/** The padded form, for explorer links and anything shown to a person. */
export const MACHINE_DISPLAY = "0x0079bab03056fd05dde50e921cf5ea8c3405aaaa2f05492a8a0e1fb6c811ff76";
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

/** Submit a set of STRK20 actions, proving through the wallet. */
async function submit(account, actions, say) {
  say("Building and proving. The wallet is generating a STARK proof — this is slow.");
  const prepared = await account.strk20PrepareInvoke(actions);
  if (!prepared?.call) throw new Error("The wallet returned no call to submit.");

  say("Proof ready. Submitting to Starknet…");
  let res;
  try {
    res = await account.executeWithProof(prepared.call, prepared.proof);
  } catch (inner) {
    // Wallets differ on which submission form they accept; the documented
    // alternative spreads the proof into execution options.
    console.warn("[quorum] executeWithProof refused, trying execute()", inner);
    res = await account.execute(prepared.call, {
      proof: prepared.proof?.data, proofFacts: prepared.proof?.proof_facts,
    });
  }
  const hash = res?.transaction_hash;
  if (!hash) throw new Error("Submitted, but the wallet returned no transaction hash.");
  return hash;
}

/** Derive this wallet's pledge key for a campaign. Nothing is stored. */
export async function derivePledgeKey(account, campaignId, chainId, nonce = 0) {
  const msg = pledgeSecretMessage(campaignId, chainId);
  const signature = await account.signMessage(msg);
  const sig = Array.isArray(signature) ? signature : (signature?.signature ?? []);
  return pledgeKeyFromSignature(campaignId, sig, nonce);
}

export async function createCampaign(account, spec, currentBlock, say) {
  const calldata = prepareCampaign(spec, currentBlock);
  return { hash: await submit(account, createActions(MACHINE, calldata), say), calldata };
}

export async function pledge(account, campaignId, unit, commitment, say) {
  return submit(account, commitActions(MACHINE, campaignId, STRK, unit, commitment), say);
}

/** Permissionless. There is no secret, so anyone watching can do this. */
export async function fire(account, campaignId, payouts, say) {
  return submit(account, fireActions(MACHINE, campaignId, payouts), say);
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
