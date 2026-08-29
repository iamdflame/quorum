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

/** Thirteen fixed params then an empty payout span — a Create, structurally. */
function createCalldata(id) {
  return [
    "0x0",                       // QuorumOp::Create
    felt("0x" + Buffer.from(id, "utf8").toString("hex")),
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
    name: "deposit + open note + invoke",
    why: "The full sandwich: value in, a note for the result, then the call.",
    actions: (id) => [
      { type: "deposit", token: STRK, amount: ONE_STRK },
      { type: "transfer", token: STRK, amount: "OPEN", recipient: "${poolAddress}" },
      { type: "invoke", contract: MACHINE, calldata: createCalldata(id) },
    ],
  },
  {
    name: "invoke with a padded address",
    why: "Confirms whether address padding is what the wallet objects to.",
    actions: (id) => [{
      type: "invoke",
      contract: "0x0079bab03056fd05dde50e921cf5ea8c3405aaaa2f05492a8a0e1fb6c811ff76",
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
  for (const p of PROBES) {
    try {
      const res = await account.strk20PrepareInvoke(p.actions(id), true);
      onResult({ name: p.name, why: p.why, ok: true,
        detail: res?.call ? "accepted — the wallet built a call" : "accepted, no call returned" });
    } catch (err) {
      onResult({ name: p.name, why: p.why, ok: false, detail: describe(err) });
    }
  }
}
