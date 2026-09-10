#!/bin/sh
# Orbrun Steam Deck installer.
#
#   curl -fsSL https://orbrun.app/deck | sh
#
# What it does (all under your home directory; no sudo, nothing on the
# read-only root filesystem):
#
#   1. Installs Google Chrome as a Flatpak if it is not already there
#      (SteamOS ships no browser; this is the same route Valve documents
#      for cloud gaming).
#   2. Lets the Chrome sandbox see controllers, so the Deck's pad reaches
#      the browser as a real gamepad:
#        flatpak --user override --filesystem=/run/udev:ro com.google.Chrome
#   3. Adds "Orbrun" to Steam as a non-Steam game with artwork, launching
#      Chrome in kiosk mode on https://orbrun.app/ with its own profile.
#
# Read it before you run it. Re-running is safe; it refreshes the shortcut.
#
# Environment overrides:
#   ORBRUN_URL     game url            (default https://orbrun.app/)
#   ORBRUN_ORIGIN  where to fetch files (default derived from ORBRUN_URL)
#   STEAM_DIR      Steam install       (default ~/.local/share/Steam)

set -eu

ORBRUN_URL="${ORBRUN_URL:-https://orbrun.app/}"
ORBRUN_ORIGIN="${ORBRUN_ORIGIN:-${ORBRUN_URL%/}}"
STEAM_DIR="${STEAM_DIR:-$HOME/.local/share/Steam}"
APP_DIR="$HOME/.local/share/orbrun"
CHROME_ID="com.google.Chrome"
NAME="Orbrun"

say() { printf '\033[1;35m[orbrun]\033[0m %s\n' "$*"; }
die() { printf '\033[1;31m[orbrun]\033[0m %s\n' "$*" >&2; exit 1; }

# ---------------------------------------------------------------- checks

[ "$(uname -s)" = Linux ] || die "This installer is for SteamOS / Linux."
command -v flatpak >/dev/null 2>&1 || die "flatpak not found. Is this a Steam Deck?"
command -v python3 >/dev/null 2>&1 || die "python3 not found (SteamOS includes it)."
command -v curl >/dev/null 2>&1 || die "curl not found."

if [ ! -d "$STEAM_DIR/userdata" ] && [ -d "$HOME/.steam/steam/userdata" ]; then
  STEAM_DIR="$HOME/.steam/steam"
fi
[ -d "$STEAM_DIR/userdata" ] || die "Steam not found at $STEAM_DIR. Run Steam once in Desktop Mode, then retry."

say "Installing $NAME from $ORBRUN_ORIGIN"
mkdir -p "$APP_DIR/art" "$APP_DIR/chrome"

# ---------------------------------------------------------------- 1. chrome

if flatpak info "$CHROME_ID" >/dev/null 2>&1; then
  say "Chrome flatpak already installed."
else
  say "Installing Chrome flatpak (a few hundred MB, one time)..."
  flatpak remote-add --user --if-not-exists flathub https://flathub.org/repo/flathub.flatpakrepo
  flatpak install --user -y --noninteractive flathub "$CHROME_ID" \
    || die "Chrome install failed. Install 'Google Chrome' from Discover, then rerun."
fi

# ---------------------------------------------------------------- 2. gamepad

say "Allowing Chrome to see controllers (udev override)..."
flatpak --user override --filesystem=/run/udev:ro "$CHROME_ID"

# ---------------------------------------------------------------- 3. files

fetch() { curl -fsSL "$ORBRUN_ORIGIN/deck/$1" -o "$2" || die "download failed: $1"; }

say "Fetching artwork and helper..."
fetch shortcut.py    "$APP_DIR/shortcut.py"
fetch art/icon.png     "$APP_DIR/art/icon.png"
fetch art/grid.png     "$APP_DIR/art/grid.png"
fetch art/portrait.png "$APP_DIR/art/portrait.png"
fetch art/hero.png     "$APP_DIR/art/hero.png"
fetch art/logo.png     "$APP_DIR/art/logo.png"

# Launcher: kiosk Chrome with its own profile so Orbrun's login tokens and
# settings never mix with a personal browser profile. No first-run bubbles.
cat > "$APP_DIR/orbrun.sh" <<EOF
#!/bin/sh
exec flatpak run $CHROME_ID \\
  --user-data-dir="$APP_DIR/chrome" \\
  --no-first-run --no-default-browser-check --disable-session-crashed-bubble \\
  --autoplay-policy=no-user-gesture-required \\
  --kiosk "$ORBRUN_URL"
EOF
chmod +x "$APP_DIR/orbrun.sh"

# ---------------------------------------------------------------- 4. steam

# Steam rewrites shortcuts.vdf on exit, so it must be closed while we edit.
if pgrep -x steam >/dev/null 2>&1; then
  say "Closing Steam so the shortcut can be written..."
  steam -shutdown >/dev/null 2>&1 || true
  n=0
  while pgrep -x steam >/dev/null 2>&1 && [ $n -lt 30 ]; do sleep 1; n=$((n+1)); done
  pgrep -x steam >/dev/null 2>&1 && die "Steam is still running. Quit it and rerun."
fi

say "Adding $NAME to Steam..."
APPID=$(python3 "$APP_DIR/shortcut.py" \
  --steam "$STEAM_DIR" --name "$NAME" \
  --exe "$APP_DIR/orbrun.sh" --start-dir "$APP_DIR" \
  --icon "$APP_DIR/art/icon.png" --art "$APP_DIR/art") || die "could not write shortcuts.vdf"

# ---------------------------------------------------------------- done

cat <<EOF

$(printf '\033[1;32m')Done.$(printf '\033[0m') "$NAME" is in your Steam library (app id $APPID).

One thing to do by hand, once, in Gaming Mode:
  open Orbrun's page -> controller icon -> Layout -> Templates ->
  pick "Gamepad with Joystick Trackpad" (not "Web Browser").
That makes Steam pass the pad through as a gamepad instead of a mouse.

Switch back to Gaming Mode and play. Start Steam again if you are staying
in Desktop Mode.
EOF
