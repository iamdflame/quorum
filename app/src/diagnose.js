import { MACHINE, STRK } from "./campaign.js";

/**
 * Find out which action shapes this wallet will accept, without spending anything.
 *
 * `strk20PrepareInvoke(actions, simulate)` in simulate mode returns the proof
 * fields present but empty — the call is not submittable, which makes it a free
 * probe. `INVALID_REQUEST_PAYLOAD` names no field, so the only way to learn what
 * is wrong is to vary one thing at a time and watch which variant the wallet
 * stops refusing.
 */

const felt = (n) => "0x" + BigInt(n).toString(16);
const ONE_STRK = felt(10n ** 18n);

/**
 * Encode an ASCII name as a Cairo short string.
 *
 * `Buffer` does not exist in a browser — it is Node's, and reaching for it here
 * made four of five probes fail on our own code before the wallet ever saw them.
 */
function shortString(text) {
  let hex = "";
  for (const ch of text) {
    const c = ch.codePointAt(0);
    if (c > 0xff) throw new Error(`"${text}" is not ASCII; a short string cannot hold it.`);
    hex += c.toString(16).padStart(2, "0");
  }
  if (hex.length > 62) throw new Error(`"${text}" is longer than 31 characters.`);
  return "0x" + (hex.replace(/^0+/, "") || "0");
}

/** Thirteen fixed params then an empty payout span — a Create, structurally. */
function createCalldata(id) {
  return [
    "0x0",                       // QuorumOp::Create
    shortString(id),
    "0x1",                       // terms
    STRK,                        // token
    "0x0",                       // policy: RefundAll
    "0x0",                       // payout_root
    ONE_STRK,                    // unit
    "0x2",                       // threshold
    felt(99_999_999),            // expiry
    "0x0", "0x0", "0x0", "0x0",  // commitment, secret, note_id, payload
    "0x0",                       // payouts: empty span
  ];
}

/**
 * `recipient` on a transfer is typed `ADDRESS`, not a calldata item.
 * `${poolAddress}` and `${openNoteIds[N]}` are `STRK20_CALLDATA_ITEM`s — the
 * wallet substitutes them while assembling *calldata*, and nowhere else. Passing
 * one as a recipient is a type error the schema catches and the error message
 * does not explain.
 */
export const PROBES = [
  {
    name: "deposit alone",
    why: "The simplest thing that moves value. If this fails, nothing will.",
    actions: () => [{ type: "deposit", token: STRK, amount: ONE_STRK }],
  },
  {
    name: "invoke alone",
    why: "What Create currently sends. An invoke with no value movement.",
    actions: (id) => [{ type: "invoke", contract: MACHINE, calldata: createCalldata(id) }],
  },
  {
    name: "deposit + invoke",
    why: "An invoke that accompanies value, which is how the docs describe it.",
    actions: (id) => [
      { type: "deposit", token: STRK, amount: ONE_STRK },
      { type: "invoke", contract: MACHINE, calldata: createCalldata(id) },
    ],
  },
  {
    name: "open note to self + invoke",
    why: "An open note for a result to land in, addressed to a real account rather than a placeholder.",
    actions: (id, self) => [
      { type: "deposit", token: STRK, amount: ONE_STRK },
      { type: "transfer", token: STRK, amount: "OPEN", recipient: self },
      { type: "invoke", contract: MACHINE, calldata: createCalldata(id) },
    ],
  },
  {
    name: "open note to self, no deposit",
    why: "Whether an open note counts as the value movement an invoke needs.",
    actions: (id, self) => [
      { type: "transfer", token: STRK, amount: "OPEN", recipient: self },
      { type: "invoke", contract: MACHINE, calldata: createCalldata(id) },
    ],
  },
  {
    name: "deposit + withdraw to machine + invoke",
    why: "The documented sandwich: value out of the pool to the helper, then the call. This is what a real create sends.",
    actions: (id) => [
      { type: "deposit", token: STRK, amount: ONE_STRK },
      { type: "withdraw", token: STRK, amount: ONE_STRK, recipient: MACHINE },
      { type: "invoke", contract: MACHINE, calldata: createCalldata(id) },
    ],
  },
  {
    name: "withdraw to machine + invoke",
    why: "Same, for someone whose STRK is already shielded and needs no deposit.",
    actions: (id) => [
      { type: "withdraw", token: STRK, amount: ONE_STRK, recipient: MACHINE },
      { type: "invoke", contract: MACHINE, calldata: createCalldata(id) },
    ],
  },
  {
    name: "transfer to self + invoke",
    why: "A plain private transfer as the accompanying movement, instead of a deposit.",
    actions: (id, self) => [
      { type: "transfer", token: STRK, amount: ONE_STRK, recipient: self },
      { type: "invoke", contract: MACHINE, calldata: createCalldata(id) },
    ],
  },
  {
    name: "invoke with a padded address",
    why: "Confirms whether address padding is what the wallet objects to.",
    actions: (id) => [{
      type: "invoke",
      contract: "0x00dca84ff35ee793c69c983abfc29e3e1aa8790f7dcd7e0288b705f600fcdaf7",
      calldata: createCalldata(id),
    }],
  },
];

function describe(err) {
  const parts = [];
  if (err?.message) parts.push(err.message);
  if (err?.code !== undefined) parts.push(`code ${err.code}`);
  if (err?.data) parts.push(typeof err.data === "string" ? err.data : JSON.stringify(err.data));
  return parts.join(" · ") || "refused without a reason";
}

/** Run every probe in simulate mode. Nothing is signed and nothing is spent. */
export async function runProbes(account, id, onResult) {
  const self = "0x" + BigInt(account.address).toString(16);
  for (const p of PROBES) {
    try {
      const res = await account.strk20PrepareInvoke(p.actions(id, self), true);
      onResult({ name: p.name, why: p.why, ok: true,
        detail: res?.call ? "accepted — the wallet built a call" : "accepted, no call returned" });
    } catch (err) {
      onResult({ name: p.name, why: p.why, ok: false, detail: describe(err) });
    }
  }
}
