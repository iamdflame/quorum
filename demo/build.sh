#!/usr/bin/env bash
# Build every clip the edit needs, at true 1920x1080.
#
#   ./demo/build.sh cards     just the still cards -> 5s clips
#   ./demo/build.sh terms     the two terminal clips (needs terminal.mjs run first)
#   ./demo/build.sh app       the three browser clips (slow: drives a real Chrome)
#   ./demo/build.sh all
set -euo pipefail
cd "$(dirname "$0")"
SCRATCH=/tmp/claude-1000/-home-dflame-Documents-strk/f873b594-8958-4e61-a4d6-8ca272031589/scratchpad
OUT=clips
mkdir -p "$OUT"

# Everything is encoded the same way so the editor never has to transcode:
# yuv420p for universal playback, CRF 17 for visually lossless, 30fps throughout.
enc() { ffmpeg -y -loglevel error -r 30 "$@" -c:v libx264 -preset slow -crf 17 \
        -pix_fmt yuv420p -movflags +faststart; }

want() { [[ "${1:-all}" == "all" || "${1:-}" == "$2" ]]; }

# ---------------------------------------------------------------- still cards
if want "${1:-all}" cards; then
  for f in out/0*.png; do
    n=$(basename "$f" .png)
    enc -loop 1 -i "$f" -t 5 -vf "scale=1920:1080" "$OUT/card-$n.mp4"
    echo "  card-$n.mp4"
  done
fi

# ------------------------------------------------------------- terminal clips
# A concat list with explicit per-frame durations: the prompt sits for a beat,
# each line lands, then the finished output holds long enough to be read.
term_clip() {
  # Split: bash expands every word of a `local` before assigning any of them,
  # so referring to $name in the same statement reads it unset.
  local name=$1 lead=$2 per=$3 hold=$4
  local dir="$SCRATCH/term-$name" list="$SCRATCH/$name.txt"
  : > "$list"
  local files=("$dir"/f*.png) n=${#files[@]}
  for i in "${!files[@]}"; do
    local d=$per
    [[ $i -eq 0 ]] && d=$lead
    [[ $i -eq $((n-1)) ]] && d=$hold
    printf "file '%s'\nduration %s\n" "${files[$i]}" "$d" >> "$list"
  done
  # The concat demuxer ignores the final entry's duration unless it is repeated.
  printf "file '%s'\n" "${files[$((n-1))]}" >> "$list"
  # Not enc(): its leading -r 30 would apply to the concat demuxer as an INPUT
  # rate and override every `duration` line, collapsing the whole clip to a
  # fraction of a second. The output rate is set after the input instead.
  ffmpeg -y -loglevel error -f concat -safe 0 -i "$list" \
    -vf "scale=1920:1080,fps=30" -r 30 \
    -c:v libx264 -preset slow -crf 17 -pix_fmt yuv420p -movflags +faststart \
    "$OUT/term-$name.mp4"
  echo "  term-$name.mp4"
}

if want "${1:-all}" terms; then
  term_clip verify  1.6 0.70 16
  term_clip linkage 1.2 0.45 6
fi

# -------------------------------------------------------------- browser clips
if want "${1:-all}" app; then
  DISMISS='(()=>{for(const b of document.querySelectorAll("button")){const t=(b.textContent||"").trim().toLowerCase();if(t==="accept all"){b.click();}}document.querySelectorAll("[class*=feedback],[id*=feedback]").forEach(e=>e.style.display="none");return 1;})()'

  node capture.mjs A "https://quorum-strk20.vercel.app/#/" 18 2800
  node capture.mjs B "https://quorum-strk20.vercel.app/#/campaigns/demo-70414" 26 1188
  node capture.mjs C "https://starkscan.co/tx/0x01da6af3260615abebaa5d708c885d8017fb0de2f2001d8269203b5924bb5a8e" 22 1100 "$DISMISS"

  for n in A B C; do
    enc -i "$SCRATCH/frames-$n/f%05d.jpg" -vf "scale=1920:1080" "$OUT/app-$n.mp4"
    echo "  app-$n.mp4"
  done
fi

ls -la "$OUT" | awk 'NR>3 {printf "  %8.1f MB  %s\n", $5/1048576, $9}'
