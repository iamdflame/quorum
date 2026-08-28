<div align="center">

<img src=".github/assets/logo.svg" alt="Quorum — nobody moves until enough of us do" width="100%">

<br>

**[Live app](https://quorum-alpha-drab.vercel.app)** &nbsp;·&nbsp;
**[Contract on mainnet](https://voyager.online/contract/0x06d3f070a8732b1272ac7e73527187ce08da502839b18fc30a481a79512b8c08)** &nbsp;·&nbsp;
**[The adversarial tests](contracts/tests/quorum_test.cairo)** &nbsp;·&nbsp;
**[How it works](https://quorum-alpha-drab.vercel.app/how)**

<br>

![Cairo](https://img.shields.io/badge/Cairo-2.20-E2661A?style=flat-square&labelColor=0B0A08)
![Tests](https://img.shields.io/badge/tests-157%20passing-E2661A?style=flat-square&labelColor=0B0A08)
![Mainnet](https://img.shields.io/badge/Starknet-mainnet-E2661A?style=flat-square&labelColor=0B0A08)
![STRK20](https://img.shields.io/badge/STRK20-anonymizer-E2661A?style=flat-square&labelColor=0B0A08)
![Licence](https://img.shields.io/badge/licence-Apache--2.0-6E6960?style=flat-square&labelColor=0B0A08)

</div>

<br>

> **Pledge into a campaign and your pledge binds only once enough others have pledged too.**
> If the quorum is never reached, you get your money back and you were never revealed.

<br>

## The problem

There is a class of action nobody can take alone.

You cannot unionise publicly — you are fired. You cannot report a serial harasser alone — you are destroyed and they are not. You cannot commit to a boycott alone — it fails, and you are marked as the one who tried. You cannot be the first name on a class action.

In every case the obstacle is identical, and it is not secrecy for its own sake:

> **The first mover carries all the risk and receives none of the benefit.**

So nobody moves, and an action a majority privately wants never happens. Economists call this a collective action problem. Everyone else calls it Tuesday.

A threshold inverts the payoff. If your commitment binds only once enough others have committed, going first costs nothing. The mechanism is decades old — Ayres and Nalebuff described **information escrows** for exactly this, and Callisto built one for campus assault reports that opens only when a second report names the same person.

What has never existed is a way to run it where the escrow holds **real money**, the count is enforced by **something other than trust**, and **nobody is exposed when it fails**.

<br>

## Why this needs a shielded pool

|  | What breaks |
|---|---|
| **On a public chain** | Every pledge is public. The employer reads the list before it is long enough to protect anyone. The mechanism defeats itself. |
| **On a server** | The operator is a single point of coercion. A subpoena, a court order, a bribe, or one disgruntled engineer unmasks everyone at once. |
| **On the STRK20 pool** | A pledge is an encrypted note. Value moves without naming who moved it, escrow is held by a contract rather than a company, and settlement is atomic. |

> The privacy is not a feature bolted onto a coordination app.
> **Remove it and there is no product, because there is no coordination.**

<br>

## What the contract enforces

Everything rests on one sentence said to a person deciding whether to risk their job: *if the quorum is not reached, you get your money back and you are never revealed.* So [`QuorumMachine`](contracts/src/quorum.cairo) enforces it rather than promising it.

| Invariant | Meaning |
|---|---|
| **Threshold enforcement** | A campaign cannot fire below quorum. Not "should not" — the transaction reverts. |
| **Refund safety** | Once expired, refunds are the *only* remaining path. |
| **Value conservation** | Payouts sum to exactly what was escrowed, in the token escrowed. |
| **Pledge-set immutability** | Pledges fold into an order-dependent root, fixing the set as a sequence. |
| **Single-use reclaim** | A refund needs that pledge's own preimage, and burns it. |

All of it holds against an organiser who **holds the fire secret and wants to steal**. They can misdirect an outcome; they cannot create value, cannot fire a campaign that failed, and cannot stop refunds once it has.

Two invariants exist specifically because their absence is exploitable:

**A met quorum still cannot fire late.** Without it, an organiser who reached quorum sits on a signed list indefinitely and uses it as leverage — *"I have forty names, and I decide when they become public."* Expiry ends that; the money goes back.

**A pledge cannot be withdrawn before the deadline.** Otherwise a pledger watches the count and defects just before quorum, reintroducing the collective action problem through the back door.

<br>

## The tests are the product

A coordination mechanism is worth nothing unless it holds when the person running the campaign turns on the people in it. The adversarial cases *are* the suite; the happy path is almost incidental.

```
a_campaign_cannot_fire_below_its_quorum                     PASS
a_quorum_that_was_met_still_cannot_fire_late                PASS
a_malicious_organiser_cannot_pay_out_more_than_was_pledged  PASS
an_organiser_cannot_strand_value_by_underpaying             PASS
an_organiser_cannot_pay_in_an_asset_never_pledged           PASS
a_failed_campaign_returns_every_pledge_in_full              PASS
a_pledge_cannot_be_withdrawn_before_the_deadline            PASS
a_fired_campaign_cannot_also_be_reclaimed                   PASS
a_pledge_can_only_be_reclaimed_once                         PASS
a_stranger_cannot_reclaim_someone_elses_pledge              PASS
the_same_pledge_cannot_be_counted_twice                     PASS
the_root_depends_on_order_not_just_membership               PASS
poseidon_matches_the_typescript_client                      PASS
```

**157 tests — 43 Cairo, 114 TypeScript.**

That last one earns its place. Commitments are computed in TypeScript and checked in Cairo. If those two Poseidon implementations ever disagree, *nothing throws* — pledges silently become unreclaimable and campaigns silently cannot fire. For a system whose entire promise is that you can always get your money back, that is the worst available failure. Both sides now assert fixed vectors.

<br>

## Deployed

| Network | Address |
|---|---|
| **Mainnet** | [`0x06d3f070a8732b1272ac7e73527187ce08da502839b18fc30a481a79512b8c08`](https://voyager.online/contract/0x06d3f070a8732b1272ac7e73527187ce08da502839b18fc30a481a79512b8c08) |
| **Sepolia** | [`0x01281b5f8e26c1ec0ab5fc439b1c23e1e37f183438a7b148b2894436f940da02`](https://sepolia.voyager.online/contract/0x01281b5f8e26c1ec0ab5fc439b1c23e1e37f183438a7b148b2894436f940da02) |
| **Class hash** | `0x4b9bc74f68550ceae724dd880409e41fd6590bcd4ca0f6f400e8f805eb1b156` — identical on both |

Same bytecode on testnet and mainnet, so production runs what the tests rehearsed. Verify it yourself:

```bash
# Phase::Void for an id nobody opened — all nine fields zero.
curl -s -X POST https://api.cartridge.gg/x/starknet/mainnet \
  -H 'Content-Type: application/json' -d '{
    "jsonrpc":"2.0","id":1,"method":"starknet_call","params":[{
      "contract_address":"0x06d3f070a8732b1272ac7e73527187ce08da502839b18fc30a481a79512b8c08",
      "entry_point_selector":"0x333358710919613a34f18567332063b09711678bab1f50754e4f8f7fd637a8e",
      "calldata":["0x77616c6b6f75742d32303236"]},"latest"]}'
```

<br>

## Nothing to write down

A pledge lives on-chain under `poseidon(REFUND_TAG, secret)`, and that secret is your only claim on your own money — the contract deliberately has no idea who you are, so there is nobody to appeal to.

A safety net that depends on a user not losing a random string is not a safety net. So secrets are never random: they are **derived from a signature the wallet can always reproduce**. Nothing to store, nothing to back up. Reinstall on a new machine and the same secret falls out.

<br>

## Verify without trusting the organiser

A participant hands over money on two claims — that the quorum was really reached, and that what fired is what they agreed to. Both are checkable from public events, and neither should require believing the organiser, who is exactly the party with a motive to lie.

[`verifyCampaign`](packages/protocol/src/verify.ts) replays the accumulator from the observed event stream, checks the count is sequential, confirms firing happened at or above quorum, and confirms the document you were shown hashes to the terms committed on-chain.

It distinguishes **cannot verify** from **verified false**. An observer holding no commitments cannot replay the root, and reporting that as a failure would make the report useless in the common case.

<br>

## Deadlines are measured, not assumed

Starknet mainnet produces a block every **~1.7 seconds**. Much tooling still assumes 30s, and the difference is not cosmetic.

A campaign expiry expressed as "seven days" would have become **2.8 hours** on-chain. Expiry cannot be changed after creation, so every pledge would have refunded long before anyone reached quorum — failing silently, in the one direction that looks exactly like nobody wanted to join.

Block time is now measured from the chain, falls back only when it cannot be, and rejects samples too small to trust. Campaign creation refuses any window under fifteen minutes as a units mistake. Caught in [#121](https://github.com/starkience/strk20-hackathon/issues/121); confirmed here at 1.699 s/block over 200,000 blocks.

<br>

## What is public, stated plainly

The pool hides **who** pledged and **how much**. It does not hide that a campaign exists, how many pledges it holds, or when they arrived — each pledge is a transaction, and transactions are counted.

For a union drive that means an employer can see *forty people pledged*, just not which forty. For most of these cases that is the right trade. For some it is not, and you should know which you are in before you pledge rather than after. [`packages/linkage`](packages/linkage) measures what the live pool actually gives away, including three classes of withdrawal that mean nobody left.

<br>

## Repository

```
contracts/          QuorumMachine + ConclaveMachine, Cairo 2.20      43 tests
packages/protocol/  commitments, key derivation, actions, verify     39 tests
packages/oracle/    effective anonymity set of the live pool         27 tests
packages/linkage/   what the pool already gives away                 14 tests
packages/chain/     mainnet reader, infrastructure classification
packages/router/    routing toward the largest crowd                  9 tests
packages/execute/   proving windows and fee cost                     12 tests
packages/sdk-bridge/ reaches ContractDiscoveryProvider past its exports map
app/                the front end
```

```bash
npm install && npm run build && npm test    # 114 TypeScript tests
cd contracts && snforge test                # 43 Cairo tests
```

Node 24+ — the STRK20 SDK's `ohttp-ts` requires modern WebCrypto.

<br>

## Contributed upstream

- [**#121**](https://github.com/starkience/strk20-hackathon/issues/121) — a way past the SDK's unexported `ContractDiscoveryProvider`, packaged as [`@shoal/sdk-bridge`](packages/sdk-bridge); confirmation that **Ready X implements the STRK20 wallet methods** where Braavos answers *not implemented*; and the finding that a shield with no exit still emits a `Withdrawal`, because the fee is settled by paying the collector.

<br>

---

<div align="center">

**Apache-2.0** · unaudited — own the review if you build on it

*Somebody has to go first. Make it cost nothing.*

</div>
