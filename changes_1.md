The thesis problem (this is the whole game)
You told the user:
if the quorum is not reached, you get your money back and you are never revealed.
That sentence is true.
You did not tell them the matching sentence that is also true:
if the quorum is reached, the organiser who holds fire_secret can send every pledged note to any open notes they want.
Fire does not execute a committed action. It is payouts: Span<OpenNoteDeposit> chosen at fire time. Conservation only says the sums match. Destination is free.
That is not an information escrow. That is a private pot with a threshold, and the house keeps the keys. Callisto does not work if the campus admin can redirect the reports. A union drive does not work if the “organiser” can take the strike fund. You already wrote this in the header (“a malicious firer can misdirect an outcome”). Judges will treat that as the product.
Until Fire cannot steal, you cannot beat Aperture. Aperture’s treasury cannot send value except as a registered payout. You can.

ALL the problems
A. Fatal (the thing a named panel will end you on)
A1. Organiser is a superuser at Fire.

fire_secret + arbitrary payouts. Misdirection is in-protocol, not an edge case. Tests prove you cannot overpay. They do not prove you cannot pay yourself.
A2. There is no “group.”

Pledges are anonymous notes. Fire does not decrypt a membership list, does not open a mailbox, does not match two reports about the same person. After quorum, how does a union exist? Off-chain Telegram. That is the coercion server you said you deleted. Callisto without matching is a blog post.
A3. “Hides how much” is false.

You omit amount from Committed events. The pool still transfers amount into the helper on every Commit. That transfer is public. c.escrowed is public storage; the delta per tx is the pledge size. privacy_invoke calldata also carries amount and commitment. get_pledge(commitment) then returns the amount.

Stealth Checkout / Aperture / Passbook would fail you for this. You wrote a leak table that does not match the chain.
A4. Count is public, live.

pledge_count, QuorumReached, one tx per pledge. An employer does not need names. They need “14 people pledged this week.” You said this out loud. For the use cases on the README (union, harassment, boycott), the count is the dox. First movers are visible as a rising counter.
A5. Calldata-amount, not balance-delta.

Commit trusts amount in the invoke. Aperture, Limen, Lantern all measure balance_of because the sandwich can desync.

withdraw 100, calldata 10 → 90 STRK stuck forever (you have no sweep; you will get Aperture’s 14 STRK story without the honesty).
withdraw 10, calldata 100 → escrowed inflated, Fire reverts forever, campaign bricked.
This is the #1 “they didn’t read the pool” tell.

B. Protocol holes in QuorumMachine
B1. Create is under-checked.

No expiry_block > now. No minimum window (you check 15 minutes in TS; the contract does not). No fire_commitment != 0. No token != 0. A campaign can be born already expired, or with a zero fire key.
B2. Commit does not check the token actually arrived.

See A5. Also: a Commit of token A into a campaign denominated in B still increments escrowed in B-units if the pool was told to withdraw B. You never snapshot balance_of(c.token).
B3. Fire does not check actual ERC-20 balance == escrowed.

It checks sum(payouts) == c.escrowed. Stuck tokens from A5 are invisible. Aperture’s outstanding ledger exists because of exactly this.
B4. No payout policy at Create.

Terms are a felt hash. Nothing binds Fire destinations to terms. verifyCampaign can check the document hash. It cannot check that money went where the document said.
B5. outcome is an unbound felt.

Fire emits whatever felt the organiser types. Not a hash of payouts, not a hash of terms preimage, not a membership root.
B6. Reclaim note_id is caller-chosen (good) but Fire note_ids are organiser-chosen (bad).

Asymmetric by design. Pledgers control refunds; organiser controls success. Success is the case you care about.
B7. One invoke per pool tx.

N pledges = N public pool transactions. You cannot hide the counter without batching or a different shape. This is a protocol constraint you have not designed around.
B8. No subject binding.

Limen binds identity_key from the pool so one viewing key cannot pretend to be many subjects. You key pledges by poseidon(REFUND_TAG, secret). One person, 40 secrets, 40 pledges. Sybil is free. For a count-threshold, sybil is the attack: flood to force Fire, or flood to never let a real group be the majority.
B9. Threshold is cardinality, not stake.

Dust pledges (1 wei) count the same as a month’s salary. ZERO_AMOUNT only. No minimum, no denomination ladder (Airlock), no “one identity, one pledge.”
B10. Cannot fire late is also a grief.

Organiser goes to jail / gets sick / key lost → even a met quorum refunds. No backup: no timelocked permissionless fire, no threshold-shared fire key, no “any pledger can fire once met.” Liveness vs leverage is a real trade; you picked one side and left the other dead.
B11. Cannot leave before deadline is also a grief.

Someone pledged to a campaign whose terms were a hash they misunderstood. They are stuck until expiry. No “terms mismatch → exit” path. If terms stay a hash, this is worse.
B12. Duplicate pledge is per commitment, not per person.

DUPLICATE_PLEDGE stops replaying one secret. It does not stop 40 secrets.
C. Conclave (the second product)
C1. State transition is not verified.

You say it: new_state_root is attested by privacy_compute, not checked on-chain. A lying settler cannot mint, but they can lie about the program result. That is the same Fire-misdirect hole, generalised.
C2. Two machines, one README.

Judges will ask “what is the submission?” QuorumMachine is the story. Conclave is a research sketch. Right now it reads like you are afraid Quorum is not enough. It is enough. Conclave dilutes.
C3. Settle authority is still a secret holder.

Same superuser.
D. Privacy honesty (where Stealth/Aperture will eat you)
D1. Who: hidden (pool). How much: public (transfer + escrowed delta).

D2. When: public (block number per Commit). Timing cluster = shift-change at the factory.

D3. How many: public, monotonic.

D4. Campaign existence, terms hash, threshold, expiry: public. Fine.

D5. packages/linkage exists and you still overclaim in the hero sentence. Use your own package as the leak table.

D6. Open-note Fire payouts make destinations’ amounts public too. Organiser’s theft is observable as a shape, not as a name.
E. Product / mechanism (why it is not Callisto yet)
E1. No matching. Harassment use-case in the README requires “second report, same accused.” You have no subject_hash. Two reports about the same person never meet.
E2. No post-quorum discovery. Pledgers cannot find each other without the organiser. The organiser is the server.
E3. Money is the wrong payload for half your examples. A harassment report should not require staking STRK. A union maybe should. You used money as the only scarce pledge. That prices out the people the README is about.
E4. Terms are a hash. Nobody can prove at Commit time that the off-chain PDF matches, except by trusting the page that showed it. verifyCampaign is after the fact.
E5. Wallet-derived secrets. Good. If the derivation domain is weak (same secret across campaigns), one leaked pledge leaks all. Need poseidon(wallet_sig, campaign_id, REFUND_TAG).
E6. Demo narrative is “campaigns.” Generic. Aperture is a DAO. CrewKill is a game. You need one sentence: Callisto for money, on a pool.
F. Meta (how you lost me the first time)
F1. Registry is still Shoal. Hub one-liner is anonymity aggregation. I almost never opened this repo. Fix the PR today.
F2. Shoal packages still in the tree (router, oracle, linkage as the old product). Judges clone and think you pivoted halfway.
F3. Builder name mismatch (Highneighbour vs iamdflame). Looks like a sock or a messy fork.
F4. No live-pool fork test. Airlock injects the real pool entrypoint. You mock POOL() = 0x9001. For this sprint that is a ranking gap.
F5. No test that Fire cannot pay an unbound destination. Because it can. Add the test after you make it fail.
F6. 157 tests, 0 tests for sybil, 0 for amount-in-calldata vs balance, 0 for “payouts go to committed recipient.” The suite is good at the invariants you chose. It does not test the invariants you need.

The pivot (this is how you become incomparable)
Kill the organiser. Kill the pot. Make the threshold the only decryption event. Privacy is not a feature of a crowdfunding app. The pool is the only machine that can hold a secret set until it is large enough.
One sentence:
A pledge is a private note plus a sealed payload. Nobody — not the organiser, not the chain, not the employer — can read the set or move the money until N people have pledged. At N, the set opens to the pledgers and only to them. Below N, it is as if it never happened.
That is not Aperture (DAO). Not Jalin (router). Not CrewKill (game). Not Lantern (crowdfund). It is the thing STRK20 uniquely enables.
Mechanism v2 (ship this, nothing else)
1. Payout policy is committed at Create. Fire cannot choose destinations.
Three modes, encoded in the campaign, not in Fire calldata:

























ModeAt FireUseRefundAllevery pledge returns to its own notepure information escrow (Callisto, petitions)BoundTreasurypayouts must hash to payout_root set at Createstrike fund to a known treasuryProRataSelfeach pledger’s note gets their own amount back, but a bound flag / membership token is minted into that note“you are in the union” as a private capability (Quietline’s claim-ticket pattern)
If payouts is not a permutation of the committed policy, revert. Organiser theft becomes a should_panic test.
2. Fire is permissionless once pledge_count >= threshold && now < expiry.
No fire_secret. Anyone may fire. Liveness hole (B10) dies. Leverage hole (“I sit on 40 names”) already died from no-late-fire. You keep both.
Optional: require Fire to publish terms preimage so the hash opens. If preimage does not match, revert. Terms stop being a blind hash.
3. Balance-delta accounting. Do it like Limen/Aperture this weekend.
On Commit: before = balance_of(token); … pool already deposited … delta = balance - before (or snapshot in privacy_compute if you use privacy_invoke_with_computation). amount in calldata is ignored or must equal delta. escrowed += delta. Fire: balance_of == escrowed == sum(payouts). Stuck funds become impossible to ignore.
4. One identity, one pledge.
Bind identity_key from the pool (Limen’s subject). Store used[identity_key] = campaign_id. Second Commit from the same key reverts. Sybil now costs a new viewing key and a new pool identity, not a random felt.
Also: minimum pledge on a denomination ladder (Airlock). Dust attacks die. Amounts become uninformative because everyone pledges 10 or 100 STRK.
5. The actual product: sealed payload that opens at quorum.
This is the incomparable part. Money is only the bond. The payload is the thing.
Each Commit carries payload_commit = poseidon(contact_or_report). The plaintext never hits calldata.
How it opens without giving the organiser a god key:

After Fire, phase is Fired.
Add QuorumOp::Unseal: a pledger who knows their refund secret posts their payload into a campaign mailbox (Quietline claim-ticket / encrypted note).
Unseal is only valid in Fired. Below quorum, the entry point reverts. So even if they wanted to dox themselves early, the contract will not accept it.
Mailbox is a STRK20 note owned by a group key derived from (campaign_id, pledge_root) — every successful pledger can derive it after Fire because pledge_root is now frozen and they were in the fold. Organiser who did not pledge cannot.

You do not need exotic threshold encryption for the sprint. You need: the chain will not accept an unseal until Fire, and Fire cannot happen until N. That is the information escrow. Callisto falls out as Mode Match: payload includes subject_hash; Unseal is only stored; a view matches(subject_hash) returns count; at count>=2 the two payloads become readable to those two (same Unseal path, filtered).
Harassment report with zero money is Mode RefundAll with minimum pledge = pool fee only, or a separate Report op that parks a dust bond.
6. Hide the counter as much as the pool allows.
You cannot make N txs look like 0 txs. You can make them look like ordinary pool volume:

Standard denominations only (Himitsu census: 99% of pool deposits are distinctive — you already have packages/oracle. Use it).
Do not emit QuorumReached with a live count. Emit nothing until Fire. The employer sees anonymous 10-STRK pool txs, not “campaign X is at 14/20.”
get_campaign can keep pledge_count for the contract; do not put it in events. Judges can still call the view. Employers who are not watching that contract see less. Even better: store count, don’t expose it until Fire. A view that returns min(count, threshold) only after Fire is a political choice — document it.

7. One machine. Delete the second pitch.
Conclave becomes an internal comment: “Quorum is a 4-op state machine.” Do not lead with it. Shoal router/oracle: keep linkage as the leak table, move the rest to /archive. Registry PR: name Quorum, one-liner about information escrow, repo iamdflame/quorum.
8. Tests that match the new promise
Add, named like yours already are:

a_firer_cannot_redirect_payouts_to_themselves
fire_is_permissionless_once_quorum_is_met
commit_amount_is_the_balance_delta_not_calldata
a_second_pledge_from_the_same_identity_key_reverts
unseal_reverts_before_fire
unseal_after_fire_does_not_name_the_pledger_on_chain
dust_below_ladder_reverts
create_with_past_expiry_reverts
fork test: real pool privacy_invoke against deployed class (Airlock style)

If you cannot write a_firer_cannot_redirect_payouts because it would fail — that is the current product.

Why this outranks Aperture / Jalin / CrewKill






























They areYou becomeApertureprivate voting for a DAO that already existsthe DAO cannot exist until it is safe to existJalinany call inside one invokea router is leverage; it is not a reason the pool must existCrewKillprivacy as a game ruleprivacy as the only way a real-world first mover survivesLanternprivate donors, public goalprivate existence of the group
Judges score STRK20 depth 30% and innovation 25%. Aperture wins depth today because of the solvency ledger and ballot identities. You beat them on necessity: their DAO works (worse) without a pool. Your union drive does not exist without a pool. That is the innovation bar. Then you steal their depth: balance-delta, bound payouts, identity_key, denomination ladder, fork tests, leak table that matches calldata.
Do not add features. Do not polish the Vercel. Do not write more Conclave. Bind Fire, bind identity, open a mailbox only after N, tell the truth about amounts. That is the whole pivot.