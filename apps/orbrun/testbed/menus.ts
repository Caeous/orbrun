/**
 * Menus test bed: the client overlays (the button menus, the Start menu) over
 * nothing, for looking at. Served by the dev server at /testbed/menus.html;
 * not part of the build.
 *
 * The rows carry crawl's own tiles (command-menu.ts `tile`), so the bed loads
 * real gamedata through the dev server's proxy rather than drawing the menus
 * without their icons. `GAMEDATA` is one server's published fingerprint, which
 * moves whenever that server updates; when it no longer resolves the menus
 * simply draw as they do before gamedata has loaded, which is worth seeing too.
 */
import { loadGamedata, browserIo, type Gamedata } from '@orbrun/gamedata'
import { Overlays } from '../src/overlays'
import '../src/styles.css'

const GAMEDATA = { host: 'crawl.dcss.io', version: 'acd3d60e20f899c1c8a546953d6ffa0f6c7fe0c8' }

let gamedata: Gamedata | null = null
const host = document.querySelector<HTMLElement>('#app')!
const ov = new Overlays(host, {
  send: (m) => console.log('send', m),
  gamedata: () => gamedata,
  watching: () => false,
  onClientOverlayChange: () => {},
  onSystemAction: (op) => console.log('system', op),
  settingsPanel: () => ({ el: document.createElement('div'), rows: [] }),
})
const run = (a: unknown) => console.log('run', a)
const screens: [string, () => void][] = [
  ['Actions (LB)', () => ov.showCommands(run, 'battle')],
  ['Travel (Select)', () => ov.showCommands(run, 'travel')],
  ['Equipment (Y)', () => ov.showCommands(run, 'equipment')],
  ['Start', () => ov.showSystem({ spectating: false, inGame: true, run })],
  ['Start (spectating)', () => ov.showSystem({ spectating: true, inGame: true, run })],
]
let shown = screens[3]
for (const [label, show] of screens) {
  const b = document.createElement('button')
  b.textContent = label
  b.onclick = () => { shown = [label, show]; show() }
  document.querySelector('#pick')!.append(b)
}
shown[1]()

loadGamedata({ base: `/gamedata-proxy/${GAMEDATA.host}`, version: GAMEDATA.version, io: browserIo() })
  .then((gd) => { gamedata = gd; shown[1]() })
  .catch((e) => console.warn('no gamedata, so no icons:', e))
