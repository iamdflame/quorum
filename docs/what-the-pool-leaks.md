# What the STRK20 pool already leaks

Measured on Starknet mainnet over 600,000 blocks — about eleven and a half days
at the observed 1.7s block time — ending at block 14,035,045.

**No cryptography was broken to produce any of this.** No viewing key, no
proof, no key material of any kind. Every finding is a join on transaction
hash: events sharing one were caused by one actor, and some of those events name
a public address in the clear.

This is published for the ecosystem, not against anyone. **No address is named
here**, and the tool that produced it has no mode that ranks other people's
exposure — only one that reports on an address you give it, which is meant to be
your own. If you are building on this pool, the numbers below are your starting
conditions whether you measure them or not.

Reproduce any of it:

```bash
npx @quorum/linkage --span 600000        # the linkage figures
npx @quorum/linkage --span 600000 --json # the raw record, as docs/pool-scan.json
```

---

## 1. What is already tied to a public address

| | |
|---|---|
| Pool transactions analysed | 1,213 |
| Distinct addresses using the pool | 256 |
| **Private notes attributable to a public address** | **701** |
| Addresses with at least one attributable note | 256 |

Seven hundred and one notes can be tied to the address that funded or spent
them, today, by anyone with an RPC endpoint.

### By mechanism

| Failure | Count | What it is |
|---|---|---|
| Deposit bound to note creation | 376 | a `Deposit` naming an address in the clear, and a note created in the same transaction |
| Registration alongside a move | 154 | a viewing key registered in the same transaction as value movement — the channel-open linkability the STRK20 docs warn about by name |
| Nullifier with a public withdrawal | 203 | a spent note published alongside a public destination |
| Shield and unshield in one transaction | **0** | — |

That last row is the interesting one, and it is a correction rather than a
finding. A naive pass reports **hundreds** of these. Every pool transaction pays
a fee, and the fee is settled by paying a collector, which emits a `Withdrawal`
naming it — so *every* transaction carries a withdrawal leg that has nothing to
do with anyone leaving the pool. Read the pool one selector at a time, as every
block explorer does, and you will report a privacy catastrophe that is not
happening.

We got this wrong twice. The second time was subtler: the pool's paymaster
receives in almost every transaction but only ever in two tokens, so a rule
requiring both breadth and volume classified it as a heavy user, and dozens of
phantom round-trips came back. **A single-asset payee is still a payee.** The
corrected rule is pure, network-free, and
[tested against exactly that shape](../packages/chain/test/infrastructure.test.ts).

Anyone measuring this pool will hit the same trap. That is the main reason this
document exists.

---

## 2. How big the crowd actually is

The anonymity set is usually quoted as "how many addresses use the pool" — 256
here. That number is close to meaningless, for two reasons.

**Addresses are not people.** Clustering by the links the chain itself forces —
a deposit and a withdrawal in one atomic transaction, several deposits funded
together, two addresses bound to the same note — collapses 256 addresses into
**256 parties**. In this window nobody reused an address in a provable way. So
the count happens to be honest here, and it will not stay that way.

**You do not hide among everyone; you hide among people who look like you.** An
observer partitions by asset, by rough amount, and by time. Splitting the window
into (token × denomination × 6 hours) cells:

| | |
|---|---|
| Cells observed | 474 |
| **Cells containing exactly one participant** | **428 of 474 — 90%** |
| Cells with three or more observations | 20 |
| Participants in those cells, flow-weighted | 3.58 |
| **Effective crowd — 2^H over the flow distribution** | **3.46** |

Nine times out of ten, a person moving value through this pool is the only
person in their denomination-and-time bucket. Where there is a crowd at all, it
is between three and four people, and the *effective* number is lower than the
headline because flow is uneven: five participants where one moves most of the
value is not a crowd of five.

The effective number is the honest one. Reporting `participants` when the
distribution is skewed tells people they are hidden when they are identifiable
almost always.

---

## 3. What follows for anyone building on this

**Small crowds are the default, not the failure case.** If your design assumes a
large anonymity set, it does not currently have one. Nothing you can write in a
contract changes that; only more usage does.

**Uniform denominations are worth more than they look.** Every distinct amount
you introduce fragments the crowd further, and the measurement above shows the
crowd cannot afford it. This is why every pledge in Quorum is exactly one unit —
it is Sybil resistance, but it is also the only lever a single application has
over cell size. Same-size pledges land in the same bucket and make it bigger.

**Separate setup from movement.** 154 of the failures above are a viewing key
registered in the same transaction as a transfer. It costs one extra transaction
to avoid and it is the cheapest fix on this list.

**Separate funding from use.** 376 failures are a deposit and a note creation
sharing a transaction. Shield first, act later. Quorum's app makes shielding its
own step for this reason, and the note-maturity rule of 10 blocks means you
cannot avoid the wait anyway.

**Never assume infrastructure is a person.** Fee collectors, paymasters and
relayers will otherwise dominate your results and manufacture findings that are
not real.

---

## 4. Where these numbers are weak

- **One window.** Eleven days, one pool, one chain. Behaviour changes.
- **Clustering is deliberately conservative.** Only structural links are used —
  no timing proximity, no amount similarity, no gas fingerprints. Those are real
  attacks and would find more. They are also probabilistic, and a privacy tool
  that reports a guess with the same confidence as a proof is lying to the person
  relying on it. The 256-party figure is therefore an *upper* bound on the crowd,
  and the true number of distinct people is lower.
- **Cells with fewer than three observations are excluded** from the effective
  figures, which flatters them. The 428 single-participant cells are not excluded
  from the 90%, and they are the finding that matters.
- **Infrastructure classification is a heuristic.** It has been wrong twice, and
  both times it inflated the failure counts rather than hiding them.

---

## 5. Reported upstream

The block-time correction that motivated re-deriving all of this — mainnet
produces a block every ~1.7s, not the 30s several tools assumed, which makes a
"six hour" window twenty minutes — was reported in
[#121](https://github.com/starkience/strk20-hackathon/issues/121) along with the
fee-collector `Withdrawal` behaviour that causes the phantom round-trips.

If you are measuring this pool and get a large round-trip count, that is almost
certainly what you are seeing.
