#!/usr/bin/env bash
# Install (or re-sync) the hourly board-refresh launchd job.
#
#   bash scripts/install_refresh_job.sh          # install / update
#   bash scripts/install_refresh_job.sh --status # show state, don't change anything
#   bash scripts/install_refresh_job.sh --uninstall
#
# Why this exists rather than pointing launchd straight at the repo:
# macOS refuses a launchd job both READING a script and WRITING files under
# ~/Documents ("Operation not permitted" — from bash, cp and git alike). So the
# script and a publishing clone are installed under ~/Library, which is not
# gated. Captures still read the source repos in ~/Documents (Python is allowed).
#
# Granting /bin/sh Full Disk Access in System Settings → Privacy & Security
# would let the job run straight from ~/Documents and make the second clone
# unnecessary — but that needs a password, so this is the no-password path.
#
# Run this after ANY edit to refresh_boards.sh, or the job keeps running a stale
# copy. --status tells you if they've drifted.
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
SD="$HOME/Library/Application Support/sportsdata"
BIN="$SD/bin"
CLONE="$SD/sportsdata-site"
PLIST="$HOME/Library/LaunchAgents/com.sportsdata.boards.refresh.plist"
LABEL="com.sportsdata.boards.refresh"
LOG="$SD/logs/boards-refresh.log"
SRC="$REPO/scripts/refresh_boards.sh"
ORIGIN="$(git -C "$REPO" remote get-url origin 2>/dev/null || echo "")"

case "${1:-install}" in
--status)
  echo "repo script : $SRC"
  echo "installed   : $BIN/refresh_boards.sh"
  if [ -f "$BIN/refresh_boards.sh" ]; then
    if diff -q "$SRC" "$BIN/refresh_boards.sh" >/dev/null; then
      echo "  → in sync"
    else
      echo "  → DRIFTED: the job is running an older copy. Re-run this installer."
    fi
  else
    echo "  → not installed"
  fi
  echo "clone       : $CLONE $([ -d "$CLONE/.git" ] && echo "(ok)" || echo "(MISSING)")"
  echo "job         : $(launchctl list | grep "$LABEL" || echo "not loaded")"
  echo "last log    :"; tail -4 "$LOG" 2>/dev/null | sed 's/^/    /' || echo "    (none)"
  exit 0
  ;;
--uninstall)
  launchctl unload "$PLIST" 2>/dev/null || true
  rm -f "$PLIST"
  echo "unloaded and removed $PLIST"
  echo "left in place (delete by hand if you want them gone): $BIN $CLONE"
  exit 0
  ;;
esac

mkdir -p "$BIN" "$SD/logs" "$HOME/Library/LaunchAgents"

# 1. the script, outside ~/Documents. Strip provenance/quarantine xattrs, which
#    are themselves enough to get the exec refused.
cp "$SRC" "$BIN/refresh_boards.sh"
chmod +x "$BIN/refresh_boards.sh"
xattr -c "$BIN/refresh_boards.sh" 2>/dev/null || true

# 2. the publishing clone, also outside ~/Documents
if [ ! -d "$CLONE/.git" ]; then
  [ -n "$ORIGIN" ] || { echo "no git origin on $REPO — cannot create the publishing clone"; exit 1; }
  git clone -q "$ORIGIN" "$CLONE"
else
  git -C "$CLONE" pull -q --ff-only || echo "warning: could not fast-forward $CLONE"
fi

# 3. the job itself
cat > "$PLIST" <<PLIST_EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$LABEL</string>
  <!-- Hourly: capture fresh REAL frames for both boards and publish to GitHub
       Pages. Free — Pages serves the captures, so no server and no database.
       Script and clone live under ~/Library; see install_refresh_job.sh. -->
  <key>ProgramArguments</key>
  <array>
    <string>/bin/sh</string>
    <string>-c</string>
    <string>SITE_REPO="\$HOME/Library/Application Support/sportsdata/sportsdata-site" bash "\$HOME/Library/Application Support/sportsdata/bin/refresh_boards.sh" both</string>
  </array>
  <key>StartInterval</key>
  <integer>3600</integer>
  <key>RunAtLoad</key>
  <false/>
  <key>StandardOutPath</key>
  <string>$LOG</string>
  <key>StandardErrorPath</key>
  <string>$LOG</string>
</dict>
</plist>
PLIST_EOF

plutil -lint "$PLIST" >/dev/null
launchctl unload "$PLIST" 2>/dev/null || true
launchctl load "$PLIST"

echo "installed:"
echo "  script : $BIN/refresh_boards.sh"
echo "  clone  : $CLONE"
echo "  job    : $LABEL (hourly)"
echo
echo "run it now:  launchctl kickstart -k gui/\$(id -u)/$LABEL"
echo "watch it  :  tail -f \"$LOG\""
