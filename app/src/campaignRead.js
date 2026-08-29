import { RPC } from "./wallet.js";

export const MACHINE = "0x00dca84ff35ee793c69c983abfc29e3e1aa8790f7dcd7e0288b705f600fcdaf7";
// starknet_keccak("get_campaign")
const GET_CAMPAIGN = "0x333358710919613a34f18567332063b09711678bab1f50754e4f8f7fd637a8e";

export const PHASES = ["Void", "Open", "Fired", "Refunding"];
export const POLICIES = ["RefundAll", "BoundTreasury"];

/*
 * `get_campaign` returns the Campaign struct flattened, in declaration order:
 *
 *   0 phase   1 token       2 terms        3 policy    4 payout_root  5 unit
 *   6 threshold  7 pledge_count  8 pledge_root  9 escrowed  10 expiry_block
 *
 * Reading these by position is brittle by nature, so the mapping is written out
 * rather than left implicit — a field inserted in the contract shifts everything
 * after it, and the failure is silently wrong numbers rather than an error.
 */

export function toFelt(v) {
  const t = String(v).trim();
  if (/^0[xX][0-9a-fA-F]+$/.test(t)) return t;
  let hex = "0x";
  for (const ch of t) hex += ch.charCodeAt(0).toString(16).padStart(2, "0");
  return hex;
}

/**
 * Read one campaign straight from mainnet.
 *
 * Deliberately needs no wallet. Reading is a public act — a participant deciding
 * whether to join, a journalist checking a claim, or the counterparty on the
 * other side of the campaign all have to be able to do it without announcing
 * themselves first. Only *pledging* needs a prover.
 */
export async function readCampaign(id) {
  const r = await fetch(RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0", id: 1, method: "starknet_call",
      params: [{
        contract_address: MACHINE,
        entry_point_selector: GET_CAMPAIGN,
        calldata: [toFelt(id)],
      }, "latest"],
    }),
  });
  const j = await r.json();
  if (j.error) throw new Error(j.error.message ?? "call failed");
  const v = j.result;
  return {
    phase: PHASES[Number(BigInt(v[0]))] ?? "unknown",
    token: v[1],
    terms: v[2],
    policy: POLICIES[Number(BigInt(v[3] ?? "0x0"))] ?? "unknown",
    payoutRoot: v[4],
    unit: BigInt(v[5] ?? "0x0"),
    threshold: Number(BigInt(v[6] ?? "0x0")),
    count: Number(BigInt(v[7] ?? "0x0")),
    root: v[8],
    escrowed: BigInt(v[9] ?? "0x0"),
    expiry: Number(BigInt(v[10] ?? "0x0")),
  };
}

/** STRK is 18 decimals; show enough to be exact without a wall of zeros. */
export function strk(wei) {
  const whole = wei / 10n ** 18n;
  const frac = (wei % 10n ** 18n).toString().padStart(18, "0").slice(0, 4).replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : String(whole);
}
