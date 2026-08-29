# Making the demo video

Everything is already built. You do three things: **generate the voice**, **run
one command**, **upload**. No video editor required.

---

## What is already in this folder

| Path | What it is |
|---|---|
| `SCRIPT.md` | the narration, split into 11 blocks with timings |
| `out/01-open.png` … `out/06-end.png` | the six cards, 1920×1080 |
| `out/thumb.png` | the YouTube thumbnail, 1280×720 |
| `clips/*.mp4` | every shot, already cut, 1920×1080 30fps |
| `assemble.sh` | joins the clips to your voiceover and outputs the finished film |
| `out/verify.txt`, `out/linkage.txt` | the real command output the terminal shots show |
| `out/preview-silent.mp4` | **watch this first** — the whole cut, no audio, 2:22 |

**Why the footage was rendered rather than screen-recorded.** This machine's
display is 1366×768. A screen recording would be upscaled to 1080p and look
soft, and softness is the first thing that makes a demo look amateur. The
browser shots were captured by driving a real Chrome at 1920×1080, so they are
genuine recordings of the live site at full resolution.

Nothing in the terminal shots is typed or mocked. `out/verify.txt` and
`out/linkage.txt` are the actual output of actually running those commands, ANSI
colours included.

---

## Step 0 — watch the silent cut

```
demo/out/preview-silent.mp4
```

Two minutes twenty-two, no sound. This is every shot in order, so you can see
what you are narrating before you record a word. With narration over it the
finished film lands around **2:35–2:45**, because the cards stretch to fit the
lines spoken over them.

---

## Step 1 — make the voice (ElevenLabs)

1. Go to **elevenlabs.io** and sign in. Free tier is enough for ~3 minutes.
2. Click **Text to Speech** in the left sidebar.
3. Pick a voice. You want **calm, low, unhurried** — not an announcer. This
   script is understated on purpose and a hype voice fights it. Good defaults:
   *Brian*, *Daniel*, or *Charlotte*.
4. Open **Settings** (the slider icon under the voice picker) and set:
   - **Model**: Eleven Multilingual v2
   - **Stability**: 50
   - **Similarity**: 75
   - **Style**: 0 ← important; any style exaggeration turns the dry lines sarcastic
   - **Speed**: 0.95 if your chosen voice runs fast
5. Open `SCRIPT.md`. It has **11 blocks**. For each one:
   - Copy **only that block's** words (not the heading, not the `>` marks).
   - Paste into the ElevenLabs box.
   - Where the script shows `···`, press **Enter** for a line break. That is
     read as a short pause. **Do not type the word "pause"** — it will say it.
   - Click **Generate**, listen, and regenerate if a word is mispronounced.
   - Click **Download**.
6. Rename each download to its block number and put them in `demo/voice/`:

```
demo/voice/01.mp3
demo/voice/02.mp3
…
demo/voice/11.mp3
```

The extension can be `.mp3`, `.wav`, `.m4a` — the script accepts any of them.

> **Do it as 11 separate files, not one long one.** That is what lets the
> assembler time each shot to its own line. One big file cannot be timed.

### Pronunciation

ElevenLabs reads these wrong unless you help it. Type the left column as the
right column in the box:

| Written | Type this instead |
|---|---|
| STRK20 | `S-T-R-K twenty` |
| STRK | `stark` |
| 1.7 seconds | `one point seven seconds` |
| 0x01da… | don't — the script never reads a hash aloud |

---

## Step 2 — build the film

Open a terminal in the project folder and run:

```bash
./demo/assemble.sh
```

That is the whole edit. It reads each audio file, measures how long it is, holds
the matching shot for exactly that long plus half a second of air, fades the
cards in and out of black, cuts the live footage hard, and writes:

```
demo/out/quorum-demo.mp4
```

It prints the final length, **warns you if you went over 3:00**, and writes
`demo/out/chapters.txt` — the real chapter timings measured from your own audio.
Paste those into the YouTube description rather than guessing. If it does,
`SCRIPT.md` has an "If you run long" section listing exactly which three
sentences to cut, in order, and why not to cut block 05.

If it says a clip is missing, run `./demo/build.sh all` first.

### Watch it once, all the way through

Then check three things:
- Does the voice ever run past the picture? (It cannot — but look anyway.)
- Is the campaign page readable at 1080p? That shot is 30% of the score.
- Does it end before 3:00?

---

## Step 3 — upload

**Thumbnail**: `demo/out/thumb.png` — already 1280×720, already under 2MB.

**Title** (copy exactly):

```
Quorum — private threshold escrow on Starknet mainnet | STRK20 Private Sprint
```

If you want the punchier one instead:

```
Go first without being seen — threshold escrow inside STRK20 | Quorum
```

**Description** (copy the whole block):

```
Quorum is a threshold escrow that runs inside the STRK20 privacy pool on
Starknet. Money moves only when enough people independently agree — and until
that moment, nobody, including the organiser, can tell who agreed or whether it
will happen. Pledges are countable, but not attributable.

Live on Starknet mainnet. Campaign demo-70414 ran end to end: created, two
further pledges, fired — four transactions, every one of them through the
QuorumMachine contract rather than merely touching the pool.

  Live app    https://quorum-strk20.vercel.app
  Code        https://github.com/Highneighbour/quorum
  Contract    0x00dca84ff35ee793c69c983abfc29e3e1aa8790f7dcd7e0288b705f600fcdaf7

WHAT IS IN IT
• A Cairo contract where payouts are committed at creation, not chosen at
  execution — so whoever fires a campaign cannot redirect it to themselves.
• Amounts taken from the measured balance delta, never from calldata.
• Permissionless firing, so an organiser cannot hold a met quorum hostage.
• `npm run verify` — one command that re-derives every claim in the README from
  mainnet, including that the contract's accounting reconciles with its real
  balance to the wei.
• @quorum/linkage — a standalone tool measuring what the STRK20 pool already
  reveals with no cryptography broken. It names no address but your own.

58 Cairo tests, 88 TypeScript tests, Apache-2.0, unaudited.

CHAPTERS
<-- paste demo/out/chapters.txt here -->

Built for the STRK20 Private Sprint.
```

**Settings on the upload page:**
- Visibility: **Public** (Unlisted also works if the rules allow, but Public is safer)
- Category: Science & Technology
- **"Altered content" / AI disclosure**: the narration is synthesised, so tick
  the box if YouTube asks whether the content is synthetic. It costs nothing and
  a judge noticing an undisclosed synthetic voice costs a lot.
- Turn **off** "Made for kids"

Then paste the YouTube link into your hackathon submission.

---

## If you would rather record it yourself

You have OBS and Kooha installed. Nothing stops you re-recording any shot — but
your panel is 1366×768, so anything you capture will be softer than the rendered
clips. If you do:

1. Open **OBS** → **+** under Sources → **Screen Capture (PipeWire)** → pick the
   window → **Share**.
2. **Settings → Video**: set both Base and Output resolution to **1920×1080**.
   OBS will upscale; it will be soft, but consistent with the rest.
3. **Settings → Output**: Recording Quality *Indistinguishable*, Format **mp4**.
4. Record, then drop the file into `demo/clips/` over the shot you are replacing,
   keeping the same filename, and run `./demo/assemble.sh` again.
