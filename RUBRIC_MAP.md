# Rubric map

Where each judging criterion is satisfied, by file, test and transaction. Run `npm run verify` to check every on-chain claim below against the chain; it exits non-zero if any of them has drifted.

---

## STRK20 integration depth — 30%

**A real `privacy_invoke` anonymizer, not a wrapper around shield/transfer.**

| | |
|---|---|
| The contract | [`contracts/src/quorum.cairo`](contracts/src/quorum.cairo) — five operations over committed state, driven by the pool through `INVOKE_SELECTOR` |
| Compiled against | StarkWare's own `privacy` package, pulled from git — not a mock |
| Balance-delta accounting | [`take_delta`](contracts/src/quorum.cairo) — the pool transfers *then* calls, so amounts are measured, never read from calldata |
| Open notes | `Reclaim` returns `Span<OpenNoteDeposit>`; the refund lands in a note whose id the wallet fills in, so the dapp never learns it |
| Wallet-resolved placeholders | [`packages/protocol/src/actions.ts`](packages/protocol/src/actions.ts) — `${openNoteIds[0]}`, `${poolAddress}` |
| Live pool constants | fee and proof-validity read from the pool itself, not hardcoded |
| Cross-language conformance | `poseidon_matches_the_typescript_client` — commitments are computed in TS and checked in Cairo, and drift between them would silently strand every refund |

**Contributed back:** [#121](https://github.com/starkience/strk20-hackathon/issues/121) — a way past the SDK's unexported `ContractDiscoveryProvider`; confirmation that **Ready X implements the STRK20 wallet methods** where Braavos does not; and the finding that a shield with no exit still emits a `Withdrawal`, because the fee is settled by paying the collector.

## Working mainnet product — 30%

| | |
|---|---|
| QuorumMachine, mainnet | [`0x00dca84f…fcdaf7`](https://voyager.online/contract/0x00dca84ff35ee793c69c983abfc29e3e1aa8790f7dcd7e0288b705f600fcdaf7) |
| QuorumMachine, Sepolia | [`0x07d639ca…75fc73`](https://sepolia.voyager.online/contract/0x07d639ca00289a59a6949a12f6470feadf74d905d01bcce331f6c9d1d775fc73) |
| Class hash | `0x04a3ad94…e4d4f7` — **identical on both**, so production runs what the tests rehearsed |
| App | https://quorum-strk20.vercel.app |
| Self-check | `npm run verify` |

**A campaign ran end to end on mainnet.** Four transactions, all through QuorumMachine, all verified by `npm run verify` against the panel's own criteria — exists, succeeded, touched the STRK20 pool, ran through this project's contract:

| | | |
|---|---|---|
| Created | [`0x071d3220…`](https://voyager.online/tx/0x071d322075e75df9be35a46e36024b02c3f9c37fcaedd52a38a7391b0cf8e806) | 14,024,487 |
| Committed | [`0x03c6bd55…`](https://voyager.online/tx/0x03c6bd55104d3b05254364f369689e648ec7af6e1f849f440fdcbd9792e0dbd1) | 14,024,550 |
| Committed | [`0x018bb72d…`](https://voyager.online/tx/0x018bb72dc2b97bc028c3b22f633d2ac43e5432ae2be720652c809ef0d3ff8d22) | 14,024,626 |
| Fired | [`0x01da6af3…`](https://voyager.online/tx/0x01da6af3260615abebaa5d708c885d8017fb0de2f2001d8269203b5924bb5a8e) | 14,024,923 |

The campaign `demo-70414` reads back as `Fired`, 3 pledges against a threshold of 2, with the contract's accounting reconciling to its balance exactly.

## Innovation — 25%

**The claim:** every other project in the sprint hides a transfer between two parties who already know each other — privacy as a feature. Here privacy is load-bearing: remove it and there is no product, because there is no coordination.

| | |
|---|---|
| The mechanism | an information escrow where the escrow holds money, the count is enforced by a contract rather than trust, and nobody is exposed when it fails |
| Why a pool | on a public chain the employer reads the list; on a server the operator is a subpoena away from being the list. [README](README.md#why-this-needs-a-shielded-pool) |
| No superuser | destinations are committed at creation and firing is permissionless — `a_firer_cannot_redirect_payouts_to_themselves` |
| Sybil is priced | identity cannot be bound (the pool refuses to say who is calling), so every pledge is a fixed `unit` |
| The escrow itself | `Unseal` reverts below quorum — the chain refuses a disclosure even from someone who has decided to make one |

## Documentation and open-source quality — 15%

| | |
|---|---|
| Tests | **146** — 58 Cairo, 88 TypeScript. `cd contracts && snforge test`, `npm test` |
| The tests are adversarial | every invariant runs against an organiser trying to steal, not a cooperative one |
| The leak table | [README](README.md#what-is-public-stated-exactly) states exactly what is public, including the two real limits — timing, and a count readable through the view |
| A withdrawn claim | [DEPLOYMENTS.md](DEPLOYMENTS.md#superseded) documents the superseded contract and the hole it had, rather than quietly redeploying |
| Examples | every example in the repository runs; `archive/` builds and runs too |
| Licence | Apache-2.0, unaudited and labelled as such |

---

## The tests worth reading first

```
a_firer_cannot_redirect_payouts_to_themselves      the hole the first version had
a_refund_all_campaign_cannot_move_value_at_all     the mode with no way to steal
fire_is_permissionless_once_quorum_is_met          no key to lose, none to steal
commit_uses_the_balance_delta_not_the_calldata     the pool moves value before it calls
unseal_reverts_before_quorum                       the escrow itself
a_failed_campaign_returns_every_pledge_in_full     why anyone goes first
poseidon_matches_the_typescript_client             drift here strands every refund silently
```

## Reproduce everything

```bash
npm install
npm run build && npm test        # 74 TypeScript tests
cd contracts && snforge test     # 58 Cairo tests
npm run verify                   # every on-chain claim in this repo
node examples/linkage.mjs        # what the live pool already gives away
```
