#!/usr/bin/env bash
# Register Shoal on the STRK20 Private Sprint hub.
#
#   ./scripts/register.sh <telegram-username>
#
# Everything except the Telegram handle is already settled and verified against
# starkience/strk20-hackathon's own validate-registry.mjs:
#   repo_url  a GitHub URL                          -> ok
#   slug      lowercase-hyphenated, unused          -> "shoal"
#   category  one the hub filters on                -> "Infra"
#   telegram  non-empty array, bare username        -> the one thing only you have
#
# Their script hard-fails without telegram because registrations merge
# unattended and it is the only contact detail collected. A placeholder would
# fail CI or route a stranger, so it is a real input, not a formality.
set -euo pipefail

TG="${1:-}"
if [ -z "$TG" ]; then echo "usage: $0 <telegram-username>   (no @, no t.me link)"; exit 1; fi
case "$TG" in @*|*t.me*|*http*|*" "*) echo "error: bare username only, no @ / link / spaces"; exit 1;; esac

UPSTREAM=starkience/strk20-hackathon
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

gh repo fork "$UPSTREAM" --clone=false --remote=false >/dev/null 2>&1 || true
FORK="$(gh api user --jq .login)/strk20-hackathon"

git clone -q "https://github.com/$FORK.git" "$WORK/repo"
cd "$WORK/repo"
git remote add upstream "https://github.com/$UPSTREAM.git"
git fetch -q upstream main
git checkout -q -B register-shoal upstream/main

python3 - "$TG" <<'PY'
import json, sys
tg = sys.argv[1]
reg = json.load(open("registry.json"))
if any("iamdflame/shoal" in (e.get("repo_url") or "").lower() for e in reg):
    print("already registered"); raise SystemExit(0)
reg.append({
    "repo_url": "https://github.com/iamdflame/shoal",
    "telegram": [tg],
    "slug": "shoal",
    "name": "Shoal",
    "one_liner": "Anonymity aggregation for STRK20: measure the crowd you are actually hiding in, then route value so it is as large as possible.",
    "category": "Infra",
})
json.dump(reg, open("registry.json", "w"), indent=2, ensure_ascii=False)
open("registry.json", "a").write("\n")
PY

git add registry.json
git -c user.name="Highneighbour" -c user.email="davidpraise288@gmail.com" \
    commit -q -m "Register Shoal"
git push -q -f origin register-shoal

gh pr create --repo "$UPSTREAM" --head "$(gh api user --jq .login):register-shoal" --base main \
  --title "Register Shoal" \
  --body "$(cat <<'BODY'
**Shoal** — anonymity aggregation for STRK20.

Privacy is not encryption; it is the number of people you could have been. An anonymity set fragments along three axes at once — asset (STRK20's per-token subchannels), denomination (public edges carry plaintext amounts), and time (every edge is block-stamped). Intersect them and a pool with hundreds of users offers a crowd of one.

We measured the live STRK20 pool on Starknet mainnet from public `Deposit` and `Withdrawal` events — no keys, no funds, no permission:

- 1,489 participant edges across 570 addresses and 20 assets
- **median effective anonymity set: 1.00**
- 1,232 of 1,286 (asset, denomination, 6h window) cells contain exactly one participant
- largest crowd anywhere in the pool: ten

Effective set is perplexity (`2^H`) over the flow distribution, not a headcount — a hundred operators where one carries 99% of flow is not a crowd of a hundred. Infrastructure is classified from chain state: anonymizers from the pool's own `ExternalContractInvoked` events, sinks as deployed contracts that receive across several assets and never deposit. An earlier measurement was contaminated by exactly this — 68.8% of withdrawals went to one such contract — and the finding held after excluding 34 addresses.

Shoal routes value into the largest crowd available, and ships a general private state machine (`ConclaveMachine.cairo`, compiling against StarkWare's `privacy` package) whose value-conservation invariant holds even against a malicious settler.

This is not a flaw in STRK20 — the pool is young, and small sets follow from low volume. It is the reason an aggregation layer has to exist.

Repo: https://github.com/iamdflame/shoal
BODY
)"
