# quorum-linkage

**What the STRK20 privacy pool already reveals about you, with no cryptography broken.**

[![npm](https://img.shields.io/npm/v/quorum-linkage?color=E2661A&style=flat-square&labelColor=0B0A08)](https://www.npmjs.com/package/quorum-linkage)

```bash
npx quorum-linkage                      # aggregate report, no address named
npx quorum-linkage --address 0xYOURS    # what the chain already says about you
```

---

## The thing this measures

A privacy pool's anonymity set answers *"how many people could I have been?"*. That is the number everyone quotes, and it is the easy question.

This library answers the harder one: **which private notes are already tied to a public address, right now, with nothing broken at all?**

The mechanism is co-occurrence, and it needs no key material. Each pool event is carefully anonymous on its own — a nullifier reveals nothing, an encrypted note reveals nothing. But every event sharing a transaction hash was caused by *one actor*, and some of those events name a public address in the clear. A transaction containing both a `Deposit` (which names `user_addr`) and an `EncNoteCreated` binds that address to that note. No viewing key. No proof broken. A join on transaction hash.

This is invisible if you read the pool one selector at a time, which is how every block explorer reads it.

## Four failures, each independently sufficient

| | |
|---|---|
| **binding** | a deposit and a note creation in one transaction — the note is attributable to whoever funded it |
| **round-trip** | shield and unshield in one transaction; the entry and exit are both public, so the pool hop between them protected nothing |
| **onboarding** | a viewing-key registration alongside value movement — the channel-open linkability the STRK20 documentation warns about by name |
| **exit** | a nullifier spent alongside a public withdrawal, tying the spent note to a public destination |

None of these are protocol flaws. All of them are things wallets and users do because nothing tells them not to.

## Clustering: from addresses to people

Linkage names addresses. `clusterEntities` names *parties* — and that is strictly worse for the person, because their exposure is the union of every address in their cluster, not just the one they were using at the time.

Three joining rules, all structural:

- **round-trip** — a transaction holding a `Deposit` naming A and a `Withdrawal` paying B is one atomic action by one actor. A and B are the same party. This is the single relationship the pool exists to hide.
- **co-deposit** — several deposits in one transaction were funded and authorised together. Bitcoin's common-input-ownership heuristic, transferring intact.
- **shared-note** — two addresses bound to the same note are the same party. A note has one owner.

Deliberately excluded: timing proximity, amount similarity, gas-price fingerprints. Those are real attacks, but they are probabilistic, and **a privacy tool that reports a guess with the same confidence as a proof is lying to the person relying on it.** Everything here is a link the chain itself makes.

## Plumbing is not people

The hardest part of this is not finding links. It is *not counting infrastructure as a person*, and getting it wrong produces confident nonsense in both directions.

Every pool transaction pays a fee, and the fee is settled by paying a collector — which emits a `Withdrawal` naming it. So **every** transaction carries a withdrawal leg that has nothing to do with anyone exiting the pool. A naive pass over mainnet reports hundreds of users shielding and unshielding atomically when not one of them did.

The pool's paymaster cost us a second version of the same error. It receives in almost every transaction but only ever in one or two tokens, so a rule requiring breadth *and* volume classified it as a heavy user, and dozens of phantom round-trips came back. A single-asset payee is still a payee. Both signals are now independent evidence, and `sinkCandidates` is pure and tested against exactly that shape.

The opposite mistake matters just as much: an EOA that receives a lot is a heavy *user*, and excluding them silently shrinks the crowd. So a candidate is only excluded once the chain confirms it is a deployed contract.

## Using it

```ts
import { analyseLinkage, clusterEntities } from "quorum-linkage";
import { fetchTransactions, blockNumber, observePool, identifyInfrastructure }
  from "quorum-chain";

const head = await blockNumber();
const from = head - 600_000;

const [txs, obs] = await Promise.all([
  fetchTransactions(from, head),
  observePool(from, head),
]);

// Identify plumbing from chain state *before* attributing anything to a person.
const infra = await identifyInfrastructure(obs.edges, from, head);

const report  = analyseLinkage(txs, { infrastructure: infra.all });
const parties = clusterEntities(txs, { infrastructure: infra.all });

report.exposedNotes.size;   // notes attributable to some public address
parties.entityCount;        // the honest population of the pool
```

## The CLI has no leaderboard

`npx quorum-linkage` with no arguments prints aggregate statistics and **names no address**. `--address 0x…` prints everything known about one address, and it is meant to be pointed at your own.

There is no mode that ranks other people's exposure. That report would be useful to exactly one kind of reader, and the tool would be a deanonymiser with a safety notice attached. What it will do is tell you about yourself, and tell everyone how bad the general picture is — which is what a person needs in order to decide whether to trust the pool with anything.

## Licence

Apache-2.0. Part of [Quorum](https://github.com/iamdflame/quorum), but it depends on nothing in it and is useful without it.
