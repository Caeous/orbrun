# Add Orbrun to Steam

Orbrun is a web page, so it goes into Steam the same way a browser does: as a
non-Steam game that opens the browser in kiosk mode on orbrun.app. It takes
five steps and a few minutes. There is nothing to download and nothing to run
apart from the browser itself.

The steps are the same on every platform, with a note wherever adding the
shortcut differs. The Steam Deck needs a little extra setup because it
doesn't come with a browser.

## 1. Get a browser

Use a Chromium-based browser: Chrome, Chromium, Brave, Edge or Vivaldi. If you
already have one, skip to step 2. Firefox and Safari don't work as well here,
because their kiosk modes and gamepad support differ.

**On a Steam Deck**, hold the power button and choose **Switch to Desktop**.
Open **Discover**, search for **Google Chrome** and install it. Then open
**Konsole** and run this line, which lets Chrome see the controller from
inside its Flatpak sandbox (Flatseal can make the same change if you'd rather
click than type):

```sh
flatpak --user override --filesystem=/run/udev:ro com.google.Chrome
```

On Linux, run the same line if your browser is a Flatpak, with its id in place
of `com.google.Chrome`.

## 2. Add the browser to Steam

In Steam's top menu, choose **Games > Add a Non-Steam Game to My Library**.
Tick your browser in the list, or use **Browse** to find it, then click **Add
Selected Programs**.

- **Steam Deck:** Chrome is in the list once you've installed it from
  Discover.
- **Windows:** Chrome is usually in the list. If it isn't, browse to
  `C:\Program Files\Google\Chrome\Application\chrome.exe`.
- **Linux:** usually in the list. If not, browse to `/usr/bin/google-chrome`,
  `/usr/bin/chromium`, or wherever your distro installs it. A Flatpak browser
  appears under its id.
- **Mac:** browse to `/Applications` and pick **Google Chrome**, or whichever
  browser you chose.

## 3. Point it at Orbrun

Right-click the new entry in your library (on a Deck, press the gear or
options button) and choose **Properties**. Rename it to `Orbrun`, and set
**Launch Options** to:

```
--kiosk https://orbrun.app/
```

To keep Orbrun's logins and settings separate from your everyday browsing,
add `--user-data-dir=` with a folder of your choice before `--kiosk`. This is
optional, and the folder is created if it doesn't exist.

- **Steam Deck:** `--user-data-dir="/home/deck/.local/share/orbrun" --kiosk https://orbrun.app/`
- **Windows:** `--user-data-dir="C:\Users\YOU\AppData\Local\Orbrun" --kiosk https://orbrun.app/`, with your user name in place of `YOU`
- **Linux:** `--user-data-dir="/home/YOU/.local/share/orbrun" --kiosk https://orbrun.app/`
- **Mac:** `--user-data-dir="/Users/YOU/Library/Application Support/Orbrun" --kiosk https://orbrun.app/`

## 4. Add the artwork (optional)

This is the same on every platform. Save each image, then set it in Steam
where the line says:

- [icon.png](https://orbrun.app/steam/art/icon.png): the small icon. In
  **Properties**, click the square next to the name.
- [logo.png](https://orbrun.app/steam/art/logo.png): the logo over the
  banner. On the library page, hover over the banner and choose **Set custom
  logo**.
- [hero.png](https://orbrun.app/steam/art/hero.png): the wide banner across
  the top of the library page. Hover over it and choose **Set custom
  background**.
- [grid.png](https://orbrun.app/steam/art/grid.png): the wide tile in Recent
  Games and Big Picture. Right-click the entry and choose **Manage > Set
  custom artwork**.
- [portrait.png](https://orbrun.app/steam/art/portrait.png): the tall poster
  in the library grid and on the Deck's home screen. Right-click it in the
  grid and choose **Manage > Set custom artwork**.

## 5. Set up the controller

This is the step people miss, and it's the same everywhere. Steam Input treats
a non-Steam shortcut as a desktop app and turns the controller into a mouse.
On the shortcut's page, click the controller icon, go to **Layout >
Templates** and choose **Gamepad with Joystick Trackpad**. You only need to do
this once.

On a Deck, switch back to Gaming Mode. Launching Orbrun now opens the browser
full screen on orbrun.app, the controller reaches the game as a gamepad, and
your artwork shows in the library.

A kiosk window has no tab to close, so Orbrun adds a **Quit** row under
Settings on its home screen. You won't see it in an ordinary browser tab.
