/**
 * The STRK20 Wallet API, as this app uses it.
 *
 * Why this route at all: a private transaction must be proved, and the question
 * is only *who* reaches the prover. On the SDK route that is you, and you need a
 * proving-service URL — which is not published for mainnet
 * (starkience/strk20-hackathon#121, still open). On this route the user's wallet
 * reaches a prover itself, so the app needs a Starknet RPC URL and nothing else.
 *
 * The catch, and it is a real one: the wallet has to implement the STRK20
 * methods, and not every Starknet wallet does. Braavos answers "not implemented"
 * today. So we probe rather than assume — an approach PugarHuda documented on
 * that same issue — using the read-only method, which is safe to fire at an
 * arbitrary wallet.
 */

export const POOL = "0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a";
export const CONCLAVE = "0x0269fa8cd8a7a04f5cd5b2fda7139efebb99511e2dde4778ba9395948a62ecfc";
export const STRK = "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";

/** Charged per pool transaction. Read from the live pool's `get_fee_amount`. */
export const POOL_FEE_STRK = 6n;

/**
 * Ask a connected wallet whether it speaks STRK20.
 *
 * `wallet_strk20Balances` is the read-only one of the STRK20 methods, so calling
 * it costs nothing and changes nothing. A wallet that answers "not implemented"
 * has told us to show a different path rather than let the user discover it
 * halfway through a signature.
 */
export async function probeStrk20(walletAccount) {
  try {
    const balances = await walletAccount.strk20Balances([STRK]);
    return { supported: true, balances };
  } catch (err) {
    const msg = String(err?.message ?? err);
    return {
      supported: false,
      reason: /not implemented|unsupported|unknown method|-32601/i.test(msg)
        ? "This wallet does not implement the STRK20 methods yet."
        : msg.slice(0, 200),
    };
  }
}

/**
 * Build the actions for a shielded deposit routed through ConclaveMachine.
 *
 * Three actions, one pool transaction:
 *
 *   deposit   move public STRK into the pool
 *   transfer  amount "OPEN" mints an open note whose id the wallet fills in
 *   invoke    call ConclaveMachine, handing it that note id
 *
 * The `${openNoteIds[0]}` and `${poolAddress}` placeholders are resolved by the
 * wallet while it assembles the actions — the app never learns the note id, which
 * is the point.
 *
 * `Open` is ConclaveOp::Open = 0. The remaining calldata is the conclave id, the
 * program, the token, the seal block, the initial state root and the settlement
 * commitment, in the order `privacy_invoke` declares them.
 */
export function shieldThroughConclave({ amount, conclaveId, sealBlock, stateRoot, settleCommitment }) {
  return [
    { type: "deposit", token: STRK, amount: "0x" + amount.toString(16) },
    { type: "transfer", token: STRK, amount: "OPEN", recipient: "${poolAddress}" },
    {
      type: "invoke",
      contract: CONCLAVE,
      calldata: [
        "0x0",                     // ConclaveOp::Open
        conclaveId,
        stateRoot,                 // program
        STRK,                      // token
        "0x" + BigInt(sealBlock).toString(16),
        stateRoot,
        settleCommitment,
        "0x0", "0x0", "0x0", "0x0",
        "0x0",                     // payouts: empty span
      ],
    },
  ];
}

/** A plain shield, with no helper in the loop. The simplest thing that touches the pool. */
export function shieldOnly(amount) {
  return [{ type: "deposit", token: STRK, amount: "0x" + amount.toString(16) }];
}
