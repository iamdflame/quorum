# Shoal

**You don't pick a pool. You pick to be indistinguishable.**

Shoal is an anonymity aggregation layer. It measures the crowd you are actually hiding in — a number nobody currently publishes — and routes value so that crowd is as large as possible.

---

## Privacy is not encryption

Privacy is the number of people you could have been.

This is the part the industry keeps getting wrong. A shielded pool encrypts amounts, breaks the link between sender and receiver, and proves it all in zero knowledge. None of that helps if you are the only person who did something that looked like what you did. Cryptography gives you a hiding place; it does not give you a crowd. **The crowd is a separate problem, and nobody owns it.**

## The crowd is smaller than you think

An anonymity set does not fragment once. It fragments along three axes simultaneously, and none of them are visible to the person relying on it:

| Axis | Why it splits | Your crowd becomes |
|---|---|---|
| **Asset** | STRK20 groups notes into per-token subchannels | whoever else shielded *that token* |
| **Denomination** | deposits and withdrawals carry plaintext amounts | whoever else moved *roughly that much* |
| **Time** | every edge is timestamped by its block | whoever else moved *in that window* |

Intersect all three and a pool with ten thousand users routinely offers an effective anonymity set of **three**. Shoal computes that number. To our knowledge it is not published anywhere else — which is remarkable, because it is the only number that determines whether any of this worked.

## Counting people is the wrong measure

A hundred operators in a cell where one accounts for 99% of the flow is not a crowd of a hundred. An observer who guesses "the big one" is right almost every time.

So Shoal reports the **effective** set — perplexity, `2^H` over the flow distribution. It equals the headcount when flow is even and collapses toward one as it concentrates. In [`set.ts`](packages/oracle/src/set.ts), with the property under test:

```
a crowd dominated by one operator collapses toward one
  200 edges from one address, 9 from nine others
  participants: 10      <- the flattering number
  effective:    < 3     <- the honest one
```

Getting this right required attributing flow to the addresses behind public edges. Deposits expose the depositor by design — the same publicity that makes the pool leaky is what makes the crowd measurable. **The adversary can compute this. Shoal computes it first.**


## What it looks like

`npm run demo` — a pool with realistic bursty traffic:

```
THE POOL LOOKS LIKE THIS
  914 public edges
  914 distinct operators
  158 distinct (asset, denomination, window) cells

THE CROWD YOU ARE ACTUALLY IN
  median effective set across cells .......... 2.0
  cells offering a crowd of 1 (you, alone) ... 74 of 158
  largest crowd anywhere in the pool ......... 18.0

ROUTING: move 2,000 USDC
  naive, right now .......... crowd of 1.0
  routed .................... crowd of 18.0  (18.0x)
        1000  ->  window 57 (block 41040)  crowd 18.0
        1000  ->  window 58 (block 41760)  crowd 18.0

ROUTING: move 50,000 of a thin asset
  naive, right now .......... crowd of 1.0
  routed .................... crowd of 1.0  (1.0x)
  ! No denomination of this asset has been used by more than one operator.
    There is no crowd to route into; the asset itself is the identifier.
```

Nine hundred and fourteen operators, and the median user is hiding among two. The crowd exists — 18 people, in a window a few hours out — you are simply never standing in it. Routing is what puts you there.

The second case matters as much as the first: when there is no crowd, Shoal says so instead of inventing a number. A privacy tool that reports comfort it cannot justify is worse than no tool.


## The live pool, measured

`node examples/live-mainnet.mjs` — the real STRK20 pool on Starknet mainnet, block 13,770,005. Public `Deposit` and `Withdrawal` events only. No keys, no funds, no permission.

```
STRK20 PRIVACY POOL — STARKNET MAINNET
  5495 public edges total
  31 anonymizer contracts, 3 infrastructure sinks -> excluded
  1489 participant edges  (945 deposits, 544 withdrawals)
  570 distinct addresses
  20 assets

THE CROWD, MEASURED
  (asset, denomination, 6h window) cells ..... 1286
  median effective anonymity set ............. 1.00
  cells where you stand alone ............... 1232 of 1286  (96%)
  largest crowd anywhere in the pool ........ 10.00
```

**The median user of a live privacy pool is hiding among one person.** In 96% of cells there is nobody else at all, and the largest crowd anywhere in the entire pool is ten.

### Why we trust this number

The first version of this measurement was wrong, and the way it was wrong is instructive. Raw event data showed 4,550 withdrawals against 945 deposits — an anomaly worth attacking rather than publishing. It turned out **68.8% of all withdrawals went to a single address**: a deployed contract that never deposits and receives across 13 assets. A private swap withdraws to an anonymizer, not to a person. Counting that as a participant invents a crowd out of plumbing.

So infrastructure is now classified from chain state rather than a maintained list: anonymizers come from the pool's own `ExternalContractInvoked` events, and sinks are identified as deployed contracts that receive across several assets and never deposit. Only an EOA-or-depositor survives as a participant. The headline held after removing 34 such addresses — which is the only reason it is worth stating.

### What this is not

This is not a flaw in STRK20. The cryptography does what it claims, and the protocol's own documentation is candid that patterns leak. The pool is also young: **small sets are a consequence of low volume, not bad design.**

That is precisely the point. Anonymity is the one property you cannot ship on your own — it has to be *accumulated*, and every new pool, asset and app splits it further. No amount of cryptographic quality fixes a crowd of one. Somebody has to aggregate the crowd, and nobody is.

## Why this compounds, and why it cannot be forked

Every other moat in crypto can be copied over a weekend. Liquidity can be incentivised across venues. Mechanisms get forked. Anonymity cannot.

A privacy pool with ten times the users is *strictly* better, and **forking it splits the set and makes both halves worse.** The fork is self-defeating in a way no other crypto network effect is. This is the strongest winner-take-all dynamic in cryptography, and right now nobody is playing for it — the entire field is launching more pools, which is precisely how the fragmentation happened.

You do not fix fragmentation by adding another island. You fix it with a layer *above* pools that makes them behave as one set.

That layer treats every pool as an interchangeable venue. Which inverts the usual relationship with a chain: **a venue needs the aggregator more than the aggregator needs any venue.**

## What Shoal does

1. **Measure** — the effective anonymity set for every (asset, denomination, window) cell, from public chain data. `packages/oracle`
2. **Route** — choose the path that lands you in the largest crowd, rather than the fastest one. `packages/router`
3. **Settle** — sealed inputs, frozen input sets, provable value conservation. `contracts/`

Routing creates the flywheel: every routed user converges on shared assets, denominations and windows, so the cells grow, so the routing gets better, so more users route. The product improves by being used, and it improves *for everyone*, which is the only kind of privacy improvement that is real.

## Settlement

[`contracts/src/conclave.cairo`](contracts/src/conclave.cairo) is a general private state machine on the STRK20 pool, compiled against StarkWare's `privacy` package. Four invariants hold **unconditionally, even against a malicious settler**:

- **Phase ordering** — monotonic; no settling an unsealed set, no re-settling
- **Input-set immutability** — an order-dependent Poseidon fold, so the root fixes the exact sequence of inputs, not merely their multiset
- **Value conservation** — payouts must sum to *exactly* the escrowed total, in the escrowed token. Cannot mint, cannot burn, cannot pay in an asset it never received
- **Settlement authority** — gated on a preimage fixed at creation; watching every event of the lifecycle does not confer the right to settle

The third is load-bearing: a settler who lies about the outcome still cannot extract more value than went in. **A false outcome misdirects; it cannot create.** That is what makes mis-settlement unprofitable rather than merely detectable.

What the contract does *not* verify on-chain is that a new state root is the correct transition under the conclave's program. That is attested by the STARK proof of the client-side `privacy_compute` execution — the same pairing StarkWare's own privacy-bridge uses to bind an attested message to a private note in one transaction. Stating that boundary precisely is the difference between engineering and a whitepaper.

Unaudited. Own the review if you build on it.

## Run it

```bash
npm install && npm run build && npm test    # 27 tests
cd contracts && scarb build                 # Sierra + CASM
```

Node 22+. `@shoal/oracle` has no runtime dependencies — it is pure and offline, holds no key material, opens no sockets, and has no spend authority, so its threat model can be audited on its own terms.

## Threat model

Shoal assumes an observer with the full chain: every public deposit and withdrawal with its amount, address and block; every nullifier; every open note's plaintext amount; and the timing of every storage write. It assumes that observer holds **no** viewing key, no auditor key, and no ability to spend.

That is exactly the adversary STRK20 is built to defeat — and exactly the adversary its own documentation concedes can still learn things from patterns. Shoal exists in that gap.

## Licence

Apache-2.0.
