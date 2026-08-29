# Threat model

Quorum's entire pitch is a claim about who can see what. This document states
that claim precisely enough to be wrong.

Every number here is checkable from the chain, and `npm run verify` re-derives
the ones that can drift. Where a guarantee does not hold, it is named as not
holding rather than qualified into vagueness.

---

## The guarantee, stated exactly

> For a campaign that reaches its threshold, the chain records **that** *n*
> people pledged and that the threshold was honoured. It does not record **who**
> they were, and it does not record the order in which they arrived relative to
> any public identity.
>
> For a campaign that does not reach its threshold, the chain records that some
> pledges existed and were returned. It still does not record whose.

That is the whole claim. It is narrower than "anonymous", and the gap between
those two things is what the rest of this document is about.

---

## What the contract actually emits

This is the complete public record a campaign produces. Not a summary — the
whole thing.

| Event | Fields |
|---|---|
| `Created` | `campaign_id`, `terms`, `threshold`, `unit`, `expiry_block`, `payout_root` |
| `Committed` | `campaign_id` — **and nothing else** |
| `Fired` | `campaign_id`, `pledge_count`, `pledge_root` |
| `Reclaimed` | `campaign_id` |
| `Unsealed` | `campaign_id`, `payload` |

A pledge produces one `Committed` event carrying one field: which campaign it
was. No address, no commitment, no amount, no index. Storage is the same shape —
`get_campaign` returns eleven fields and none of them is a list of pledgers,
because the contract never had one.

Every pledge is the same size (`unit`). That is a Sybil measure, but it is also a
privacy measure: with variable amounts, an amount is a fingerprint, and "the
person who pledged 1,337 STRK" is identifiable without any address ever
appearing.

---

## The adversaries

| Who | What they learn | What they cannot |
|---|---|---|
| The counterparty | that a campaign exists, its threshold, and its running count | which of their people pledged, or whether any did |
| A chain observer | the same, plus block timings | any pledger's identity from chain data alone |
| The transaction sender | nothing — it is a shared relayer | — |
| The relayer operator | that *someone* asked it to submit this | nothing about the pledge contents beyond what is public |
| A subpoena to the organiser | the campaign's parameters and terms | a pledger list the organiser never had |
| The organiser | the count, like everyone else | who pledged; they cannot redirect the money either |
| *n−1* colluding pledgers | that exactly one other pledge exists | who made it |
| The wallet | **everything** | — |
| The RPC provider | your IP, and which campaigns you read | what you pledged, if you pledge through the relayer |

### The counterparty

The party a campaign is aimed at — an employer, a seller, a defendant — sees the
same thing everyone else does: a campaign id, a threshold, and a count that goes
up. This is deliberate. A campaign that is *invisible* cannot apply pressure; a
campaign whose *members* are visible cannot survive to apply it.

They cannot tell whether any particular person pledged, including by watching a
person's address, because no pledge transaction is sent from a pledger's address
(see below).

### The transaction sender — verified, not assumed

A Starknet transaction has a public `sender_address`, and if that were the
pledger's wallet the whole design would be defeated at a layer beneath the pool.
It is not. The four transactions of `demo-70414` were submitted by four different
accounts, all sharing class hash `0x1a736d6ed154…`, with nonces between roughly
298,000 and 638,000.

Those are shared relayers carrying hundreds of thousands of unrelated
transactions. Membership in that set tells an observer nothing. Check it:

```bash
# the Fired transaction's sender, and how many transactions it has sent
curl -s -X POST https://api.cartridge.gg/x/starknet/mainnet -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"starknet_getTransactionByHash",
       "params":["0x01da6af3260615abebaa5d708c885d8017fb0de2f2001d8269203b5924bb5a8e"]}'
```

**What this costs.** The relayer sees the request before it is on chain: its
timing, and the IP it came from. It cannot forge a pledge or learn a secret, but
it is a trusted party for *network-level* unlinkability in a way the chain is
not. If that matters to you, submit through your own infrastructure — the
guarantee that survives without trusting anyone is the on-chain one.

### A subpoena, and the organiser

Neither can produce a pledger list, because none exists anywhere: not in the
contract, not in the app, not in a database. The app holds campaign state in your
own browser's storage and nothing else.

This is the difference between a privacy policy and a design. A service that
*promises* not to retain a list can be compelled to produce it; a contract that
never had one cannot.

The organiser is also not privileged over the money. Payouts are committed as
`payout_root` when the campaign opens and checked when it fires, so whoever fires
it cannot redirect it — including the organiser. See
[the tests](contracts/tests/quorum_test.cairo): `a_firer_cannot_redirect_payouts_to_themselves`,
`a_firer_cannot_skim_a_slice_to_themselves`.

### Colluding pledgers

If *n−1* of *n* pledgers collude, they know which pledges are theirs, and
`pledge_count` tells them exactly one other exists. They do not learn who. This
is inherent to a public count and is not fixable while the count is the thing
that makes the mechanism work.

The practical consequence: **a campaign with a threshold of 2 offers almost no
anonymity to its second pledger.** Small campaigns are small anonymity sets.

### The wallet

Your wallet sees your address, your balance, your secret's derivation signature,
and every campaign you touch. There is no design here that protects you from a
malicious wallet, and claiming otherwise would be dishonest.

---

## Where it actually breaks: you

The linkage failures this project [measured in the live pool](packages/linkage)
apply to Quorum's users exactly as they apply to everyone else's. None are
protocol flaws; all are things people do because nothing tells them not to.

- **Funding and pledging in one motion.** A deposit and a note creation in one
  transaction binds that note to the address that funded it. Shield first, pledge
  later — the app makes shielding a separate step for this reason.
- **Registering a viewing key alongside value movement.** The STRK20 docs warn
  about this by name.
- **Pledging from an address with public history.** Your exposure is the union of
  every address provably yours, not the one you used at the time. Check your own:
  `npx quorum-linkage --address 0xYOURS`.
- **Timing.** A pledge shortly after a distinctive deposit narrows the set.
  Nothing in the contract can fix this.

**The anonymity set is the pool's users during your window, not the campaign's
pledgers.** Over 60,000 recent blocks the live pool held 40 distinct addresses
collapsing to 40 parties. That is the real crowd, and it is small. Quorum does
not make the pool bigger; it makes sure that joining a campaign does not remove
you from it.

---

## What this does not defend against

Stated plainly, because a threat model that only lists solved problems is
marketing.

- **A malicious or compelled wallet.** Out of scope, and unfixable from here.
- **Network-level observation** of your connection to a relayer or RPC.
- **A subpoena to the relayer**, for timing and IP.
- **Statistical attacks on small campaigns.** A threshold of 2 is not a crowd.
- **Coercion.** Nothing here stops someone forcing you to reveal your own secret.
  The secret is derived from a wallet signature bound to the campaign, so you
  *can* prove your own pledge if you choose — which is a feature for a claimant
  and a liability under duress.
- **The contract being wrong.** It is unaudited. 51 adversarial tests are not an
  audit, and the tests were written by the same person who wrote the bug they
  were meant to catch.
- **The refund path on mainnet.** The contract path is tested, but its mainnet
  leg is blocked by a wallet limitation with open notes and is recorded as open
  in [DEPLOYMENTS.md](DEPLOYMENTS.md). Until that lands, the failure path is
  proven in tests and not in production.

---

## Checking any of this

```bash
npm run verify          # every factual claim in the docs, re-derived from mainnet
cd contracts && snforge test   # the adversarial tests, each named for its attack
npx quorum-linkage --address 0xYOURS   # what the pool already says about you
```

If one of these documents disagrees with the chain, `npm run verify` fails and
says which. That check runs on every push.
