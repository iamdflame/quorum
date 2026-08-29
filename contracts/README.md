# QuorumMachine

**A threshold escrow that runs inside the STRK20 privacy pool. Money moves only when enough people independently agree, and until then nobody — including the organiser — can tell who agreed or whether it will happen.**

Deployed on Starknet mainnet at [`0x00dca84ff35ee793c69c983abfc29e3e1aa8790f7dcd7e0288b705f600fcdaf7`](https://voyager.online/contract/0x00dca84ff35ee793c69c983abfc29e3e1aa8790f7dcd7e0288b705f600fcdaf7), and on Sepolia at [`0x07d639ca…`](https://sepolia.voyager.online/contract/0x07d639ca00289a59a6949a12f6470feadf74d905d01bcce331f6c9d1d775fc73) running byte-identical code.

Class hash `0x04a3ad9409c4f4acc72b9fda88410161044e44eb2aa6ab403d08d3ac7de4d4f7` on both. `npm run verify` checks that from chain rather than asking you to believe it.

---

## What it is for, generally

Any situation where **stating your intent early is what costs you**.

- A funding round that only closes if it fills — and where a visible half-empty round is what stops it filling.
- A group buy where the seller must not learn the size of the group before the price is set.
- A strike fund, a bond, a class action, a bribe-resistant vote: anything where the first signatures are the ones taking the risk.

The standard on-chain answer is an escrow that everyone can watch. Watching is the problem. A pledge visible the moment it lands tells the counterparty exactly how much pressure they are under, and tells everyone else whether it is safe to join yet. Quorum makes pledges **countable but not attributable**: the chain records that a pledge exists and that the threshold was honoured. It does not record whose it was.

## The primitive

Five operations, dispatched through one `privacy_invoke` entry point because that is the shape the pool calls.

| | |
|---|---|
| `Create` | opens a campaign and **carries the organiser's own first pledge** — the pool rejects a value-less invoke, and an organiser who has not staked anything is not an organiser |
| `Commit` | adds a pledge. The amount is taken from the balance delta, never from calldata |
| `Fire` | executes the payouts, **permissionless**, once the threshold is met |
| `Reclaim` | returns a pledge, under `RefundAll`, to whoever holds the secret |
| `Unseal` | reveals the campaign after the fact |

### Two things worth stealing

**Payouts are committed at creation, not chosen at execution.**

An earlier version let the organiser name the recipients when firing. That is a superuser: anyone who can pick the destination at execution time can pick themselves, and every pledge in the contract is theirs the moment the threshold is met. Now `payout_root` is a Poseidon fold over the exact payout list, fixed when the campaign opens. `Fire` recomputes the fold from the payouts it was handed and rejects anything that does not match.

The fold is **order-dependent**, deliberately. Two payouts of the same amounts in a different order are a different commitment, because "who gets paid first out of a partial balance" is a real difference and a permutation is a real attack. Tests: `a_firer_cannot_redirect_payouts_to_themselves`, `a_firer_cannot_skim_a_slice_to_themselves`, `payout_order_is_part_of_the_commitment`.

**Amounts come from the balance delta, never from calldata.**

```cairo
fn take_delta(ref self: ContractState, token: ContractAddress) -> u128 {
    let actual = IERC20Dispatcher { contract_address: token }
        .balance_of(get_contract_address());
    let known = self.held.read(token);
    let delta = actual - known;
    self.held.write(token, actual);
    delta
}
```

A caller who says they pledged 100 and sent 1 gets credited with 1. `held` is also readable, so the contract's own accounting can be reconciled against its real ERC-20 balance from outside — stranded value is visible rather than silent. `npm run verify` checks exactly that, and checks it is *equal*, not that it is zero: a live `RefundAll` campaign holds pledges until they are reclaimed, and an assertion of zero would be wrong.

### Firing is permissionless on purpose

Once the threshold is met, anyone can fire, and firing requires no secret. If only the organiser could fire, the organiser could hold a met quorum hostage. The commitment to `payout_root` is what makes this safe: a stranger firing your campaign cannot change where the money goes.

## Verifying rather than trusting

`quorum_reached` is public, the payout fold is reproducible off-chain, and [`@quorum/protocol`](../packages/protocol) recomputes it in TypeScript. `verifyCampaign` replays the accumulator and distinguishes **"cannot verify"** from **"verified false"** — collapsing those two into one boolean is how verification tools end up reassuring people about things they never checked.

One test pins the two implementations together: `poseidon_matches_the_typescript_client`. If the Cairo and the TypeScript ever disagree about a commitment, that test fails rather than the user finding out at fire time.

## Building

```bash
cd contracts
scarb build
snforge test        # 51 tests
```

Scarb 2.20.1, Cairo 2.20, Starknet Foundry 0.63.0.

The tests are adversarial rather than illustrative — they are mostly attempts to steal from the contract or to lie to it, and each one is named after the attack it fails to perform.

## Known limitation, stated plainly

`Reclaim` returns value through an **open note** (`amount: "OPEN"`). The contract path is correct and tested, but the Ready wallet rejects open-note actions in every combination we could construct, so the refund leg cannot currently be driven from that wallet. This is a wallet limitation rather than a contract one, and it is reported upstream. Nothing else in the lifecycle depends on it.

## Licence

Apache-2.0.
