#!/usr/bin/env bash
# Render each card to a pixel-exact 1920x1080 PNG.
#
# Two traps this works around:
#   1. --window-size includes ~87px of browser chrome, so a 1080px page ends up
#      partly outside the viewport and the bottom strip renders without any
#      background layers. Render taller, then crop.
#   2. Text at 1x has visibly soft edges. Render at 2x and downsample, which
#      supersamples the type for free.
set -euo pipefail
cd "$(dirname "$0")"
W=${W:-1920}; H=${H:-1080}; PAD=200
mkdir -p out
for f in "$@"; do
  n=$(basename "$f" .html)
  google-chrome --headless=new --disable-gpu --no-sandbox --hide-scrollbars \
    --force-device-scale-factor=2 --virtual-time-budget=8000 \
    --window-size=$W,$((H+PAD)) \
    --screenshot="out/$n.raw.png" "file://$PWD/cards/$n.html" 2>/dev/null
  ffmpeg -y -loglevel error -i "out/$n.raw.png" \
    -vf "crop=$((W*2)):$((H*2)):0:0,scale=$W:$H:flags=lanczos" "out/$n.png"
  rm -f "out/$n.raw.png"
  echo "  rendered $n.png"
done
