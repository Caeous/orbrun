# Add Orbrun to Steam

Orbrun is a web page, so it goes into Steam the way any browser does: as a
non-Steam game that opens a kiosk browser on orbrun.app. Five steps, a few
minutes. Nothing to download from anyone and nothing to run, beyond the
browser you pick.

Most of it is the same everywhere. Where adding the shortcut differs by
platform, each step says so. The Steam Deck is the one place with extra
setup, because it ships no browser.

## 1. Get a browser

Any Chromium-family browser works: Chrome, Chromium, Brave, Edge, Vivaldi.
If you already have one, you are done with this step. Firefox and Safari are
not a good fit, because kiosk mode and gamepad support differ.

**On a Steam Deck**, hold the power button and choose **Switch to Desktop**.
Open **Discover**, search **Google Chrome**, install it. Then open **Konsole**
and run the line below, so the Flatpak sandbox lets Chrome see the controller.
Flatseal can do the same from a window if you prefer. The same line applies
on Linux if your browser is a Flatpak, with its id in place of
`com.google.Chrome`.

```sh
flatpak --user override --filesystem=/run/udev:ro com.google.Chrome
```

## 2. Add the browser to Steam

With Steam open, in the top menu: **Games > Add a Non-Steam Game to My
Library**. Tick the browser in the list, or **Browse** to it, then
**Add Selected Programs**.

- **Steam Deck:** Chrome is already in the list once installed from Discover.
- **Windows:** Chrome is usually listed. If not, Browse to
  `C:\Program Files\Google\Chrome\Application\chrome.exe`.
- **Linux:** usually listed. If not, Browse to `/usr/bin/google-chrome`,
  `/usr/bin/chromium` or wherever your distro put it. A Flatpak browser shows
  in the list with its id.
- **Mac:** Browse to `/Applications`, pick **Google Chrome** (or the browser
  you chose).

## 3. Make it launch Orbrun

Right-click the new entry in your library (on a Deck, press the gear or the
options button), choose **Properties**. Rename it to `Orbrun`, and in
**Launch Options** enter:

```
--kiosk https://orbrun.app/
```

To keep Orbrun's logins and settings out of your everyday browser, put
`--user-data-dir=` with a folder of your choice before `--kiosk`. It is
optional; the folder is created if it does not exist.

- **Steam Deck:** `--user-data-dir="/home/deck/.local/share/orbrun" --kiosk https://orbrun.app/`
- **Windows:** `--user-data-dir="C:\Users\YOU\AppData\Local\Orbrun" --kiosk https://orbrun.app/`, with your user name in place of `YOU`
- **Linux:** `--user-data-dir="/home/YOU/.local/share/orbrun" --kiosk https://orbrun.app/`
- **Mac:** `--user-data-dir="/Users/YOU/Library/Application Support/Orbrun" --kiosk https://orbrun.app/`

## 4. Artwork, if you want it

Same everywhere. Open each image and save it, then in Steam set it where
the line says:

- [icon.png](https://orbrun.app/steam/art/icon.png): the small icon, in
  **Properties**, the square beside the name.
- [logo.png](https://orbrun.app/steam/art/logo.png): the logo over the
  banner; on the library page, hover the banner, **Set custom logo**.
- [hero.png](https://orbrun.app/steam/art/hero.png): the wide banner across
  the top of the library page; hover it, **Set custom background**.
- [grid.png](https://orbrun.app/steam/art/grid.png): the wide tile in
  Recent games and Big Picture; right-click the entry, **Manage > Set custom
  artwork**.
- [portrait.png](https://orbrun.app/steam/art/portrait.png): the tall poster
  in the library grid and the Deck's home row; right-click it in the grid,
  **Manage > Set custom artwork**.

## 5. Controller

Same everywhere, and the step people miss. Steam Input treats a non-Steam
shortcut as a desktop app and turns the pad into a mouse. On the shortcut's
page, open the controller icon, **Layout > Templates**, and pick
**Gamepad with Joystick Trackpad**. Do this once.

On a Deck, switch back to Gaming Mode. Steam launches the browser full screen
on orbrun.app, the pad reaches the game as a gamepad, and the shortcut shows
up in your library with the artwork you set.

A kiosk window has no tab to close, so the home screen grows a **Quit** row
under Settings; it is hidden in an ordinary browser tab.
