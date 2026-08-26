# Quorum

**Nobody is exposed until enough people commit.**

Threshold coordination on Starknet. Pledge into a campaign, and your pledge binds only once enough others have pledged too. If the quorum is never reached, you get your money back and you were never revealed.

---

## The problem this exists for

There is a class of action nobody can take alone.

You cannot unionise publicly — you are fired. You cannot report a serial harasser alone — you are destroyed and they are not. You cannot commit to a boycott alone — it fails, and you are marked as the one who tried. You cannot be the first name on a class action.

In every case the obstacle is identical, and it is not secrecy for its own sake: **the first mover carries all the risk and receives none of the benefit.** So nobody moves, and an action that a majority privately wants never happens. Economists call this a collective action problem. Everyone else calls it Tuesday.

A threshold inverts the payoff. If your commitment binds only once enough others have committed, then going first costs nothing. That mechanism has been understood for decades — Ian Ayres and Barry Nalebuff wrote about "information escrows" for exactly this, and Callisto built one for campus assault reports that only opens when a second report names the same person.

What has never existed is a way to run it where **the escrow holds real money, the count is enforced by something other than trust, and no participant is exposed if it fails.**

## Why this needs the pool

Run it on a public chain and the pledges are public, which defeats it entirely — the employer reads the list.

Run it on a server and the operator becomes a single point of coercion. A subpoena, a court order, a bribe, or one disgruntled engineer unmasks everyone at once. Callisto's own threat model has this problem and they are honest about it.

On the [STRK20](https://strk20.starknet.io) pool a pledge is an encrypted note. Value moves without naming who moved it, escrow is held by a contract rather than a company, and settlement is atomic. **The privacy is not a feature bolted onto a coordination app. Remove it and there is no product, because there is no coordination.**

That is the difference between this and the other 150 projects in the sprint. They hide a transfer between two people who already know each other — privacy as a feature. Here privacy is load-bearing.

## The promise, and what enforces it

Everything rests on one sentence said to the person deciding whether to go first: *if the quorum is not reached, you get your money back and you are never revealed.* Take that away and the mechanism collapses into ordinary crowdfunding, where going first is a donation to something that may not happen.

So [`QuorumMachine`](contracts/src/quorum.cairo) enforces, unconditionally and on-chain:

| | |
|---|---|
| **Threshold enforcement** | a campaign cannot fire below quorum. Not "should not" — the transaction reverts |
| **Refund safety** | once a campaign expires unfired, refunds are the *only* path left |
| **Value conservation** | payouts sum to exactly what was escrowed, in the token escrowed |
| **Pledge-set immutability** | each pledge folds into an order-dependent root, fixing the set as a sequence |
| **Single-use reclaim** | a refund needs that pledge's own preimage, and burns it |

Together these mean an organiser who holds the fire secret and wants to steal can misdirect an outcome but **cannot create value, cannot fire a campaign that failed, and cannot stop refunds once it has.**

Two of these are subtle and were added because their absence is exploitable:

**A quorum that was met still cannot fire late.** Without it, an organiser who reached quorum could sit on a signed list indefinitely and use it as leverage — *"I have forty names, and I decide when they become public."* Expiry ends that. The money goes back.

**A pledge cannot be withdrawn before the deadline.** Otherwise a pledger watches the count and pulls out just before quorum, which reintroduces the collective action problem through the back door.

## Tests are the product here

A mechanism for collective action is worth nothing unless it holds when the person running the campaign turns on the people in it. So the adversarial cases are the suite and the happy path is almost incidental:

```
a_campaign_cannot_fire_below_its_quorum                    PASS
a_quorum_that_was_met_still_cannot_fire_late               PASS
a_malicious_organiser_cannot_pay_out_more_than_was_pledged PASS
an_organiser_cannot_strand_value_by_underpaying            PASS
an_organiser_cannot_pay_in_an_asset_never_pledged          PASS
a_failed_campaign_returns_every_pledge_in_full             PASS
a_pledge_cannot_be_withdrawn_before_the_deadline           PASS
a_fired_campaign_cannot_also_be_reclaimed                  PASS
a_pledge_can_only_be_reclaimed_once                        PASS
a_stranger_cannot_reclaim_someone_elses_pledge             PASS
the_same_pledge_cannot_be_counted_twice                    PASS
the_root_depends_on_order_not_just_membership              PASS
poseidon_matches_the_typescript_client                     PASS
```

**146 tests** — 43 Cairo, 103 TypeScript.

That last one earns its place. Commitments are computed in TypeScript and checked in Cairo, and if those two Poseidon implementations ever disagree, nothing throws: pledges simply become unreclaimable and campaigns silently cannot fire. For a system whose entire promise is that you can always get your money back, that is the worst available failure. The two implementations are now pinned to each other by fixed vectors asserted on both sides.

## Live on mainnet

| | |
|---|---|
| **QuorumMachine** | [`0x06d3f070a8732b1272ac7e73527187ce08da502839b18fc30a481a79512b8c08`](https://voyager.online/contract/0x06d3f070a8732b1272ac7e73527187ce08da502839b18fc30a481a79512b8c08) |
| Sepolia | [`0x01281b5f8e26c1ec0ab5fc439b1c23e1e37f183438a7b148b2894436f940da02`](https://sepolia.voyager.online/contract/0x01281b5f8e26c1ec0ab5fc439b1c23e1e37f183438a7b148b2894436f940da02) |
| class hash | `0x4b9bc74f68550ceae724dd880409e41fd6590bcd4ca0f6f400e8f805eb1b156` — identical on both |

Same bytecode on testnet and mainnet, so what runs in production is what the tests rehearsed.

## Nothing to lose, nothing to write down

A pledge is stored against `poseidon(REFUND_TAG, secret)`, and that secret is the pledger's only claim on their own money — the contract deliberately has no idea who they are, so there is nobody to appeal to.

A safety net that depends on a user not losing a random string is not a safety net. So secrets are never random: they are **derived from a signature the wallet can always reproduce.** Nothing to store, nothing to back up, nothing to lose. Reinstall the wallet on a new machine and the same secret falls out.

## Verify it yourself

A participant hands money to a contract on two claims: that the quorum was really reached, and that what fired is what they agreed to. Both are checkable from public events, and neither requires trusting the organiser — who is precisely the party with a motive to lie, and often the one under the most pressure.

[`verifyCampaign`](packages/protocol/src/verify.ts) replays the accumulator from the observed event stream, checks the count is sequential, confirms firing happened at or above quorum, and confirms the document you were shown hashes to the terms committed on-chain. It distinguishes *cannot verify* from *verified false*, because conflating them makes the report useless in the common case.

## What is public, stated plainly

The pool hides who pledged and how much. It does not hide that a campaign exists, how many pledges it holds, or when they arrived — each pledge is a transaction.

That matters for a union drive: an employer can see *forty people pledged*, just not which forty. For most of these cases that is the right trade, and for some it is not. `packages/linkage` measures what the live pool actually gives away — including three classes of withdrawal that mean nobody left — so a campaign can be told what is observable about it rather than assured it is invisible.

## Run it

```bash
npm install && npm run build && npm test    # 103 tests
cd contracts && snforge test                # 43 tests
```

Node 24+ (the STRK20 SDK's `ohttp-ts` requires modern WebCrypto).

## Licence

Apache-2.0. Unaudited — own the review if you build on it.
