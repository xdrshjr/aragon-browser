#!/bin/sh
# Install aragon-browser on macOS.
#
# The CLI ships inside the app, so there is nothing to install separately. This
# script opens the dmg and verifies the first-run shim afterwards.
#
#   sh skills/aragon-browser/scripts/install.sh [/path/to/aragon-browser.dmg]
#
# It deliberately does NOT edit your shell profile. Putting your bin directory on
# PATH is printed as a command you run yourself.

set -e

APP="/Applications/aragon-browser.app"
BIN_DIR="$HOME/.local/share/aragon-browser/bin"
SHIM="$BIN_DIR/aragon-browser"

say() { printf '%s\n' "$*"; }
fail() { printf 'error: %s\n' "$*" >&2; exit 1; }

if [ "$(uname -s)" != "Darwin" ]; then
  fail "this script is for macOS; on Windows use scripts/install.ps1"
fi

if [ -d "$APP" ]; then
  say "[install] already installed: $APP"
else
  DMG="$1"
  if [ -z "$DMG" ]; then
    DMG=$(ls -t "$(dirname "$0")/../../../dist/"*.dmg 2>/dev/null | head -n 1 || true)
  fi
  [ -n "$DMG" ] && [ -f "$DMG" ] || fail "no .dmg found; pass it as the first argument"

  say "[install] mounting $DMG"
  MOUNT=$(hdiutil attach "$DMG" -nobrowse -readonly | tail -n 1 | awk -F'\t' '{print $NF}')
  [ -d "$MOUNT" ] || fail "could not mount $DMG"

  say "[install] copying to /Applications"
  cp -R "$MOUNT"/*.app /Applications/ 2>/dev/null || {
    hdiutil detach "$MOUNT" -quiet || true
    fail "copy failed; try again with sudo, or drag the app manually"
  }
  hdiutil detach "$MOUNT" -quiet || true
  [ -d "$APP" ] || fail "the app did not land in /Applications"
fi

# A notarized build would not need this; an unsigned one does.
xattr -dr com.apple.quarantine "$APP" 2>/dev/null || true

if [ ! -x "$SHIM" ]; then
  say "[install] launching once so first-run setup writes the CLI shim..."
  open -a "$APP"
  i=0
  while [ ! -x "$SHIM" ] && [ "$i" -lt 90 ]; do
    sleep 0.5
    i=$((i + 1))
  done
  [ -x "$SHIM" ] || fail "the CLI shim did not appear at $SHIM; open the app and check Agent -> Show setup status"
  say "[install] CLI installed: $SHIM"
fi

case ":$PATH:" in
  *":$BIN_DIR:"*)
    say "[install] ready. Run: aragon-browser skill"
    ;;
  *)
    say "[install] installed, but $BIN_DIR is not on PATH yet."
    say "[install] Add this to your shell profile (~/.zshrc or ~/.bashrc):"
    say ""
    say "    export PATH=\"$BIN_DIR:\$PATH\""
    say ""
    say "[install] Meanwhile: $SHIM skill"
    ;;
esac
