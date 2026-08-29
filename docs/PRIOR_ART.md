# Prior art

Quorum is not a new idea. It is a known mechanism that has never been built
without someone trustworthy in the middle, and the contribution here is removing
that someone.

This document names what came before precisely enough to be checked, and states
what is actually different. A claim of novelty that does not survive a literature
search is worth less than an honest claim of implementation.

> **On citations.** The works below are named by author and title so they can be
> looked up directly. Where a year or venue is not stated, that is deliberate —
> this was written without library access, and a fabricated citation would be
> exactly the failure this project spends the rest of its documentation guarding
> against.

---

## Two separate lineages meet here

Quorum sits at the intersection of two literatures that have mostly not talked
to each other. Neither one alone produces it.

### 1. Information escrows — the privacy half

**Ian Ayres and Barry Nalebuff, "Information Escrows".** The canonical
statement of the problem: some disclosures are only safe to make if others make
them too, and the first person to speak carries all the risk. Their proposal is
an escrow that holds a report and releases it only when a matching report
arrives. This is Quorum's threshold logic exactly, in a legal rather than
cryptographic frame.

**Callisto.** A working implementation for campus sexual assault reports: a
survivor files a report that stays sealed unless a second report names the same
person, at which point both are released. It is the strongest existing evidence
that the mechanism works on real people with real stakes — and it is also the
clearest illustration of the gap, because Callisto necessarily holds the reports.
The escrow is an organisation.

**"Allegation escrow" work in the cryptographic literature.** There is a body of
work formalising Callisto-style matching with cryptography, including
constructions that avoid a single trusted holder and that consider allegations
against multiple accused parties. Quorum does not attempt this: matching *the
same accused* is a harder problem than counting pledges to *the same campaign*,
and the difference is deliberate.

### 2. Assurance contracts — the money half

**Threshold pledging / assurance contracts.** A contribution binds only if a
target is met, otherwise everyone is refunded. Kickstarter is the mass-market
version. **Alex Tabarrok's dominant assurance contracts** add a refund bonus so
that pledging is individually rational even when the campaign fails.

Every one of these is **public by construction**. Kickstarter shows a running
backer list; an on-chain assurance contract shows every pledger's address. The
mechanism solves "will enough people join" while creating "everyone can see that
I joined first" — which is the cost Ayres and Nalebuff were writing about.

### 3. On-chain privacy — the machinery

**Privacy pools** in the Buterin-et-al. sense, and shielded-pool designs
generally, give you the primitive: value that moves without naming its owner.
STRK20 is one of these. **Semaphore** and similar anonymous-signalling systems
give you set membership without identity.

What these give you is a *pool*. What they do not give you is a *decision* — a
rule about when the pooled thing acts, enforced without an operator.

---

## What Quorum does differently

Stated as narrowly as it can be defended:

> **An information escrow whose threshold is enforced by a contract rather than
> an operator, whose escrowed thing is money rather than a report, and whose
> participants are not identified even to the person who opened it.**

Concretely, against each ancestor:

| Prior work | What it needs that Quorum does not |
|---|---|
| Ayres–Nalebuff escrows | a trusted escrow agent |
| Callisto | an organisation that holds the reports and can be compelled to produce them |
| Kickstarter / assurance contracts | public pledges — the visibility is the cost |
| A naive on-chain escrow | public addresses, and usually an operator key that can move funds |
| Privacy pools alone | a rule about when the value acts |

And two properties that are not inherited from any of them:

**The organiser is not privileged.** Payouts are committed as a Poseidon fold
when the campaign opens and checked when it fires, so whoever fires it cannot
redirect it — including the person who created it. Firing is permissionless, so
they also cannot hold a met quorum hostage. This was not true of the first
version of this contract; the [disclosed bug](../README.md) and the tests that
now prevent it are in the repository.

**The failure path preserves anonymity too.** A campaign that expires below
threshold refunds every pledge and reveals nobody. In Callisto and in Ayres–
Nalebuff, a report that never matches sits with the escrow agent, who knows it
exists and who filed it. Here there is nothing to know: the contract holds a
count and a set of commitments, and never held a name.

---

## What is *not* claimed

- **Not the first threshold escrow.** It is a well-described mechanism with
  decades of prior work, most of it better-formalised than this.
- **Not the first privacy pool**, or any advance in the underlying cryptography.
  STRK20 does that work; Quorum is an application on top of it.
- **Not cryptographically novel.** Poseidon commitments and an order-dependent
  accumulator. Nothing here would surprise a cryptographer.
- **Not stronger than its anonymity set.** [Measurement of the live pool](what-the-pool-leaks.md)
  puts the effective crowd at three to four people, with 90% of denomination-and-time
  cells holding exactly one participant. A mechanism cannot hide you in a crowd
  that is not there.

The defensible claim is the conjunction, not any single part of it: **a known
mechanism, implemented with no trusted operator, holding real value, running on
mainnet.** Each of those exists separately. As far as we can find, they have not
been put together.

If you know of prior work that does combine them, the honest thing is to say so,
and a pull request correcting this page is genuinely welcome.
