# quorum-chain

**Reads the STRK20 privacy pool from Starknet mainnet, and — the part that matters — tells you which addresses are plumbing rather than people.**

No indexer, no API key. RPC with failover across public endpoints.

```ts
import { blockNumber, fetchTransactions, observePool, identifyInfrastructure }
  from "quorum-chain";

const head = await blockNumber();
const from = head - 600_000;

const txs  = await fetchTransactions(from, head);   // pool txs, events grouped by hash
const obs  = await observePool(from, head);         // public deposit/withdrawal edges
const infra = await identifyInfrastructure(obs.edges, from, head);
```

## Why infrastructure classification is the hard part

Every pool transaction pays a fee, and the fee is settled by paying a collector — which emits a `Withdrawal` naming it. So **every** transaction carries a withdrawal leg that has nothing to do with anyone leaving the pool. Read the pool naively and you will report hundreds of people shielding and unshielding atomically when not one of them did.

`identifyInfrastructure` separates three kinds of non-person:

- **anonymizers** — helper contracts, from `ExternalContractInvoked`
- **the fee collector** — read from the pool's own state, not guessed
- **sinks** — receive-only addresses that are deployed contracts

`sinkCandidates` is pure and network-free so the rule can be tested against the shapes that have actually fooled it. Two independent signals, either sufficient: **breadth** (spans several assets, never deposits) and **volume** (appears in many transactions, never deposits).

They were once an AND, which was wrong. The pool's paymaster receives in almost every transaction but only ever in two tokens — it passed volume, failed breadth, and was counted as a heavy user, resurrecting dozens of phantom round-trips. A single-asset payee is still a payee.

The opposite error costs just as much: an EOA that receives a lot is a heavy *user*, and excluding them silently shrinks the crowd you are trying to measure. So a candidate is excluded only once the chain confirms it is a deployed contract.

## Licence

Apache-2.0. Part of [Quorum](https://github.com/iamdflame/quorum).
