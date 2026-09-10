#!/usr/bin/env python3
"""Add (or refresh) the Orbrun non-Steam shortcut and its artwork.

Called by deck.sh; runnable by hand for debugging:

    python3 shortcut.py --steam ~/.local/share/Steam --name Orbrun \
        --exe /usr/bin/flatpak --start-dir /home/deck \
        --args "run com.google.Chrome --kiosk https://orbrun.app/" \
        --icon ~/.local/share/orbrun/icon.png --art ~/.local/share/orbrun/art

shortcuts.vdf is Valve's binary KeyValues format. Layout, per
https://github.com/CorporalQuesadilla/Steam-Shortcut-Manager/wiki/Steam-Shortcuts-Documentation :

    \x00 shortcuts \x00
      \x00 <index> \x00
        \x02 appid \x00 <u32 LE>
        \x01 AppName \x00 <str> \x00
        \x01 Exe \x00 <str> \x00
        ...
        \x00 tags \x00 ... \x08
      \x08
    \x08 \x08

The app id is crc32('"<exe>"<name>') | 0x80000000; grid artwork in
config/grid/ is named after it (<id>p.png, <id>.png, <id>_hero.png,
<id>_logo.png, <id>_icon.png).
"""
from __future__ import annotations

import argparse
import os
import re
import shutil
import sys
import zlib

STR, INT, END = 0x01, 0x02, 0x08


# ---------------------------------------------------------------- vdf i/o

def read_cstr(buf: bytes, pos: int) -> tuple[str, int]:
    end = buf.index(b"\x00", pos)
    return buf[pos:end].decode("utf-8", "replace"), end + 1


def parse(buf: bytes, pos: int = 0) -> tuple[dict, int]:
    """Parse one binary KeyValues object starting at `pos` (after its key)."""
    out: dict = {}
    while True:
        t = buf[pos]
        pos += 1
        if t == END:
            return out, pos
        key, pos = read_cstr(buf, pos)
        if t == 0x00:
            out[key], pos = parse(buf, pos)
        elif t == STR:
            out[key], pos = read_cstr(buf, pos)
        elif t == INT:
            out[key] = int.from_bytes(buf[pos:pos + 4], "little")
            pos += 4
        else:
            raise ValueError(f"unknown vdf type 0x{t:02x} at {pos - 1}")


def emit(obj: dict) -> bytes:
    out = bytearray()
    for key, val in obj.items():
        k = key.encode("utf-8") + b"\x00"
        if isinstance(val, dict):
            out += b"\x00" + k + emit(val)
        elif isinstance(val, int):
            out += bytes([INT]) + k + (val & 0xFFFFFFFF).to_bytes(4, "little")
        else:
            out += bytes([STR]) + k + str(val).encode("utf-8") + b"\x00"
    out += b"\x08"
    return bytes(out)


def load(path: str) -> dict:
    if not os.path.exists(path):
        return {}
    with open(path, "rb") as f:
        buf = f.read()
    if not buf:
        return {}
    assert buf[0] == 0x00, "not a binary vdf"
    key, pos = read_cstr(buf, 1)
    assert key.lower() == "shortcuts", f"unexpected root key {key!r}"
    root, _ = parse(buf, pos)
    return root


def save(path: str, shortcuts: dict) -> None:
    data = b"\x00shortcuts\x00" + emit(shortcuts) + b"\x08"
    tmp = path + ".orbrun.tmp"
    with open(tmp, "wb") as f:
        f.write(data)
    if os.path.exists(path):
        shutil.copy2(path, path + ".orbrun.bak")
    os.replace(tmp, path)


# ---------------------------------------------------------------- steam

def app_id(exe: str, name: str) -> int:
    key = f'"{exe}"{name}'.encode("utf-8")
    return (zlib.crc32(key) & 0xFFFFFFFF) | 0x80000000


def most_recent_user(steam: str) -> str | None:
    """Pick the Steam account: MostRecent in loginusers.vdf, else the only one."""
    userdata = os.path.join(steam, "userdata")
    if not os.path.isdir(userdata):
        return None
    ids = [d for d in os.listdir(userdata) if d.isdigit() and d != "0"]
    if not ids:
        return None
    if len(ids) == 1:
        return ids[0]
    login = os.path.join(steam, "config", "loginusers.vdf")
    if os.path.exists(login):
        text = open(login, encoding="utf-8", errors="replace").read()
        # steamid64 -> accountid (low 32 bits). Text vdf, so a regex is enough.
        for m in re.finditer(r'"(\d{17})"\s*\{([^}]*)\}', text):
            if re.search(r'"MostRecent"\s*"1"', m.group(2)):
                acc = str(int(m.group(1)) & 0xFFFFFFFF)
                if acc in ids:
                    return acc
    ids.sort(key=lambda d: os.path.getmtime(os.path.join(userdata, d)), reverse=True)
    return ids[0]


ART = {  # local file -> grid filename suffix
    "portrait.png": "p.png",
    "grid.png": ".png",
    "hero.png": "_hero.png",
    "logo.png": "_logo.png",
    "icon.png": "_icon.png",
}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--steam", required=True)
    ap.add_argument("--name", required=True)
    ap.add_argument("--exe", required=True)
    ap.add_argument("--start-dir", required=True)
    ap.add_argument("--args", default="")
    ap.add_argument("--icon", default="")
    ap.add_argument("--art", default="")
    ap.add_argument("--user", default=None, help="Steam account id (default: most recent)")
    a = ap.parse_args()

    steam = os.path.expanduser(a.steam)
    user = a.user or most_recent_user(steam)
    if not user:
        print("no Steam account found under", steam, file=sys.stderr)
        return 2
    cfg = os.path.join(steam, "userdata", user, "config")
    os.makedirs(cfg, exist_ok=True)
    path = os.path.join(cfg, "shortcuts.vdf")

    exe = f'"{a.exe}"'
    aid = app_id(exe, a.name)
    entry = {
        "appid": aid,
        "AppName": a.name,
        "Exe": exe,
        "StartDir": f'"{a.start_dir}"',
        "icon": a.icon,
        "ShortcutPath": "",
        "LaunchOptions": a.args,
        "IsHidden": 0,
        "AllowDesktopConfig": 1,
        "AllowOverlay": 1,
        "OpenVR": 0,
        "Devkit": 0,
        "DevkitGameID": "",
        "DevkitOverrideAppID": 0,
        "LastPlayTime": 0,
        "FlatpakAppID": "",
        "tags": {},
    }

    shortcuts = load(path)
    # Replace an existing Orbrun entry (matched by name) or append.
    slot = None
    for k, v in shortcuts.items():
        if isinstance(v, dict) and v.get("AppName", "").lower() == a.name.lower():
            slot = k
            entry["LastPlayTime"] = v.get("LastPlayTime", 0)
            entry["tags"] = v.get("tags", {})
            break
    if slot is None:
        used = {int(k) for k in shortcuts if k.isdigit()}
        slot = str(max(used) + 1 if used else 0)
    shortcuts[slot] = entry
    save(path, shortcuts)

    if a.art and os.path.isdir(a.art):
        grid = os.path.join(cfg, "grid")
        os.makedirs(grid, exist_ok=True)
        for src, suffix in ART.items():
            p = os.path.join(a.art, src)
            if os.path.exists(p):
                shutil.copyfile(p, os.path.join(grid, f"{aid}{suffix}"))

    print(aid)
    return 0


if __name__ == "__main__":
    sys.exit(main())
