#!/usr/bin/env bash
# Cut the finished demo from your voiceover.
#
# You do not edit anything. Put eleven audio files in demo/voice/ named 01 to 11
# (mp3 or wav, whatever ElevenLabs gave you), run this, and it times every shot
# to the narration that goes over it.
#
#   ./demo/assemble.sh
#
# A clip shorter than its narration holds on its last frame rather than cutting
# early. A clip longer gets trimmed. Either way the picture never runs out from
# under the voice, which is the one thing that makes a demo look unfinished.
set -euo pipefail
cd "$(dirname "$0")"
SCRATCH=/tmp/claude-1000/-home-dflame-Documents-strk/f873b594-8958-4e61-a4d6-8ca272031589/scratchpad
WORK="$SCRATCH/assemble"; rm -rf "$WORK"; mkdir -p "$WORK"

# block -> the clip that plays under it. Order is the order of the film.
CLIPS=(
  "01:clips/card-01-open.mp4:card:Somebody has to go first"
  "02:clips/card-02-trap.mp4:card:"
  "03:clips/card-03-title.mp4:card:What Quorum is"
  "04:clips/app-A.mp4:live:"
  "05:clips/app-B.mp4:live:A campaign that ran on mainnet"
  "06:clips/app-C.mp4:live:The transactions"
  "07:clips/card-04-verify.mp4:card:Don't believe it - check it"
  "08:clips/term-verify.mp4:live:"
  "09:clips/card-05-leak.mp4:card:What the pool already gives away"
  "10:clips/term-linkage.mp4:live:"
  "11:clips/card-06-end.mp4:card:Links"
)

audio_for() {
  for ext in mp3 wav m4a aac ogg; do
    [[ -f "voice/$1.$ext" ]] && { echo "voice/$1.$ext"; return 0; }
  done
  return 1
}

dur() { ffprobe -v error -show_entries format=duration -of csv=p=0 "$1"; }

missing=()
for entry in "${CLIPS[@]}"; do
  audio_for "${entry%%:*}" >/dev/null || missing+=("${entry%%:*}")
done
if (( ${#missing[@]} )); then
  echo "No audio yet for block(s): ${missing[*]}"
  echo "Put them in $(pwd)/voice/ named 01.mp3 … 11.mp3 and run this again."
  exit 1
fi

echo "Building segments…"
list="$WORK/list.txt"; : > "$list"
: > "$WORK/chapters.txt"
elapsed=0
alist="$WORK/alist.txt"; : > "$alist"

for entry in "${CLIPS[@]}"; do
  IFS=: read -r n clip kind chapter <<< "$entry"
  a=$(audio_for "$n")
  [[ -f "$clip" ]] || { echo "missing clip $clip — run ./build.sh all first"; exit 1; }

  # Half a second of air after each line so it does not feel rushed.
  d=$(awk -v x="$(dur "$a")" 'BEGIN{printf "%.3f", x + 0.5}')

  # Cards resolve out of and into black; live footage cuts hard, which keeps the
  # rhythm from turning into a slideshow.
  if [[ "$kind" == card ]]; then
    vf="tpad=stop_mode=clone:stop_duration=60,trim=0:$d,setpts=PTS-STARTPTS,fade=t=in:st=0:d=0.4,fade=t=out:st=$(awk -v d="$d" 'BEGIN{printf "%.3f", d-0.4}'):d=0.4,fps=30,scale=1920:1080,setsar=1"
  else
    vf="tpad=stop_mode=clone:stop_duration=60,trim=0:$d,setpts=PTS-STARTPTS,fps=30,scale=1920:1080,setsar=1"
  fi

  ffmpeg -y -loglevel error -i "$clip" -filter_complex "[0:v]$vf[v]" -map "[v]" \
    -an -c:v libx264 -preset slow -crf 17 -pix_fmt yuv420p "$WORK/v$n.mp4"

  # Pad the narration to the same length so audio and picture cannot drift.
  ffmpeg -y -loglevel error -i "$a" \
    -af "apad,atrim=0:$d,asetpts=PTS-STARTPTS,aresample=48000" \
    -c:a aac -b:a 192k "$WORK/a$n.m4a"

  # Chapter marks from the real durations, because the ones written by hand in
  # GUIDE.md assume narration timings you have not recorded yet.
  if [[ -n "$chapter" ]]; then
    printf "%d:%02d  %s\n" $((${elapsed%.*} / 60)) $((${elapsed%.*} % 60)) "$chapter" >> "$WORK/chapters.txt"
  fi
  elapsed=$(awk -v e="$elapsed" -v d="$d" 'BEGIN{printf "%.3f", e + d}')

  echo "file '$WORK/v$n.mp4'" >> "$list"
  echo "file '$WORK/a$n.m4a'" >> "$alist"
  printf "  block %s  %5.1fs  %s\n" "$n" "$d" "$(basename "$clip")"
done

echo "Joining…"
ffmpeg -y -loglevel error -f concat -safe 0 -i "$list"  -c copy "$WORK/video.mp4"
ffmpeg -y -loglevel error -f concat -safe 0 -i "$alist" -c copy "$WORK/audio.m4a"

TOTAL=$(dur "$WORK/video.mp4")
ffmpeg -y -loglevel error -i "$WORK/video.mp4" -i "$WORK/audio.m4a" \
  -filter_complex "[0:v]fade=t=in:st=0:d=0.6,fade=t=out:st=$(awk -v t="$TOTAL" 'BEGIN{printf "%.2f", t-0.8}'):d=0.8[v]" \
  -map "[v]" -map 1:a -c:v libx264 -preset slow -crf 18 -pix_fmt yuv420p \
  -c:a aac -b:a 192k -movflags +faststart out/quorum-demo.mp4

echo
printf "Done: demo/out/quorum-demo.mp4  —  %s\n" \
  "$(awk -v t="$(dur out/quorum-demo.mp4)" 'BEGIN{printf "%d:%02d", int(t/60), int(t)%60}')"
[[ $(awk -v t="$(dur out/quorum-demo.mp4)" 'BEGIN{print (t>180)?1:0}') == 1 ]] && \
  echo "WARNING: over 3:00. See the 'If you run long' cuts in SCRIPT.md." || true

cp "$WORK/chapters.txt" out/chapters.txt
echo
echo "Chapters for the YouTube description — paste these, not the ones in GUIDE.md:"
sed 's/^/  /' out/chapters.txt
