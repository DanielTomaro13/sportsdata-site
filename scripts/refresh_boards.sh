#!/usr/bin/env bash
# Refresh the STATIC boards on sportsdata-ai.com with freshly captured real data,
# then publish. Free: no hosting, no database — GitHub Pages serves the captures.
#
#   bash scripts/refresh_boards.sh [racing|sports|both]
#
# Racing captures FORWARD in real time (runs its own poller in-process, ~90s).
# Sports sweeps BACKWARD over warehouse history, so it needs ingestion to have
# been running — keep com.sportsdata.agents.scheduler loaded, or run the
# self-contained live board (SPORTSBOARD_LIVE=1).
#
# Designed to be safe under launchd: it never pushes an EMPTY or THIN capture over
# a good one, and it no-ops cleanly when nothing changed.
set -euo pipefail

WHICH="${1:-both}"
SITE="$(cd "$(dirname "$0")/.." && pwd)"
RACING="${RACING_REPO:-$HOME/Documents/Projects/racing-money-flow}"
AGENTS="${AGENTS_REPO:-$HOME/Documents/Projects/sportsdata-agents}"

FRAMES="${FRAMES:-18}"
RACING_SPACING="${RACING_SPACING:-5}"     # seconds between racing frames
SPORTS_SPAN_MIN="${SPORTS_SPAN_MIN:-120}" # minutes of history the sports sweep covers
MIN_FRAMES_WITH_DATA="${MIN_FRAMES_WITH_DATA:-12}"  # frames that must carry entries
MIN_ENTRIES="${MIN_ENTRIES:-4}"   # …and how many races/games the richest frame needs

log() { printf '[refresh %s] %s\n' "$(date '+%H:%M:%S')" "$*"; }

# Reject a capture unless enough frames actually carry games/races — a 3am run or a
# cleared warehouse otherwise publishes an empty board over a good one.
validate() {
  python3 - "$1" "$2" "$MIN_FRAMES_WITH_DATA" "$MIN_ENTRIES" <<'PY'
import json, sys
path, kind, need, need_entries = sys.argv[1], sys.argv[2], int(sys.argv[3]), int(sys.argv[4])
try:
    frames = json.load(open(path))
except Exception as exc:
    print(f"unreadable: {exc}"); sys.exit(1)
if not isinstance(frames, list) or not frames:
    print("not a non-empty frame list"); sys.exit(1)
key = "board" if kind == "racing" else "games"
counts = [len(f.get(key) or ()) for f in frames]
good = sum(1 for c in counts if c)
peak = max(counts, default=0)
print(f"{good}/{len(frames)} frames carry {key}; richest frame has {peak}")
# Non-empty is not enough: a 7am board with a single race in the horizon would
# otherwise overwrite a rich afternoon capture. Require real depth too.
if good < need:
    print(f"  → too few populated frames (need {need})"); sys.exit(1)
if peak < need_entries:
    print(f"  → too thin (need {need_entries}+ {key} entries)"); sys.exit(1)
sys.exit(0)
PY
}

publish() {  # publish <src.json> <dest-dir> <kind>
  local src="$1" dest="$2" kind="$3"
  if ! validate "$src" "$kind"; then
    log "$kind: capture too thin — keeping the existing replay"; return 1
  fi
  mkdir -p "$dest"
  cp "$src" "$dest/replay.json"
  log "$kind: staged $(du -h "$dest/replay.json" | cut -f1)"
}

if [ "$WHICH" = "racing" ] || [ "$WHICH" = "both" ]; then
  log "racing: capturing $FRAMES frames @ ${RACING_SPACING}s (polls live, ~$((FRAMES*RACING_SPACING))s) …"
  PY="$RACING/.venv/bin/python"; [ -x "$PY" ] || PY="python3"
  OUT="$(mktemp -t racing-replay-XXXX.json)"
  if (cd "$RACING" && "$PY" scripts/capture_replay.py "$FRAMES" "$RACING_SPACING" "$OUT" >/dev/null 2>&1); then
    publish "$OUT" "$SITE/board/data" racing || true
  else
    log "racing: capture failed — keeping the existing replay"
  fi
  rm -f "$OUT"
fi

if [ "$WHICH" = "sports" ] || [ "$WHICH" = "both" ]; then
  log "sports: sweeping $FRAMES frames over ${SPORTS_SPAN_MIN}m of history …"
  PY="$AGENTS/.venv/bin/python"; [ -x "$PY" ] || PY="python3"
  OUT="$(mktemp -t sports-replay-XXXX.json)"
  if (cd "$AGENTS" && "$PY" -m sportsdata_agents.interfaces.sportsboard.capture_replay \
        "$FRAMES" "$SPORTS_SPAN_MIN" "$OUT" >/dev/null 2>&1); then
    publish "$OUT" "$SITE/sports/data" sports || true
  else
    log "sports: capture failed — keeping the existing replay"
  fi
  rm -f "$OUT"
fi

cd "$SITE"
if git diff --quiet -- board/data sports/data 2>/dev/null; then
  log "no replay changed — nothing to publish"; exit 0
fi
git add board/data sports/data
git commit -q -m "boards: refresh captured replay data ($(date '+%Y-%m-%d %H:%M'))"
git push -q origin main
log "published → https://sportsdata-ai.com/board  ·  /sports"
