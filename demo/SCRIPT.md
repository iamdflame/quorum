# Quorum — demo voiceover script

**Target 2:50.** Hard ceiling is 3:00 — the panel does not score past it.

Roughly 375 words. ElevenLabs at default pace runs ~150 wpm, so the words take
about 2:30 and the remaining 20 seconds are the pauses you leave between blocks.

## How to read this

Each block below is **one ElevenLabs generation**. Do not paste the whole script
in one go — you want separate audio files so you can slide them against the
video without re-rendering everything when one shot runs long.

`···` marks a beat. In ElevenLabs, type it as a line break inside the box; it
reads as a short pause. Do not write "[pause]" — it will say the word.

**Voice settings that suit this script:**

| | |
|---|---|
| Voice | a calm, low, unhurried one. Not an announcer. This script is understated on purpose and a hype voice fights it |
| Model | Eleven Multilingual v2 |
| Stability | 50 |
| Similarity | 75 |
| Style | 0 — any style exaggeration turns the dry lines into sarcasm |
| Speed | 0.95 if your voice runs fast |

---

## 01 · over card `01-open.png` — 0:00–0:12

> Every group action has the same problem.
> ···
> Somebody has to go first. And going first is what costs you.

## 02 · over card `02-trap.png` — 0:12–0:26

> So you put the escrow on chain, and you make it worse.
> ···
> A pledge everyone can see tells your counterparty exactly how much pressure they are under. And it tells everyone else whether it is safe to join yet.

## 03 · over card `03-title.png` — 0:26–0:36

> Quorum is a threshold escrow that runs inside the STRK20 privacy pool. Money moves only when enough people independently agree.

## 04 · over screen recording A (home page) — 0:36–0:52

> Until that moment, nobody — including the organiser — can tell who agreed, or whether it is going to happen.
> ···
> Pledges are countable, but not attributable. The chain records that a pledge exists. It does not record whose.

## 05 · over screen recording B (the campaign page) — 0:52–1:20

> This is a real campaign on Starknet mainnet, read live from the contract.
> ···
> Three pledges against a threshold of two. Phase: fired. Three STRK escrowed.
> ···
> Opening a campaign is joining it — an organiser who has not staked anything is not an organiser. And firing is permissionless. Once the threshold is met, anyone can execute it, so the organiser cannot hold a met quorum hostage.

## 06 · over screen recording C (the block explorer) — 1:20–1:42

The shot is the *Fired* transaction on Starkscan — an explorer we do not
control. Hold on the line that reads **"Public trail ends here."**

> Here it is on an explorer that is not ours. Created, committed, committed, fired — every one of them through our contract, not merely touching the pool.
> ···
> And read what the explorer says about it by itself: the public trail ends here. Nothing on chain connects this to the deposit that funded it.

## 07 · over card `04-verify.png` — 1:42–1:50

> But you should not believe any of that because I said it.

## 08 · over screen recording D (the terminal) — 1:50–2:20

> One command re-derives every claim in the README from mainnet.
> ···
> The class hash. That testnet runs the same bytecode as production. The block time — one point seven seconds, not thirty. That error alone would have closed a seven-day campaign in under three hours.
> ···
> And the contract's own accounting, reconciled against its real balance, to the wei.

## 09 · over card `05-leak.png` — 2:20–2:30

> One more thing. Before trusting a privacy pool, we measured what it already gives away.

## 10 · over screen recording E (the linkage tool) — 2:30–2:48

> No cryptography broken. Just a join on transaction hash.
> ···
> It found that the pool's paymaster looks exactly like a person — and counting it as one invents dozens of privacy failures that never happened. It ships as its own tool, and it names nobody but you.

## 11 · over card `06-end.png` — 2:48–2:58

> Quorum. Somebody has to go first.
> ···
> Make it cost nothing.

---

## If you run long

Cut in this order. Each cut is self-contained — nothing later depends on it.

1. Block 02's second sentence (`And it tells everyone else…`) — saves 6s
2. Block 06's first sentence, keeping only the "public trail ends here" beat — saves 8s
3. Block 08's middle beat, keeping only the block-time line — saves 9s

Do **not** cut block 05. It is the only place the video proves the product works
on mainnet, and that is 30% of the score on its own.
