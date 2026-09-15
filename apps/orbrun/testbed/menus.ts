/** Menus test bed: the client overlays (the button menus, the Start menu) over nothing, for looking at. */
import { Overlays } from '../src/overlays'
import '../src/styles.css'

const host = document.querySelector<HTMLElement>('#app')!
const ov = new Overlays(host, {
  send: (m) => console.log('send', m),
  gamedata: () => null,
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
for (const [label, show] of screens) {
  const b = document.createElement('button')
  b.textContent = label
  b.onclick = show
  document.querySelector('#pick')!.append(b)
}
screens[3][1]()
