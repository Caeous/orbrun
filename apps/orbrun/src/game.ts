import { cm, mapKey, MouseMode, MSGCH, UiState, formattedStringToText, keyMessage, topMenu, type ClientMessage, type GameMessage, type GameState } from '@orbrun/webtiles'
import { autofightTarget, cellKey, dirFromDelta, isThreat, type Billboard, type CellKey, type MapRenderer, type Scene, type SceneCursor } from '@orbrun/scene'
import { linesSince, namedInWarnings, namedMonster } from './warnings'
import { Render3d } from '@orbrun/render-3d'
import { viewmodelFor } from '@orbrun/scene-webtiles'
import { Render2d } from '@orbrun/render-2d'
import { RendererPark } from './park'
import { escapeHtml, h, onDprChange } from './dom'
import type { Session } from './session'
import { CameraController } from './camera'
import { deriveContext, deriveMode, type Context, type Mode } from './context'
import { CONTINUE, HOLD_MS, LEVEL_MAP, barLabels, buttonAction, contextualLabel, armsTapOrHold, holdAction, resolve, screenKey, touchLabels, type TouchLabel, type Action, type BindingLabel, type CommandCategory, type RelDir } from './bindings'
import type { CommandMenu } from './command-menu'
import { ORBIT_WINDOW_MS, Runner, type LastStep } from './runner'
import { Hud, rcFont } from './hud'
import { GridHost, isPhone } from './grid/host'
import { gameSplit, isPortrait, levelMapCanvas, levelMapSplit, touchBeside, touchColumn } from './grid/console'
import { Chat } from './chat'
import { Overlays } from './overlays'
import { directionKey, isTextEntry, keydownMessage } from './keys'
import { isPadActivity, type Button, type GamepadInput, type PadEvent } from './gamepad'
import { gamepadHints, type PadHintEvidence } from './gamepad-hints'
import { isPack, openPackKeys } from './pack-tabs'
import { OKAY_THEN, SHOUT_KEY, SWAP_WEAPONS_KEY, actionNeighbour, actionTab, actionTabOf, type ActionTabId } from './action-tabs'
import { CHAMFER, getSavedView, leftRightTurns, saveSettings, saveView, WALL_INSET, type Settings } from './servers'
import { fovOf, messageLinesOf, setAutoMessageLines, setAutoMinimap, type SettingGroup } from './settings-rows'
import { PerfOverlay, type LogContext } from './perf'
import { MapHold } from './map-hold'
import { SpellBar, SpellBook, type Spell } from './spell-bar'

/** The most drawn pixels per CSS pixel the game view gets (Part IV of rendering-3d.md): the display's density, capped here. */
const VIEW_MAX_DPR = 1
/** at rest the frame loop sleeps, waking to run its body this often, so nothing that changed without waking it waits longer */
const IDLE_TICK_MS = 250
/** how long crawl and we must have said nothing before the spell bar looks its list up (spell-bar.ts) */
const SPELL_LOOK_STILL_MS = 500
/** what the spell bar takes from the log's last row down, in css px: a spell's art (hud.ts SPELL_SLOT) and a gap under it */
const SPELL_ROW_PX = 32 + 6
/** how long after the last thing that wanted a frame the loop keeps the display's rate before it parks (`awake`) */
const ACTIVE_MS = 500

/** css pixels a touch must travel before a press becomes a look drag */
/**
 * How long the renderer's one-off warm-up (`warmRenderer`) may wait for an
 * idle moment before it is run anyway: long enough to keep off the frames the
 * player is waiting for, short enough to be done before a level is drawn.
 */
const WARM_DELAY_MS = 2000
const DRAG_SLOP = 6
/** level-map cells per unit of right-stick look while the map is open */
const MAP_PAN_RATE = 0.12
/** tileweb.cc `zoom_dungeon`: `tile_map_scale` in percent, a step a zoom key, clamped to 20..300 */
const MAP_SCALE_STEP = 10
const MAP_SCALE_MIN = 20
const MAP_SCALE_MAX = 300
/** game.js `show_diameter`: the cells across a full field of view, which the view is fitted to */
const SHOW_DIAMETER = 17
/** the screens a tap on the minimap closes (with Escape) instead of opening the level map over them */
const MINIMAP_CLOSES: ReadonlySet<Mode> = new Set(['more', 'menu', 'popup', 'newgame', 'text', 'yesno', 'prompt', 'crt', 'dialog'])

/**
 * A panel of ours leaves B unnamed (its footer says Esc, a pad player knows
 * B): a finger has no B to know, so the touch bar names it, the way back.
 */
function withBack(labels: BindingLabel[]): BindingLabel[] {
  // the press goes the pad's way (Game.pad: B cancels a panel of ours), so the label's action is never run
  return labels.some((l) => l.button === 'B') ? labels : [...labels, { button: 'B', label: 'Back', action: { kind: 'keys', label: 'Back', seq: [] }, contextual: false }]
}

/** A press on the view, from down to up: a tap, a look drag, or a finger held still (`hold` its timer, `held` once it fired). */
interface Drag {
  id: number
  x: number
  y: number
  x0: number
  y0: number
  moved: boolean
  button: number
  touch: boolean
  hold?: number
  held?: boolean
  /** a finger dragging the level map: css px moved and not yet a whole cell (`panMapBy`) */
  pan?: { x: number; y: number }
}

/** The device the player touched last; the prompt strip is drawn for it. A finger is `touch`, a mouse or a pen `pointer`. */
export type InputDevice = 'pad' | 'keyboard' | 'pointer' | 'touch'

export interface GameHooks {
  settings(): Settings
  /** one group's settings page, with what its Back does and what opens the Gamepad controls sheet (settings-panel.ts) */
  settingsPanel(group: SettingGroup, back: () => void, controls: () => void): { el: HTMLElement; rows: HTMLElement[] }
  onSystem(op: 'disconnect'): void
  gamepad: GamepadInput
  initialInput?: InputDevice
  /** the map view to draw with, in place of the settings' 2D or 3D one (the e2e harness has no WebGL) */
  renderer?(): MapRenderer
}

/**
 * The game screen: canvas + renderer, HUD, overlays, input wiring.
 */
export class GameScreen {
  root: HTMLElement
  private canvas = h('canvas', { class: 'view' })
  private renderer: MapRenderer
  /** the one console grid the screen is set on: the view, the sidebar and the messages are rectangles of its cells */
  private grid: GridHost
  /** what the last layout was made from; the split is redone only when it changes */
  private layoutKey = ''
  private is3d = true
  /** The level map (X) borrowed the 2D renderer while a 3D view is the setting. */
  private mapBorrowed2d = false
  /** The 3D view kept aside while the level map is open, to come back with its level and crowd standing (park.ts). */
  private park = new RendererPark()
  private lastMapView = false
  /** The level map is on screen: crawl's own, or held across a key that left it (map-hold.ts). Set once a frame, before the layout reads it. */
  private mapShown = false
  private mapHold = new MapHold()
  private session: Session
  private cam = new CameraController()
  private runner: Runner
  private hud: Hud
  private chat: Chat
  private overlays: Overlays
  private hooks: GameHooks
  private ctx: Context
  /** frame timing readout (perf.ts), on with `?perf` */
  private perf: PerfOverlay
  private unsub: (() => void)[] = []
  private _needsRender = true
  /**
   * Something for the frame loop to look at: a server message, a key, a
   * pointer, a pad event, a resize, a settings change. Cleared as a frame's
   * body starts, so anything set during it earns another frame. With it
   * clear and nothing moving, the loop's callback returns at once (`awake`).
   */
  private dirty = true
  /** the pointer moved over the view since the last pick, so the hovered cell may have changed */
  private pickDirty = false
  /** when the frame body last ran, for the idle safety tick (IDLE_TICK_MS) */
  private lastBody = 0
  /** when something last wanted a frame, for the run-on before the loop parks (ACTIVE_MS) */
  private lastActive = 0
  /** the settings as last read; cleared by `applySettings`, so a frame reads storage at most once */
  private settingsCache: Settings | null = null
  /** the context as last derived, and the key of what it was derived from */
  private ctxBase: Context | null = null
  private ctxKey = ''
  /** the revisions a frame was last drawn for: only a change to what is drawn (the map, the player, the UI stack) asks for a frame */
  private drawnRev = { map: -1, player: -1, ui: -1 }
  /** A game on this device has no one watching and no one to talk to: no chat box, no Chat row, F12 does nothing. */
  private get chatOn(): boolean {
    return !this.session.server.offline
  }
  /** A frame is needed; setting it also wakes the loop. */
  private get needsRender(): boolean {
    return this._needsRender
  }
  private set needsRender(v: boolean) {
    this._needsRender = v
    if (v) this.wake()
  }
  /** Something happened: the next frame runs its body, and a sleeping loop is started again at once. */
  private wake() {
    this.dirty = true
    if (!this.raf && !this.destroyed) {
      clearTimeout(this.idleTimer)
      this.idleTimer = 0
      // the clock starts again with the loop: an easing's first frame must not be handed the whole sleep as its dt
      this.lastFrame = performance.now()
      this.perf?.profile.resume()
      this.raf = requestAnimationFrame(this.loop)
    }
  }
  /** `rev.player|rev.map` the viewmodel was last built from */
  private viewmodelRev = ''
  /** Scene callbacks flushed inside a frame share its timestamp with both animations. */
  private sceneTime: number | undefined
  private lastFrame = performance.now()
  private raf = 0
  /** the safety tick while the loop sleeps (IDLE_TICK_MS) */
  private idleTimer = 0
  private destroyed = false
  private lastPos = { x: NaN, y: NaN }
  /**
   * The player's position as of the last server message, and every hop it
   * made since the scene was last rebuilt. The scene is rebuilt once per
   * frame, so a fast explore or travel (a busy frame, or `travel_delay -1`)
   * arrives as several cells at once: the hops keep the path the feet took,
   * and the camera can face the way the last step went instead of mistaking
   * the batch for a teleport. `jumped` marks a hop that was not one cell.
   */
  private hopPos = { x: NaN, y: NaN }
  private hops: { dx: number; dy: number }[] = []
  private jumped = false
  /** place and depth the player was last seen on, so a level change is known even when the coordinates barely move */
  private lastLevel = ''
  /** arrived somewhere new before its cells came through: face again once they do */
  private arrivalPending = false
  private lastMonsters = new Set<number>()
  /** the newest message line the warning rule has read (warnings.ts), so each line is judged once */
  private lastWarningLine: GameMessage | undefined
  /** a turn a warning or newcomer earned while the server was not taking commands (a --more--), paid when it does */
  private owedTurn: { names: string[]; newcomer: boolean } | null = null
  private loading = h('div', { class: 'loading' })
  private pressTimes = new Map<string, number>()
  /** A tap-or-hold button down and short of HOLD_MS: its corner prompt fills its hold ring (hud.ts showHold). */
  private holding: { button: Button; fraction: number } | null = null
  /**
   * The pad button that opened the client overlay on screen. Every menu a
   * button opens is a toggle: the same button puts it away, from whatever
   * screen it was carried into (a nested settings page closes with the whole
   * menu, as `close` already does for Select). Null when the overlay was
   * opened by mouse or keyboard, which have Esc.
   */
  private overlayOpener: Button | null = null
  /** The pointer now down closed a menu as it came down (`onDocPointer`); its click is spent on that. */
  private pointerClosed = false
  private lastCursor: SceneCursor | null = null
  private lastOptKey = ''
  private drag: Drag | null = null
  /** Two fingers on the level map: where each is, how far apart they came down, and the zoom steps sent so far (`pinchMap`). */
  private pinch: { pts: Map<number, { x: number; y: number }>; d0: number; scale0: number; sent: number } | null = null
  /** Lets go of a drag with no click behind it: the window lost focus, or the button was released out of sight. */
  private cancelDrag: () => void = () => {}
  /** One per screen, however many canvases it goes through: a renderer swap must not leave the old canvas's listener behind. */
  private onWindowBlur?: () => void
  /** Wheel scrolled since the last camera step, in css pixels; a trackpad arrives in crumbs. */
  private wheel = 0
  /** Shift was down for the wheel crumbs counted so far: distance and height do not pool each other's scroll. */
  private wheelShift = false
  /** where the pointer is aiming, in canvas css pixels: the hovering mouse, or the finger on a touch screen */
  private hover: { x: number; y: number } | null = null
  /** dungeon_renderer.js tooltip_timeout: the cell tooltip waits half a second under a still pointer */
  private tooltipTimer = 0
  /** the pointer moved since the last target sent: keyboard cursor moves and turns never fight the mouse */
  private hoverMoved = false
  private lastTargetSent = -1
  /** a fire's aim holds the view on its default target until the cursor is first stepped (runner `holdingView`) */
  private viewHeld = false
  /** the cursor shown is the pointer's own selection, not one the server placed: never face it */
  private cursorIsOurs = false
  /**
   * the mouse has moved since the last keyboard or pad action: the pointer's
   * own selection shows only then. A key or button hides it until the mouse
   * moves again, so a player on the keys is not shown a cell the reticle
   * happens to rest on after a turn or a step.
   */
  private pointerLive = false
  /** the last pick; a frame that draws nothing new (no pointer, camera or level change) casts no ray */
  private pickMemo: CellKey | null | undefined
  /** the canvas's place on the screen, from the last relayout, in css px */
  private viewPx: { left: number; top: number; width: number; height: number } | null = null
  /** The last tap on the level map: where the cursor stood and where it was sent (`tapMapCursor`). */
  private mapTap: { from: { x: number; y: number }; to: { x: number; y: number }; t: number } | null = null
  /** css px of the level map's canvas under the touch bar (`relayout`) */
  private mapFoot = 0
  /**
   * What the player touched last: the prompt strip is drawn for it (pad
   * glyphs, key caps, nothing for the mouse). Merely plugging in a pad is
   * not input; the front end passes along the device used to launch play.
   */
  private lastInput: InputDevice = 'keyboard'
  private padHints = gamepadHints()
  /** the pack's page last up (pack-tabs.ts), which Y opens it on again */
  private packPage: string | null = null
  /** the item the cursor was last on in each of the pack's pages, by its letter: Y puts the cursor back on it */
  private packRow = new Map<string, number>()
  /** Y opened the pack: the page it is turning to, and whether the pack has been up since */
  private packReturn: { page: string; seen: boolean } | null = null
  /** X's actions as tabs (action-tabs.ts): the one up last, which X opens again */
  private actionTabUp: ActionTabId = 'spells'
  /**
   * A turn to one of X's tabs under way (`openActionTab`): the menu left
   * being put away (`closing`), a tab's key sent and its menu or crawl's
   * refusal awaited (`sent`), or, for Spells, `z`'s question answered with
   * `*` (`listing`). `target` is the tab the player is turning to, `sent`
   * the one whose key is out: presses quicker than crawl move the target
   * only, and the turn goes on from whatever lands. `last` is the log's last
   * line when the key went: crawl's answer is a line after it.
   */
  private actionTurn: { target: ActionTabId; sent: ActionTabId | null; stage: 'closing' | 'sent' | 'listing'; last?: GameMessage; t: number } | null = null
  private padStep: LastStep | null = null
  /** the spells the touch spell bar shows, looked up quietly (spell-bar.ts) */
  private spellBook: SpellBook
  /** the spell bar's taps: the first arms, the second spends */
  private spellBar: SpellBar
  /** when the last message went to the server, and the last came from it, for the spell list's look to wait for a still moment */
  private lastSent = 0
  private lastHeard = 0
  /** the touch bar's last buttons, held through the spell bar's cast prompt */
  private lastTouch: TouchLabel[] | null = null
  private padLooking = false
  /** right-stick travel accumulated toward the next level-map cursor step */
  private mapPan = { x: 0, y: 0 }

  constructor(host: HTMLElement, session: Session, hooks: GameHooks) {
    // first: anything below that asks for a frame (`wake`) schedules the loop
    this.loop = this.loop.bind(this)
    this.session = session
    this.hooks = hooks
    this.root = h('div', { class: 'screen game' })
    host.append(this.root)
    this.root.append(this.canvas, this.loading)
    const st = hooks.settings()
    this.is3d = st.renderer === '3d'
    this.perf = new PerfOverlay(this.root, () => this.perfContext())
    this.unsub.push(this.perf.watch(session))
    this.grid = new GridHost(this.root, this.textPx())
    // a phone's text comes down to fit a phone's console (host.ts PHONE_COLS), asked again at every resize
    this.grid.setLeast(isPhone)
    this.shrinkText()
    this.grid.onfit = () => {
      this.shrinkText()
      this.relayout(true)
    }
    this.renderer = this.makeRenderer()
    this.cam.reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
    this.cam.setRestPitch(radians(st.restPitch))
    // face the camera the way the last session left it (the pitch starts at rest)
    const view = getSavedView()
    if (view) this.cam.restore(view)
    window.addEventListener('pagehide', this.saveView)
    this.hud = new Hud(this.root, {
      onSelectMonster: (b) => this.faceBillboard(b),
      onBarAction: (a) => this.runner.execute(a),
      onMinimapClick: () => this.minimapTap(),
      // on the map with nothing of ours up, as the pad's Start opens it there
      onStatsClick: () => {
        if (this.ctx.mode === 'command' && !this.session.watching && !this.overlays.hasClientOverlay) this.runner.execute({ kind: 'ui', op: 'system' })
      },
      // action_panel.js: items act only in command mode
      onPanelItem: (slot, describe) => {
        if (this.session.state.inputMode !== MouseMode.COMMAND) return
        this.runner.send(describe ? cm.invItemDescribe(slot) : cm.invItemAction(slot))
      },
      onPanelShow: () => this.setPanelShown(true),
      onPanelHide: () => this.setPanelShown(false),
      // action_panel.js: the game-menu button acts only in command mode
      onGameMenu: () => {
        if (this.session.state.inputMode === MouseMode.COMMAND) this.runner.send(cm.mainMenuAction())
      },
      // WebTiles' own settings menu here is the panel's rc options; Orbrun's settings screen is where those live
      onPanelSettings: () => this.overlays.showSettings(),
      // the touch bar's buttons are the pad's, pressed by a finger: the press goes the pad's way (`pad`), the device is the finger
      onTouchButton: (button, down) => {
        this.inputFrom('touch')
        if (down) this.hooks.gamepad.virtualDown(button, performance.now(), true)
        else this.hooks.gamepad.virtualUp(button, performance.now(), true)
      },
      onSpellTap: (spell) => this.spellTap(spell),
      onSpellMore: () => this.spellMore(),
      onTouchSwitch: (key) => {
        this.inputFrom('touch')
        this.overlays.sendSwitch(key)
      },
    })
    this.chat = new Chat(this.root, { send: (m) => this.runner.send(m), padKind: () => this.hooks.gamepad.kind })
    this.overlays = new Overlays(this.root, {
      padKind: () => this.hooks.gamepad.kind,
      send: (m) => this.runner.send(m),
      gamedata: () => this.session.gamedata,
      watching: () => this.session.watching,
      onClientOverlayChange: () => {
        this.tapArmed.clear()
        this.holding = null
        this.needsRender = true
      },
      onSystemAction: (op) => this.systemAction(op),
      settingsPanel: (group, back, controls) => this.hooks.settingsPanel(group, back, controls),
      actionTab: (to) => this.openActionTab(to),
    })
    this.runner = new Runner(session, this.cam, {
      context: () => this.ctx,
      ui: (op, arg, category, section) => this.uiOp(op, arg, category, section),
      osk: (op, dir) => this.overlays.oskOp(op, dir),
      menu: (op) => this.overlays.menuOp(this.session.state, op),
      focus: (op) => this.overlays.focusOp(this.session.state, this.ctx, op),
      status: (t) => this.hud.status(t),
      confirmDangerous: () => this.hooks.settings().confirmStairs,
      now: () => performance.now(),
      swing: () => this.swing(),
      keepMap: () => {
        this.mapHold.begin(performance.now())
        // a frame after the wait, so a hold nothing came for is let go even on a still screen
        setTimeout(() => this.wake(), 1600)
      },
    })
    this.ctx = deriveContext(session.state, session.scene, this.cam.camera, 'micro')
    this.spellBook = new SpellBook({
      send: (m) => this.session.send(m, true),
      changed: () => {
        this.needsRender = true
        this.wake()
      },
      now: () => performance.now(),
    })
    session.hold = (m) => this.spellBook.hold(m)
    session.intercept = (m) => this.spellBook.intercept(m)
    // they go with the screen: a session that outlives it (a reconnect's next screen) gets its own
    this.unsub.push(() => {
      session.hold = null
      session.intercept = null
    })
    this.spellBar = new SpellBar({
      mode: () => this.ctx,
      turn: () => this.session.state.player.turn,
      now: () => performance.now(),
      cast: (spell) => this.runner.execute({ kind: 'keys', label: 'Cast ' + spell.name, seq: [{ text: 'z' }, { text: spell.letter, await: 'prompt' }] }),
      fire: () => this.runner.execute({ kind: 'fire' }),
      cancel: () => this.runner.execute({ kind: 'keys', label: 'Cancel', seq: [{ key: 27 }] }),
    })
    this.lastInput = hooks.initialInput ?? 'keyboard'
    this.padHints.cancel() // no pending server reply survives a screen/run change
    this.unsub.push(
      session.on((e) => {
        if (e.type === 'scene') {
          this.wake()
          this.onScene()
        } else if (e.type === 'state') {
          this.lastHeard = performance.now()
          this.wake()
          this.trackHop()
          this.trackActions(performance.now(), false)
          if (e.msg.msg === 'input_mode') this.payOwedTurn()
          // a new game on the same version reuses the loaded gamedata, so no
          // `gamedata` event follows: only wait when the session is fetching
          if (e.msg.msg === 'game_client' || e.msg.msg === 'go_lobby') {
            if (this.session.gamedata && !this.session.loading) this.hideLoading()
            else this.showLoading('Loading game data…')
          }
        } else if (e.type === 'sent') {
          this.lastSent = performance.now()
        } else if (e.type === 'gamedata') {
          if (e.status === 'ready') {
            this.hideLoading()
            if (this.session.gamedata) {
              this.renderer.setTiles(this.session.gamedata)
              this.warmRenderer(this.renderer)
            }
            this.needsRender = true
          } else if (e.status === 'error') this.showLoading('Could not load game data: ' + (e.detail || ''))
          else this.showLoading(`Loading game data… ${e.done ?? 0}/${e.total ?? 0}`)
        }
      }),
    )
    if (this.session.gamedata) {
      this.renderer.setTiles(this.session.gamedata)
      this.warmRenderer(this.renderer)
      this.hideLoading()
    } else this.showLoading('Loading game data…')
    this.onKeyDown = this.onKeyDown.bind(this)
    window.addEventListener('keydown', this.onKeyDown, true)
    this.onResize = this.onResize.bind(this)
    window.addEventListener('resize', this.onResize)
    // a move to a screen of another density need not resize the window, and every canvas is drawn for the old one
    this.unsub.push(onDprChange(() => {
      this.wake()
      this.relayout(true)
    }))
    this.onDocPointer = this.onDocPointer.bind(this)
    document.addEventListener('pointerdown', this.onDocPointer, true)
    this.onDocContextMenu = this.onDocContextMenu.bind(this)
    document.addEventListener('contextmenu', this.onDocContextMenu, true)
    this.attachPointer(this.canvas)
    this.hud.setMinimapTiles(st.minimapTiles, st.minimapCell)
    this.relayout(true)
    this.wake()
  }

  destroy() {
    setAutoMessageLines(null)
    setAutoMinimap(null)
    this.destroyed = true
    // a finger on the touch bar as it goes (a reconnect, the screen torn down under it) never lifts where the page
    // can hear it: let go here, or a held arrow walks on into the next game. The releases land on nothing (`pad`)
    this.hooks.gamepad.virtualRelease()
    this.hooks.gamepad.fourWay = false
    this.hooks.gamepad.rightStickTurns = false
    this.saveView()
    window.removeEventListener('pagehide', this.saveView)
    cancelAnimationFrame(this.raf)
    clearTimeout(this.idleTimer)
    window.removeEventListener('keydown', this.onKeyDown, true)
    window.removeEventListener('resize', this.onResize)
    document.removeEventListener('pointerdown', this.onDocPointer, true)
    if (this.onWindowBlur) window.removeEventListener('blur', this.onWindowBlur)
    document.removeEventListener('contextmenu', this.onDocContextMenu, true)
    for (const u of this.unsub) u()
    // a key sequence waiting on the server's prompt keeps its own session listener and timer past
    // these subscriptions: ended here, so a screen that is gone sends no follow-up key into the game
    this.runner.abortSequence()
    clearTimeout(this.tooltipTimer)
    this.hud.destroy()
    this.overlays.destroy()
    this.perf.destroy()
    this.grid.destroy()
    document.documentElement.style.removeProperty('--phone-shrink')
    this.renderer.destroy()
    this.park.clear()
    this.root.remove()
  }

  /**
   * On a phone the menus and popups come down with the grid's text (host.ts `setLeast`): they are sized from the
   * page's font (styles.css html), which would leave them a desktop's size over a phone's console. The `phone`
   * class spreads them across the screen (styles.css `.game.phone .popup`).
   */
  private shrinkText() {
    this.root.classList.toggle('phone', this.grid.phone)
    const st = document.documentElement.style
    if (this.grid.phone && this.grid.shrink < 1) st.setProperty('--phone-shrink', this.grid.shrink.toFixed(3))
    else st.removeProperty('--phone-shrink')
  }

  /** The grid's text size: the console cell's font in px, from the UI scale setting. */
  private textPx(): number {
    return Math.round(16 * this.hooks.settings().uiScale)
  }

  /**
   * Set the screen on the grid: the canvas
   * fills the grid and the HUD's panes lie over it on the cells `gameSplit`
   * gives them, sized as game.js `layout` sizes them. While the level map is
   * open the canvas keeps to the clear part of the view and grows over the
   * sidebar and the messages exactly when the rc's `tile_level_map_hide_*`
   * say so (`levelMapSplit`), running on under a phone's touch bar
   * (`levelMapCanvas`). Cheap to call every frame; only acts on change.
   */
  private relayout(force = false) {
    if (!this.hud) return
    const st = this.session.state
    const o = st.options
    const g = this.grid.grid
    const mapView = this.mapShown
    const hideSidebar = mapView && o.tile_level_map_hide_sidebar === true
    const hideMessages = mapView && o.tile_level_map_hide_messages === true
    // no character yet: the official client's crt layer (game.js `set_ui_state`, `client.set_layer("crt")`) covers
    // the sidebar while the new-game chooser has the UI in CRT state (newgame.cc `choose_game`), until the redraw
    // that sends the first `player` (tileweb.cc `redraw`); a continued game has no sheet before that message either.
    const hideStats = hideSidebar || st.uiState === UiState.CRT || !st.player.received
    // the touch bar's rows are its own: along the foot the panes stand above them; on its side, at the right column's
    // foot, the column ends above them and the view keeps its height (touchBeside); with the column gone, the foot
    const beside = touchBeside(g) && !hideSidebar
    const barRows = Math.ceil(this.hud.touchbarHeight / g.ch)
    // the Message lines setting; on Auto a phone's few, elsewhere what the server's `layout` asks for
    const msgRows = messageLinesOf(this.settings(), st.messages.paneHeight, this.grid.phone)
    // off a phone, the settings' Message lines row reads Auto with what this server asks for
    setAutoMessageLines(st.messages.paneHeight)
    // upright, the minimap and the stats pane share a band across the top (gameSplit); the level map takes the band too,
    // standing in for the minimap, the stats pane over its corner
    const band = isPortrait(g) ? this.hud.portraitBand(this.grid) : { rows: 0, cols: 0 }
    // the spell bar's row under the messages, while there is one (spell-bar.ts); the level map has none
    // it stands in the log's last row, the --more-- line's, which is bare whenever the bar shows (spellsLive)
    const spellRows = this.spellsShown() && !mapView ? Math.max(0, Math.ceil(SPELL_ROW_PX / g.ch) - 1) : 0
    const key = [g.cols, g.rows, g.cw, g.ch, g.ox, g.oy, msgRows, hideStats, hideSidebar, hideMessages, window.devicePixelRatio, barRows, beside, this.grid.phone, band.rows, band.cols, spellRows].join(',')
    if (!force && key === this.layoutKey) return
    this.layoutKey = key
    const cells = gameSplit(g, msgRows, undefined, beside ? 0 : barRows, beside ? barRows : 0, beside && barRows ? touchColumn(g) : undefined, band.rows, band.cols, spellRows)
    this.hud.touchBeside = beside
    // the level map's canvas runs on under the touch bar; what rides the map's edges keeps to the part the bar leaves
    const map = mapView ? levelMapSplit(g, cells, { hideSidebar, hideMessages }) : null
    const view = map ? levelMapCanvas(cells, map, beside && barRows > 0, g.rows) : cells.view
    this.grid.place(this.canvas, view)
    const px = this.grid.px(view)
    // upright, the view runs across the whole screen, the grid's margins too, from under the minimap's band down to the
    // screen's foot, under the touch bar (gameSplit)
    if (!map && isPortrait(g)) {
      px.left = 0
      px.width = this.root.clientWidth || px.width
      px.height = Math.max(px.height, this.root.clientHeight - px.top)
      this.canvas.style.left = px.left + 'px'
      this.canvas.style.width = px.width.toFixed(2) + 'px'
      this.canvas.style.height = px.height.toFixed(2) + 'px'
    }
    this.viewPx = px
    // the map is centred, and its cells fitted, on its part above the touch bar (render-2d `foot`)
    const mapPx = map ? this.grid.px(map) : null
    this.mapFoot = mapPx ? Math.max(0, px.top + px.height - mapPx.top - mapPx.height) : 0
    this.renderer.resize(px.width, px.height, this.viewDpr())
    // the view runs on under the touch bar along the foot, where the panes stop (gameSplit): the hands stand where they stop;
    // upright they stand on the screen's bottom edge, behind the log and the bar, which would lift them halfway up the screen
    const msgPx = this.grid.px(cells.messages)
    if (this.renderer instanceof Render3d) {
      this.renderer.setFoot(mapView || isPortrait(g) ? 0 : px.top + px.height - msgPx.top - msgPx.height)
      this.renderer.setUpright(this.upright)
      // upright the log and the bar hide the view's foot, so the lens looks ahead into what is left above them
      this.renderer.setLensFoot(this.upright && !mapView ? px.top + px.height - msgPx.top : 0)
      // Auto's field of view is a computer's or a phone's on its side or upright, and turning the phone (or a browser's
      // device toolbar) changes which
      const lens = this.lensHeld()
      if (lens !== this.lensKey) {
        this.lensKey = lens
        if (!this.settings().fov) this.renderer.setOptions(this.render3dOptions(this.settings()))
      }
    }
    // what rides the view's edges keeps clear of the panes
    const free = map ?? cells.clear
    this.hud.spellRow = spellRows > 0
    this.hud.layout(this.grid, cells, free, { stats: hideStats, sidebar: hideSidebar, messages: hideMessages })
    // the settings' minimap rows read Auto with what it came out as here (kept while the level map has the column)
    if (this.hud.minimapShown) setAutoMinimap(this.hud.minimapShown)
    // a popup and its dim stop short of the touch bar, so its buttons stay in reach under any of them (styles.css .overlay-stack)
    const inset = this.hud.touchbarInset
    this.overlays.root.style.setProperty('--touch-right', inset.right + 'px')
    this.overlays.root.style.setProperty('--touch-bottom', inset.bottom + 'px')
    // the chat box (client.html #chat) sits at the foot of the right column, as wide as the sidebar
    const side = this.grid.px(cells.sidebar)
    const chat = this.chat.root.style
    chat.left = side.left + 'px'
    chat.width = side.width + 'px'
    chat.bottom = Math.max(0, this.root.clientHeight - side.top - side.height) + 'px'
    this.needsRender = true
  }

  /**
   * The left edge, in screen px, of whatever hand is drawn in the right half
   * of the view (rendering-3d.md II.7), so the HUD's corner keeps clear of
   * the weapon; null with no hand there (2D, hands off, unarmed).
   */
  private handsLeft(): number | null {
    if (!this.is3d || !this.viewPx) return null
    let left: number | null = null
    for (const r of (this.renderer as Render3d).handsFootprint()) {
      if (r.x1 <= 0.5) continue
      const x = this.viewPx.left + r.x0 * this.viewPx.width
      if (left === null || x < left) left = x
    }
    return left
  }

  /** Remember the way the camera faces so the next session starts facing the same way (yaw only). */
  private saveView = () => saveView(this.cam.view)

  /**
   * The view's pixel ratio: one drawn pixel per CSS pixel, whatever the
   * display's density (rendering-3d.md Part IV). The view is 32-texel pixel
   * art drawn unfiltered, so a HiDPI display's extra pixels buy it almost
   * nothing and cost a weak GPU most of its fill; the HUD's own canvases and
   * text keep the full density.
   */
  private viewDpr(): number {
    return Math.min(window.devicePixelRatio || 1, VIEW_MAX_DPR)
  }

  /**
   * The 3D view's one-off work, taken off the frame that would otherwise pay
   * for it: the atlases' ink peeled in a worker, and the shaders compiled.
   * Both are what the loading screen is for — in a frame they are the stall
   * on entering a level (docs/front-end-perf.md) — and both are optional, so
   * nothing here waits or fails.
   */
  private warmRenderer(r: MapRenderer) {
    if (!(r instanceof Render3d)) return
    // In a task of its own, never this one: compiling the shaders blocks the
    // thread for as long as the driver takes, and doing it here would hold up
    // the view the player is waiting for to save a stall later on.
    const run = () => {
      void r.warmAtlases()
      void r.warmShaders()
    }
    const idle = (window as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => void }).requestIdleCallback
    if (idle) idle.call(window, run, { timeout: WARM_DELAY_MS })
    else setTimeout(run, 0)
  }

  private makeRenderer(): MapRenderer {
    const st = this.hooks.settings()
    const r: MapRenderer = this.hooks.renderer?.() ?? (this.is3d ? new Render3d(this.render3dOptions(st)) : new Render2d({ cellSize: 32 }))
    r.mount(this.canvas)
    this.viewmodelRev = ''
    if (this.session.gamedata) {
      r.setTiles(this.session.gamedata)
      this.warmRenderer(r)
    }
    r.setScene(this.session.scene)
    r.setCamera(this.cam.camera)
    return r
  }

  /**
   * The parked 3D view back on duty (park.ts): its level and crowd stand as
   * they were; it is handed only what may have changed while the map was
   * open — a new tileset, changed settings — and the scene to sync against.
   */
  private revive(kept: { renderer: Render3d; tiles: unknown; optionsKey: string }): MapRenderer {
    const r = kept.renderer
    const st = this.hooks.settings()
    this.viewmodelRev = ''
    if (this.session.gamedata && this.session.gamedata !== kept.tiles) {
      r.setTiles(this.session.gamedata)
      this.warmRenderer(r)
    }
    const opts = this.render3dOptions(st)
    if (JSON.stringify(opts) !== kept.optionsKey) r.setOptions(opts)
    r.resetMotion() // the map may have hidden intermediate steps; never replay an old walk on return
    r.setScene(this.session.scene)
    r.setCamera(this.cam.camera)
    return r
  }

  applySettings() {
    this.settingsCache = null
    const st = this.settings()
    this.cam.setRestPitch(radians(st.restPitch))
    document.documentElement.style.setProperty('--ui-scale', String(st.uiScale))
    this.grid.setTextSize(this.textPx())
    this.shrinkText()
    const want3d = st.renderer === '3d' && !this.mapBorrowed2d
    // a 3D view parked for the map's close has no close to return to once the setting is 2D
    if (st.renderer !== '3d') this.park.clear()
    if (want3d !== this.is3d) this.toggleRenderer()
    else if (this.is3d) (this.renderer as Render3d).setOptions(this.render3dOptions(st))
    // the minimap's size is the layout's to set
    this.hud.setMinimapTiles(st.minimapTiles, st.minimapCell)
    this.relayout(true)
    this.needsRender = true
  }

  /** The settings, read from storage once and kept until `applySettings` says they changed. */
  private settings(): Settings {
    return (this.settingsCache ??= this.hooks.settings())
  }

  /** A phone held upright: the hands shrink with the view's width (render-3d `setUpright`), and the minimap is north up. */
  private get upright(): boolean {
    return this.grid.phone && isPortrait(this.grid.grid)
  }

  /**
   * How wide the 3D view opens across, in radians: the Field of view setting
   * is the vertical angle, so the across one follows the view's shape. The
   * parked view's own lens while the level map has it put away.
   */
  private viewFov(): number {
    const lens = (this.renderer instanceof Render3d ? this.renderer : this.park.kept)?.projector()
    const aspect = lens ? lens.aspect : this.viewPx && this.viewPx.height ? this.viewPx.width / this.viewPx.height : 16 / 9
    const tanHalfY = lens ? lens.tanHalfY : Math.tan((fovOf(this.settings(), this.grid.phone, this.upright) * Math.PI) / 360)
    return 2 * Math.atan(tanHalfY * aspect)
  }

  /** how the device was held when the 3D view's Auto field of view was last set (`relayout`) */
  private lensKey: 'desktop' | 'sideways' | 'upright' = 'desktop'
  private lensHeld() {
    return !this.grid.phone ? 'desktop' : this.upright ? 'upright' : 'sideways'
  }

  private render3dOptions(st: Settings) {
    return { eyeHeight: st.eyeHeight, fov: fovOf(st, this.grid.phone, this.upright), viewmodel: st.viewmodel, wallInset: WALL_INSET, chamfer: CHAMFER, motion: !this.cam.reducedMotion }
  }

  /** A melee attack lifts the weapon a touch (rendering-3d.md II.7); frames follow until it settles. */
  private swing() {
    if (!this.is3d) return
    ;(this.renderer as Render3d).attack()
    this.needsRender = true
  }

  /**
   * The hands hold what the `player` message says is wielded, and what the
   * paperdoll on the player's cell says the off hand carries (a shield
   * arrives by `map`, not `player`, and on a new level the cell lands after
   * the first `player`). Rebuilt when either message changes; the renderer
   * ignores a rebuild that holds the same items.
   */
  private syncViewmodel(st: GameState) {
    const rev = `${st.rev.player}|${st.rev.map}`
    if (!this.is3d || rev === this.viewmodelRev) return
    this.viewmodelRev = rev
    ;(this.renderer as Render3d).setViewmodel(viewmodelFor(st, this.session.gamedata ?? undefined))
  }

  /**
   * Swap 2D ⇄ 3D. The outgoing view is destroyed, except a 3D view the level
   * map puts aside, which is parked, canvas and all, for the map's close
   * (park.ts).
   */
  private toggleRenderer() {
    const old = { canvas: this.canvas, renderer: this.renderer }
    this.is3d = !this.is3d
    // the 3D view parked while the map was open comes back with its own canvas (park.ts); otherwise a fresh
    // canvas, since WebGL and 2D contexts cannot share one
    const kept = this.is3d ? this.park.take() : null
    const c = kept ? kept.canvas : h('canvas', { class: 'view' })
    old.canvas.replaceWith(c)
    this.canvas = c
    if (!kept) this.attachPointer(c)
    this.renderer = kept ? this.revive(kept) : this.makeRenderer()
    // the cursor the frame just placed went to the outgoing renderer: a level map opened by X or from the
    // ctrl-f results lands its `ui_state` and its map cursor (tileweb.cc `load_dungeon`) in one frame, so the
    // map view made here never saw the cursor; and a 3D view back from the park still wore the map's
    this.renderer.setCursor(this.lastCursor)
    this.lastOptKey = ''
    this.relayout(true)
    this.needsRender = true
    if (old.renderer instanceof Render3d && this.mapBorrowed2d && !this.is3d) {
      this.park.keep({ canvas: old.canvas, renderer: old.renderer, tiles: this.session.gamedata, optionsKey: JSON.stringify(this.render3dOptions(this.hooks.settings())) })
      return
    }
    old.renderer.destroy()
  }

  private showLoading(text: string) {
    this.loading.textContent = text
    this.loading.style.display = ''
  }
  private hideLoading() {
    this.loading.style.display = 'none'
  }

  private onResize() {
    this.wake()
    // the grid host watches the root too; a window resize is the sure signal on browsers without a ResizeObserver
    this.grid.fit()
  }

  // ------------------------------------------------------------- frame loop

  private loop(now: number) {
    this.raf = requestAnimationFrame(this.loop)
    const dt = Math.min(0.1, (now - this.lastFrame) / 1000)
    this.lastFrame = now
    this.sceneTime = now / 1000
    const perf = this.perf?.enabled ? this.perf.profile : null
    perf?.begin(now)
    try {
      if (this.session.flushScene()) {
        this.needsRender = true
        perf?.tag('scene')
      }
    } finally {
      this.sceneTime = undefined
    }
    perf?.mark('scene')
    const beforeLook = { yaw: this.cam.camera.yaw, pitch: this.cam.camera.pitch }
    if (this.advancePresentation(dt, now / 1000)) this.needsRender = true
    perf?.mark('present')
    if (!this.awake(now)) {
      // nothing to do and nothing moving: no frames until something happens (`wake`) or the safety tick
      cancelAnimationFrame(this.raf)
      this.raf = 0
      this.idleTimer = window.setTimeout(this.idleTick, IDLE_TICK_MS)
      perf?.resume()
      return
    }
    this.dirty = false
    this.lastBody = now
    // what is drawn changed: the map, the player, the UI stack (a menu's cursor, the level map opening)
    const rev = this.session.state.rev
    if (rev.map !== this.drawnRev.map || rev.player !== this.drawnRev.player || rev.ui !== this.drawnRev.ui) {
      this.drawnRev = { map: rev.map, player: rev.player, ui: rev.ui }
      this.needsRender = true
    }
    if (this.padLooking && this.lastInput === 'pad' && this.ctx.mode === 'command' && !this.overlays.hasClientOverlay && !this.session.watching) {
      const after = this.cam.camera
      const yaw = Math.atan2(Math.sin(after.yaw - beforeLook.yaw), Math.cos(after.yaw - beforeLook.yaw))
      this.padHints.lookedBy(Math.hypot(yaw, after.pitch - beforeLook.pitch))
    }
    if (this.is3d && (this.renderer as Render3d).animating) this.needsRender = true
    const st = this.session.state
    // overlays first: the popup's parsed actions and the focus cursor feed the context and the action bar
    // the device first: the overlays decide what to bring up with a server prompt by who spoke last
    this.overlays.setDevice(this.lastInput)
    this.overlays.update(st)
    // The gamedata fetch runs while the game is already talking: the launcher's
    // save-transfer question (a `show_dialog`) comes up with the veil still
    // over the screen. A veil that swallowed the click would strand the player,
    // so while anything of the server's is up it stands behind the overlays.
    this.loading.classList.toggle('behind', !!(st.dialog || st.menus.length || st.ui.length || st.textInput))
    this.ctx = this.deriveContext(st)
    const walking = this.is3d && this.ctx.mode === 'command'
    this.hooks.gamepad.fourWay = walking
    this.hooks.gamepad.rightStickTurns = walking && this.settings().rightStick === 'turn' && !this.overlays.hasClientOverlay && !this.chat.capturing
    this.fireHolds(now)
    // the server reports targeting alone; the runner knows whether its `x` opened it
    if (this.runner.examining(this.ctx.mode)) this.ctx.examining = true
    this.viewHeld = this.runner.holdingView(this.ctx.mode)
    if (this.ctx.mode === 'popup') this.ctx.popupActions = this.overlays.popupActions()
    if (this.ctx.mode === 'menu') this.ctx.switches = this.overlays.menuSwitches()
    if (this.ctx.mode === 'popup') this.ctx.switches = this.overlays.popupSwitches()
    this.overlays.updatePrompt(this.ctx.mode, this.ctx.prompt, this.lastInput)
    this.overlays.syncFocus(this.ctx)
    const fi = this.overlays.focusInfo(this.ctx)
    if (fi) this.ctx.focus = fi
    this.ctx.pageable = this.overlays.pageable(this.ctx)
    this.trackPack()
    this.trackActions(now, true)
    this.spellFrame()
    if (this.padHints.waiting) this.padHints.observe(this.padHintEvidence(), now)
    const cursor = this.cursorFor()
    const lc = this.lastCursor
    if ((cursor?.x !== lc?.x || cursor?.y !== lc?.y || cursor?.mode !== lc?.mode || cursor?.tile !== lc?.tile) && !(cursor === null && lc === null)) {
      const movedTo = cursor && (cursor.x !== lc?.x || cursor.y !== lc?.y)
      this.lastCursor = cursor
      this.renderer.setCursor(cursor)
      // the pointer's own hover cell stays out of the minimap; only a cursor the server placed shows there
      this.hud.setCursor(this.cursorIsOurs ? null : cursor)
      this.needsRender = true
      if (movedTo && !this.cursorIsOurs) this.faceCursor(cursor)
    }
    this.mapShown = this.mapHold.shown(st.uiState === UiState.VIEW_MAP, this.ctx.mode, now)
    this.relayout()
    this.syncMapRenderer()
    this.applyServerOptions()
    this.hud.keepClear(this.handsLeft())
    // the monster list or the edge pips, one or the other; in 2D the top-down view frames everything in sight, so the list stands in
    const settings = this.settings()
    const nearby = this.is3d ? settings.nearby : 'list'
    // one of our own panels has its prompts from the panel (Overlays.padPrompts), set under it as crawl's menus' are
    const ours = this.overlays.padPrompts
    const padLabels = this.chat.capturing ? [] : ours ?? this.padHints.prompts(this.ctx, settings.hints)
    // A held tap-or-hold button (B: Wait, hold for Rest) shows its prompt while it is down, even when the
    // situation did not put it in the corner, so the hold's progress has a place to show. It joins the
    // contextual ones, under the lessons.
    const held = this.holding
    if (held && !padLabels.some((l) => l.button === held.button)) {
      const l = barLabels(this.ctx).find((l) => l.button === held.button)
      if (l) {
        const at = padLabels.findIndex((l) => l.teaching)
        padLabels.splice(at < 0 ? padLabels.length : at, 0, l)
      }
    }
    // north up: the ground and all on it stand unturned, and the map is drawn without its north mark. A phone held
    // upright has it so whatever the setting: the map is a square there (hud.ts bandFit), whose corners would swing in
    // and out of the level as it turned
    const turns = settings.minimapTurns && !this.upright
    this.hud.minimapTurns = turns
    this.hud.minimapUp = turns ? this.cam.mapYaw : 0
    this.hud.minimapUpright = turns ? this.cam.mapUprightYaw : 0
    // and marks the way the 3D view faces instead, as the level map does
    this.hud.minimapFov = !turns && this.renderer instanceof Render3d ? this.viewFov() : null
    // a finger gets every button the screen has, by its word (bindings.ts touchLabels); a panel of ours names its own.
    // A spectator's too: B and Start open the Orbrun menu, where Stop watching is, the one way out on a phone
    // the bar's cast passes through crawl's "Cast which spell?" on its way to the aim: the buttons hold still through it,
    // rather than flash the prompt's own for a frame or two
    const passing = this.castPrompt()
    const touch = passing ? this.lastTouch : this.lastInput === 'touch' && !this.chat.capturing ? touchLabels(ours ? withBack(ours) : barLabels(this.ctx), this.ctx, !!ours) : null
    this.lastTouch = touch
    this.hud.update(st, this.session.scene, this.cam.camera, this.ctx, this.hooks.gamepad.kind, this.session.gamedata, this.session.watching, this.lastInput, nearby, settings.hints !== 'off', padLabels, held, !this.overlays.hasClientOverlay && !this.chat.capturing, !!ours, touch)
    this.hud.renderSpellBar(this.spellsShown() && this.spellsLive() ? { spells: this.spellBook.spells, lit: this.spellBar.lit() } : null, this.session.gamedata)
    this.chat.update(st, this.chatOn && (st.phase === 'playing' || st.phase === 'watching'), !!st.lobby.username)
    this.syncTarget()
    perf?.mark('ui')
    if (this.needsRender) {
      this.needsRender = false
      this.syncViewmodel(st)
      perf?.mark('viewmodel')
      // dungeon_renderer.js set_view_center: the 2D view sits on the server's view
      // centre (`vgrdc`), the player in normal play and the map cursor while the
      // level map is open, so the map scrolls under the cursor as WebTiles' does. A map borrowed from the
      // 3D view marks the way that view faces, which a north-up map otherwise loses.
      if (this.renderer instanceof Render2d) this.renderer.setOptions({ center: st.map.viewCenter, facing: this.mapBorrowed2d ? { yaw: this.cam.camera.yaw, fov: this.viewFov() } : null })
      this.renderer.setScene(this.session.scene, now / 1000)
      this.renderer.setCamera(this.cam.camera)
      const r3d = this.renderer instanceof Render3d ? this.renderer : null
      // the 3D renderer marks its own stretches (level, bake, fields, crowd, place, draw) when measured
      if (r3d) r3d.mark = perf ? (n) => perf.mark(n) : null
      this.renderer.render(now / 1000)
      perf?.mark('render')
      // a frame that drew: the key whose answer it put on the screen stops waiting (perf.ts `drew`)
      if (perf) this.perf.net.drew()
      // edge pips follow the frame just drawn: only a 3D frame has a lens to be out of
      this.hud.renderPips(this.session.scene, st, this.session.gamedata, r3d ? r3d.projector() : null, nearby === 'pips' ? 'all' : 'off')
      perf?.mark('pips')
    }
    perf?.end()
  }

  /**
   * What was on the screen when a perf sample was taken (perf.ts
   * `LogContext`). A timing says what was slow; this says what it was slow
   * on, and the renderer's own counters say how much of it was work the
   * frame chose to do — a `level` of 28 ms with the chunk counter stepping
   * once is the chunk rebuild working, and the same 28 ms with it stepping
   * forty times is not.
   */
  private perfContext(): LogContext {
    // the log's header is written while this screen is still being built, before the first frame
    // derived either of them: nothing here may assume the loop has run
    const ctx = this.ctx as Context | undefined
    const r3d = this.renderer instanceof Render3d ? this.renderer : null
    return {
      mode: ctx?.mode,
      place: this.session.state.player.place ? `${this.session.state.player.place}:${this.session.state.player.depth}` : undefined,
      cells: this.session.scene.cells.size,
      crowd: this.session.scene.billboards.length,
      counters: r3d ? { ...r3d.stats } : undefined,
      loading: this.session.loading,
    }
  }

  /** One timestamp for the camera's movement and the sprites rendered this frame. */
  private advancePresentation(dt: number, now: number): boolean {
    this.renderer.setScene(this.session.scene, now)
    return this.cam.update(dt, now)
  }

  /**
   * The context of the frame (context.ts `deriveContext`): scans of the
   * scene's billboards and the message log, so it is derived once per change
   * of what it reads (every message bumps `rev.any`; a scene rebuild bumps
   * `scene.revision`; a turn changes the facing) and copied for the fields
   * the frame fills in afterwards (`examining`, `popupActions`, `focus`).
   */
  private deriveContext(st: GameState): Context {
    const key = `${st.rev.any}|${this.session.scene.revision}|${this.cam.camera.facing}`
    if (!this.ctxBase || key !== this.ctxKey) {
      this.ctxKey = key
      this.ctxBase = deriveContext(st, this.session.scene, this.cam.camera, 'micro')
    }
    return { ...this.ctxBase }
  }

  /** The safety tick: a frame after IDLE_TICK_MS asleep, so anything that changed without waking the loop is seen. */
  private idleTick = () => {
    this.idleTimer = 0
    if (!this.raf && !this.destroyed) {
      this.lastFrame = performance.now()
      this.perf?.profile.resume()
      this.raf = requestAnimationFrame(this.loop)
    }
  }

  /**
   * Whether this frame has anything to do. At rest (no message, no input,
   * nothing easing or animating, no hold under way) the loop's body is
   * skipped whole, so an idle game costs the CPU nothing but the callback.
   * A safety tick every IDLE_TICK_MS still runs the body, so anything that
   * changes state without waking the loop (a runner's timeout, a tooltip)
   * is seen within a quarter second.
   *
   * Play is not one event but a stream of them: a step, the messages it
   * brings, the turn that follows. Parking between them would hand the
   * frames back to whatever woke the loop next, so they would arrive when a
   * packet did rather than when the display asked, which reads as judder
   * however many of them there are. So the loop holds the display's rate for
   * ACTIVE_MS past the last thing that wanted a frame, and only then parks.
   */
  private awake(now: number): boolean {
    if (this.busy()) {
      this.lastActive = now
      return true
    }
    if (now - this.lastActive < ACTIVE_MS) return true
    // the safety tick woke the loop: a frame's body, and then sleep again
    return now - this.lastBody >= IDLE_TICK_MS
  }

  /** Something wants this frame: a message, an input, an easing, an animation, a hold. */
  private busy(): boolean {
    if (this.dirty || this._needsRender || this.pickDirty || this.hoverMoved) return true
    if (this.cam.steering || this.padLooking) return true
    if (this.is3d && (this.renderer as Render3d).animating) return true
    return this.pressTimes.size > 0 || this.padHints.waiting
  }

  /**
   * The level map (X) is the WebTiles 2D view fullscreen: while it is open
   * a 3D view swaps to the 2D renderer, and swaps back when it closes. The
   * swap is a cut, in the frame the server's `ui_state` lands: the map is
   * there to be read, and nothing stands between the key and the reading.
   */
  private syncMapRenderer() {
    const mapView = this.mapShown
    if (mapView === this.lastMapView) return
    this.lastMapView = mapView
    if (mapView) {
      if (this.is3d) {
        this.mapBorrowed2d = true
        this.toggleRenderer()
      }
      this.hud.hideMinimap()
    } else {
      if (this.mapBorrowed2d) {
        this.mapBorrowed2d = false
        if (!this.is3d) this.toggleRenderer()
      }
      this.hud.showMinimap()
    }
  }

  /** A deliberate view switch by the player sticks, even inside the level map. */
  private userToggleRenderer() {
    this.mapBorrowed2d = false
    this.toggleRenderer()
  }

  /**
   * Honour the rc options the server sends (the same `options` message the
   * official client reads): tile size and scales, display mode, minibars,
   * level-map pane hiding, fonts. Cheap to call every frame; only acts on change.
   */
  private applyServerOptions() {
    const st = this.session.state
    const o = st.options
    const p = st.player
    const mapView = this.mapShown
    const key = JSON.stringify([
      this.is3d,
      mapView,
      // the cell size is fitted to the view (`cellPixels`), so its size belongs to the key (`relayout` ran first in the frame)
      this.viewPx?.width,
      this.viewPx?.height,
      this.mapFoot,
      o.tile_cell_pixels,
      o.tile_viewport_scale,
      o.tile_map_scale,
      o.tile_display_mode,
      o.tile_filter_scaling,
      o.tile_show_minihealthbar,
      o.tile_show_minimagicbar,
      p.hp,
      p.hp_max,
      p.mp,
      p.mp_max,
      o.tile_level_map_hide_messages,
      o.tile_level_map_hide_sidebar,
      o.glyph_mode_font,
      o.tile_font_msg_family,
      o.tile_font_msg_size,
      o.tile_font_stat_family,
      o.tile_font_stat_size,
      o.tile_font_crt_family,
      o.tile_font_crt_size,
      o.tile_font_lbl_family,
      o.tile_font_lbl_size,
      o.custom_text_colours,
    ])
    if (key === this.lastOptKey) return
    this.lastOptKey = key
    // (the level map's pane hiding is the grid's: `relayout` and `levelMapSplit`)
    // fonts: a family or size from the rc overrides the theme for text off the grid (CRT screens, labels);
    // WebTiles' default "monospace" maps to ours. The grid's own cells keep the one grid font (console-grid.md).
    const rs = document.documentElement.style
    const font = (fam: unknown, size: unknown, v: string) => {
      if (typeof fam === 'string' && fam && fam !== 'monospace') rs.setProperty(`--font-${v}`, fam)
      else rs.removeProperty(`--font-${v}`)
      if (typeof size === 'number' && size > 0) rs.setProperty(`--font-${v}-size`, size + 'px')
      else rs.removeProperty(`--font-${v}-size`)
    }
    font(o.tile_font_msg_family, o.tile_font_msg_size, 'msg')
    font(o.tile_font_stat_family, o.tile_font_stat_size, 'stat')
    font(o.tile_font_crt_family, o.tile_font_crt_size, 'crt')
    font(o.tile_font_lbl_family, o.tile_font_lbl_size, 'lbl')
    // game.js init_custom_text_colours: the rc may replace any of the 16 terminal colours
    for (let i = 0; i < 16; i++) rs.removeProperty('--color-' + i)
    if (Array.isArray(o.custom_text_colours)) {
      for (const c of o.custom_text_colours as { index: number; r: number; g: number; b: number }[]) {
        if (typeof c?.index === 'number') rs.setProperty('--color-' + c.index, `rgb(${c.r}, ${c.g}, ${c.b})`)
      }
    }
    // cell_renderer.js draw_minibars: the player's bars, when tile_show_minihealthbar / tile_show_minimagicbar allow
    const minibars = { hp: p.hp, hpMax: p.hp_max, mp: p.mp, mpMax: p.mp_max, showHp: o.tile_show_minihealthbar !== false, showMp: o.tile_show_minimagicbar !== false }
    if (!this.is3d) {
      const num = (v: unknown, d: number) => (typeof v === 'number' && v > 0 ? v : d)
      const px = num(o.tile_cell_pixels, 32)
      const scale = mapView ? num(o.tile_map_scale, 60) : num(o.tile_viewport_scale, 100)
      const mode = o.tile_display_mode === 'glyphs' ? 'glyphs' : o.tile_display_mode === 'hybrid' ? 'hybrid' : 'tiles'
      ;(this.renderer as Render2d).setOptions({
        cellSize: this.cellPixels(Math.max(8, Math.round((px * scale) / 100)), mode),
        mode,
        foot: mapView ? this.mapFoot : 0,
        filterScaling: o.tile_filter_scaling === true,
        glyphFont: rcFont(o.glyph_mode_font),
        minibars,
      })
    }
    this.needsRender = true
  }

  /**
   * dungeon_renderer.js `fit_to`: the cells from the rc options, shrunk to fit
   * if a full field of view (game.js `show_diameter`) would not otherwise
   * stand in the view. Glyph modes size their cells from the font instead, so
   * they are left alone. The level map is not fitted, as WebTiles' is: on a
   * phone the fit already holds its default scale, and zooming in did nothing.
   */
  private cellPixels(cell: number, mode: string): number {
    if (mode === 'glyphs' || this.mapShown) return cell
    const w = this.canvas.clientWidth
    const h = this.canvas.clientHeight - (this.mapShown ? this.mapFoot : 0)
    if (!w || h <= 0) return cell
    const span = SHOW_DIAMETER * cell
    if (span <= w && span <= h) return cell
    return Math.max(1, Math.floor(cell * Math.min(w / span, h / span)))
  }

  /**
   * Any aimed action (a spell, a throw, a wand, examine, a travel target)
   * puts the server's cursor on the cell being aimed at: face it. This is the
   * one signal common to our own play and a spectated one. The level map is
   * north-up and gets no facing. A cursor our own pointer placed is skipped:
   * facing it would turn the view under the mouse and chase itself. In our
   * own aims, look mode (`x`) and fire (`f`) alike, the view turns to a
   * heading as soon as the cursor steps onto its line from the player, and
   * otherwise holds while the cursor walks in front of the player, turning
   * to the nearest heading only when the cursor goes beside or behind
   * (camera `faceCursorBehind`); the keys read against whatever grid is in
   * view (camera `gridFacing`). A fire that locked onto a target behind the
   * player turns nothing at all until the cursor is first stepped
   * (`viewHeld`): the lock is crawl's, not a move of the player's. A
   * spectated player's aim faces the cell itself.
   */
  private faceCursor(c: SceneCursor) {
    if (c.mode === 'map' || this.cam.steering || this.viewHeld) return
    if (cellKey(c.x, c.y) === this.lastTargetSent) return
    const scene = this.session.scene
    if (!scene.playerOnLevel) return
    if (this.ctx.examining || !this.session.watching) this.cam.faceCursorBehind(scene, c.x, c.y)
    else this.cam.faceCell(scene, c.x, c.y)
  }

  private cursorFor(): SceneCursor | null {
    const st = this.session.state
    // cursor ids: 0 mouse/targeting, 1 tutorial, 2 level map
    const c = st.cursors[0] || st.cursors[2] || st.cursors[1]
    this.cursorIsOurs = false
    if (!c) {
      // dungeon_renderer.js handle_mouse: with nothing else up, the pointer's cell wears CURSOR_MOUSE
      const key = this.pointerCell()
      if (key === null) return null
      this.cursorIsOurs = true
      return { x: (key & 1023) - 512, y: (key >> 10) - 512, mode: 'examine', tile: this.session.gamedata?.icons.id('CURSOR') }
    }
    const mode: SceneCursor['mode'] = st.uiState === UiState.VIEW_MAP ? 'map' : st.inputMode === MouseMode.COMMAND ? 'examine' : 'target'
    // WebTiles paints icons.CURSOR for the mouse and map cursors, TUTORIAL_CURSOR for the tutorial one
    const tutorial = !st.cursors[0] && !st.cursors[2] && !!st.cursors[1]
    const tile = this.session.gamedata?.icons.id(tutorial ? 'TUTORIAL_CURSOR' : 'CURSOR')
    return { x: c.x, y: c.y, mode, tile }
  }

  /**
   * The cell the pointer selects in command mode, where a click acts and the
   * cursor icon lies. It is the plain WebTiles pointer: the cell it hovers,
   * whatever it is. Nothing for a spectator, with `tile_web_mouse_control`
   * off, or outside command mode, where the server owns the cursor; and
   * nothing until the mouse moves after a keyboard or pad action
   * (`pointerLive`).
   */
  private pointerCell(): CellKey | null {
    if (!this.hover || !this.pointerLive || this.session.watching || this.ctx.mode !== 'command') return null
    if (this.session.state.options.tile_web_mouse_control === false) return null
    // every camera move, resize and level change marks a render, and a pointer move marks the pick, so these are the only times it can change
    if (this.needsRender || this.pickDirty || this.pickMemo === undefined) {
      this.pickDirty = false
      this.pickMemo = this.renderer.pick(this.hover.x, this.hover.y)
    }
    return this.pickMemo
  }

  /**
   * Once a frame: while an aim is up the pointer steers its cursor
   * (`pointTarget`). Outside one, a mouse resting on the view does not aim
   * the `x` or `f` that opens next: the movement it made in command mode
   * is forgotten, so only movement while the aim is up moves its cursor.
   */
  private syncTarget() {
    if (this.ctx.mode === 'targeting') this.pointTarget()
    else {
      this.lastTargetSent = -1
      this.hoverMoved = false
    }
  }

  /**
   * Targeting with the pointer: the cell under the hovering mouse or the
   * dragging finger is where the server's cursor should be, as the
   * official client does with `target_cursor` on mouse move.
   */
  private pointTarget() {
    if (this.session.watching || !this.hover || !this.hoverMoved) return
    this.hoverMoved = false
    if (this.session.state.options.tile_web_mouse_control === false) return
    const key = this.renderer.pick(this.hover.x, this.hover.y)
    if (key === null || key === this.lastTargetSent) return
    this.lastTargetSent = key
    this.runner.send(cm.targetCursor((key & 1023) - 512, (key >> 10) - 512))
  }

  /** A server message came in: note the step the player made, if any (see `hops`). */
  private trackHop() {
    const pos = this.session.state.player.pos
    if (!pos) return
    const { x, y } = this.hopPos
    if (pos.x === x && pos.y === y) return
    const dx = pos.x - x
    const dy = pos.y - y
    if (Math.abs(dx) <= 1 && Math.abs(dy) <= 1) this.hops.push({ dx, dy })
    else this.jumped = true
    this.hopPos = { x: pos.x, y: pos.y }
  }

  private onScene() {
    const now = this.sceneTime ?? performance.now() / 1000
    const scene = this.session.scene
    const st = this.session.state
    const p = scene.player
    const hops = this.hops
    const jumped = this.jumped
    this.hops = []
    this.jumped = false
    if (scene.playerOnLevel) {
      const level = `${st.player.place}:${st.player.depth}`
      const newLevel = level !== this.lastLevel
      if (newLevel && this.renderer instanceof Render3d) this.renderer.resetMotion()
      this.lastLevel = level
      const moved = p.x !== this.lastPos.x || p.y !== this.lastPos.y
      if (moved || newLevel) {
        // the feet moved on: whatever turn was owed is about the old spot
        this.owedTurn = null
        const dx = p.x - this.lastPos.x
        const dy = p.y - this.lastPos.y
        // Attribute all hops, including replies to older commands still in
        // flight after the player turned and sent a new direction.
        const ownStep = this.runner.stepForMove(dx, dy, performance.now(), jumped ? [] : hops)
        const wasOurs = ownStep !== null
        const sameLevel = !newLevel && !Number.isNaN(this.lastPos.x) && !(dx === 0 && dy === 0)
        const single = Math.abs(dx) <= 1 && Math.abs(dy) <= 1
        if (sameLevel && ownStep && this.padStep === ownStep && !this.session.watching) {
          this.padHints.moved(Math.max(1, hops.length))
          this.padStep = null
        }
        // Several cells in one frame is still a walk when every hop the server
        // sent was one cell: travel, explore, a spectated player. The last hop
        // is the way the feet went. A single position update spanning several
        // cells (`travel_delay -1`, a blink, a teleport) has no hops: the
        // travel trail tells the last step, else the displacement stands in.
        const walk = sameLevel && hops.length > 0 && !jumped
        // the eye glides after a walk, by the hops the server drew (the rc's
        // `travel_delay`: a positive one sends every step, -1 sends the
        // arrival alone, which is a jump here as it is a jump there)
        if (walk || (sameLevel && single)) this.cam.walkTo(p.x, p.y, walk ? hops : [{ dx, dy }], now)
        else this.cam.snapTo(p.x, p.y)
        if (!sameLevel) {
          // level change: never nose-to-wall
          if (!this.cam.steering) this.arrivalPending = !this.cam.faceAfterArrival(scene)
        } else if (this.cam.steering) {
          // the player is looking around: leave the view alone
        } else if (wasOurs) {
          // Align our forward step only if no newer turn or look superseded
          // it. The reply confirms the feet, not a heading the player has
          // since changed (even if the drag/stick has already been released).
          if (ownStep === this.runner.lastStep && ownStep.turned && ownStep.steeringRevision === this.cam.steeringRevision) {
            const h = hops.at(-1) ?? { dx, dy }
            this.cam.faceStep(h.dx, h.dy)
          }
        } else if (walk || single) {
          // path-driven movement: face the way the last step went
          const h = walk ? hops[hops.length - 1] : { dx, dy }
          this.cam.faceAfterMove(scene, h.dx, h.dy)
        } else {
          this.cam.faceAfterJump(scene, dx, dy)
        }
        this.lastPos = { x: p.x, y: p.y }
      } else if (this.arrivalPending) {
        // the new level's cells have arrived: now the heading can be judged
        if (this.cam.steering) this.arrivalPending = false
        else this.arrivalPending = !this.cam.faceAfterArrival(scene)
      } else if (this.session.watching && !this.cam.steering) {
        // the spectated player stood their ground with a hostile beside them: a fight, face it
        this.cam.faceAdjacentHostile(scene)
      }
      // discovery: a monster newly in view turns the camera
      const ids = new Set<number>()
      let newest: Billboard | null = null
      for (const b of scene.billboards) {
        if (b.kind !== 'monster' || !b.ref) continue
        const id = (b.ref as { id?: number }).id
        if (id === undefined) continue
        ids.add(id)
        // a plant coming into view is no discovery: it is firewood, not a threat (scene `isThreat`)
        if (!this.lastMonsters.has(id) && isThreat(b)) newest = newest ?? b
      }
      // a step or a wait of the player's own: the turn they chose is not taken from them
      const keyedAt = Math.max(this.runner.lastStep?.t ?? -Infinity, this.runner.lastWaitAt)
      const keyedJustNow = performance.now() - keyedAt < 400
      this.lastMonsters = ids
      // the server's own word wins: a walk it refused ("X is nearby!") or
      // stopped ("You encounter X.", "X comes into view.") names the monster,
      // and that one is faced, or failing a match the nearest blocker, hostile
      // or neutral (warnings.ts). Read once the batch's cells are in, so the
      // named monster is on the scene to be found.
      const lines = st.messages.lines
      const fresh = linesSince(lines, this.lastWarningLine, st.player.turn)
      this.lastWarningLine = lines[lines.length - 1]
      const names = namedInWarnings(fresh)
      if ((newest || names.length) && !this.cam.steering && !keyedJustNow) {
        // A newcomer or a warning turns the camera, but only once the server
        // takes commands: a walk stopped under a --more-- ends its batch in
        // `input_mode 5` (fixtures/explore-more.json), and the line, read
        // once, would otherwise be spent before the prompt is dismissed. The
        // turn is owed instead and paid when input_mode returns to command.
        if (st.inputMode === MouseMode.COMMAND) this.faceEvent(scene, names, newest !== null)
        else this.owedTurn = { names: [...(this.owedTurn?.names ?? []), ...names], newcomer: (this.owedTurn?.newcomer ?? false) || newest !== null }
      }
    }
    this.renderer?.setScene(scene, now)
    this.needsRender = true
  }

  // ------------------------------------------------------------------ input

  /** Buttons whose hold action already ran this press; their release is swallowed. */
  private holdFired = new Set<string>()

  /**
   * Buttons whose press opened a tap-or-hold decision (bindings.ts
   * `armsTapOrHold`). A press that acted at once (space under a --more--, a
   * menu select) is not here, so its release cannot become a tap in whatever
   * mode the server moved to meanwhile: A on a --more-- while standing on
   * stairs must not also climb them.
   */
  private tapArmed = new Set<string>()

  /** Fire the hold half of any tap-or-hold button that has been down for HOLD_MS, without waiting for release. */
  private fireHolds(now: number) {
    this.holding = null
    if (this.chat.capturing || this.overlays.hasClientOverlay) {
      this.tapArmed.clear()
      return
    }
    for (const [b, t0] of this.pressTimes) {
      if (!this.tapArmed.has(b)) continue
      // the server may have moved the mode under the press: a button the new context has no tap-or-hold for
      // disarms, so neither half can fire where it would mean something else (LB pressed in a menu must not rest)
      if (!armsTapOrHold(b as Button, this.ctx)) { this.tapArmed.delete(b); continue }
      if (this.holdFired.has(b) || !this.hooks.gamepad.isHeld(b as Button)) continue
      const a = holdAction(b as Button, this.ctx)
      if (!a) continue
      if (now - t0 < HOLD_MS) {
        // the button's own prompt shows how far along the hold is; the same for every tap-or-hold
        this.holding = { button: b as Button, fraction: (now - t0) / HOLD_MS }
        continue
      }
      this.holdFired.add(b)
      this.executePadAction(a)
      this.needsRender = true
    }
  }

  pad(ev: PadEvent) {
    if (this.destroyed) return
    this.wake()
    // a press, a stick or the d-pad is the pad speaking; a stick settling back to centre is not
    if (isPadActivity(ev)) this.inputFrom('pad')
    if (this.chat.capturing) {
      this.chat.pad(ev)
      return
    }
    if (this.overlays.hasClientOverlay) {
      if (ev.type === 'press') {
        // the button that opened this screen puts it away whole, before anything else it would do here
        if (ev.button === this.overlayOpener) this.overlays.clientOverlayInput('close')
        // an empty tab of X's actions keeps the two that are no list: Y swaps weapons, LT shouts
        else if (this.overlays.openMenu === 'battle' && (ev.button === 'Y' || ev.button === 'LT')) this.actionKey(ev.button === 'Y' ? SWAP_WEAPONS_KEY : SHOUT_KEY)
        else if (ev.button === 'A') this.overlays.clientOverlayInput('select')
        else if (ev.button === 'START') this.overlays.clientOverlayInput('submit')
        else if (ev.button === 'B') this.overlays.clientOverlayInput('cancel')
        // Select is the put-away button even for a screen it did not open
        else if (ev.button === 'SELECT') this.overlays.clientOverlayInput('close')
        else if (ev.button === 'X') this.overlays.clientOverlayInput('keyboard')
        else if (ev.button === 'LB') this.overlays.clientOverlayInput('bumperPrev')
        else if (ev.button === 'RB') this.overlays.clientOverlayInput('bumperNext')
        // put away by any route (the opener, Select, B on the first screen): the next opener owns the next screen
        if (!this.overlays.hasClientOverlay) this.overlayOpener = null
      } else if (ev.type === 'dir' || ev.type === 'dirRepeat') {
        if (ev.dir === 0) this.overlays.clientOverlayInput('prev')
        else if (ev.dir === 4) this.overlays.clientOverlayInput('next')
        else if (ev.dir === 6) this.overlays.clientOverlayInput('left')
        else if (ev.dir === 2) this.overlays.clientOverlayInput('right')
      }
      return
    }
    const st = this.settings()
    if (ev.type === 'look') {
      this.padLooking = ev.dx !== 0 || ev.dy !== 0
      if (this.ctx.mode === 'levelmap') {
        // the level map is north-up: the right stick pans it instead of the camera
        this.panMap(ev.dx, ev.dy)
        return
      }
      this.mapPan = { x: 0, y: 0 }
      if (this.hooks.gamepad.rightStickTurns) {
        // on Turn the stick's left and right come as `rstick` directions; a look is only ever up or down
        this.cam.look(0, 0)
        this.cam.tilt(ev.dy, st.lookSensitivity, st.invertLook)
      } else {
        this.cam.tilt(0)
        this.cam.look(ev.dx, ev.dy, st.lookSensitivity, st.invertLook)
      }
      this.needsRender = true
      return
    }
    if (ev.type === 'press') {
      this.pressTimes.set(ev.button, ev.t)
      this.holdFired.delete(ev.button)
      if (this.ctx.mode !== 'spectating' && armsTapOrHold(ev.button, this.ctx)) this.tapArmed.add(ev.button)
      else this.tapArmed.delete(ev.button)
    }
    if (ev.type === 'release') {
      this.pressTimes.delete(ev.button)
      this.holding = null
      const armed = this.tapArmed.delete(ev.button)
      if (this.holdFired.delete(ev.button) || !armed) return
    }
    if (this.ctx.mode === 'spectating') {
      if (ev.type === 'press' && (ev.button === 'B' || ev.button === 'START')) {
        this.overlays.showSystem({ spectating: true, inGame: true })
        this.overlayOpener = ev.button
      }
      // a spectator's chat is one button away, as F12 is in the official client
      if (ev.type === 'press' && ev.button === 'X') this.chat.padFocus()
      if ((ev.type === 'dir' || ev.type === 'dirRepeat') && ev.dir !== null) this.hud.scrollLog(ev.dir === 0 ? -1 : ev.dir === 4 ? 1 : 0)
      return
    }
    const a = resolve(ev, this.ctx, (source) => leftRightTurns(source, this.settings()))
    if (!a) return
    this.inputActed()
    const overlayWasUp = this.overlays.hasClientOverlay
    this.executePadAction(a)
    // whichever button just opened a client overlay owns closing it; a screen
    // reached from inside one (A on a settings row) keeps the opener it came with
    if (ev.type === 'press') {
      if (!this.overlays.hasClientOverlay) this.overlayOpener = null
      // (the frame a turn of X's tabs stands in is no screen of the bumper's: the bumper turns it again)
      else if (!overlayWasUp && this.overlays.openMenu !== 'battle') this.overlayOpener = ev.button
    }
    this.needsRender = true
  }

  private padHintEvidence(): PadHintEvidence {
    const st = this.session.state
    const cursor = st.cursors[0] ?? st.cursors[2]
    return {
      mode: deriveMode(st), turn: st.player.turn, x: st.player.pos?.x ?? NaN, y: st.player.pos?.y ?? NaN,
      cursor: cursor ? `${cursor.x},${cursor.y}` : '',
      focus: this.overlays.focusInfo(this.ctx)?.index ?? st.menus.at(-1)?.last_hovered ?? -1,
      clientOverlay: this.overlays.hasClientOverlay,
    }
  }

  private executePadAction(a: Action) {
    const beforeStep = this.runner.lastStep
    this.padHints.attempt(a, this.ctx, this.padHintEvidence(), performance.now())
    this.runner.execute(a)
    if (a.kind === 'step' && this.ctx.mode === 'command' && this.runner.lastStep !== beforeStep) this.padStep = this.runner.lastStep
    else this.padStep = null
    this.padHints.observe(this.padHintEvidence(), performance.now())
  }

  /**
   * A keyboard or pad action fired: the pointer's own selection (and the
   * tooltip hanging off it) goes away until the mouse moves again. The
   * server's cursors are untouched.
   */
  /** Which device spoke last: the prompt strip is drawn in its terms (hud.ts renderBar). */
  private inputFrom(device: InputDevice) {
    if (device !== 'pad') {
      this.padHints.cancel()
      this.padStep = null
      this.padLooking = false
    }
    if (device === this.lastInput) return
    this.lastInput = device
    this.needsRender = true
  }

  /**
   * The spell bar's part of a frame (spell-bar.ts): the lit spell goes out when its moment passes, and the list
   * is looked up when it is wanted (a finger playing) and crawl stands still at its prompt with nothing up, a
   * moment after the last key and the last word from crawl, so the look never lands in the middle of something:
   * travel and explore keep the command mode while they run, and a key stops them.
   */
  private spellFrame() {
    this.spellBook.tick()
    this.spellBar.frame()
    const st = this.session.state
    const still = st.inputMode === MouseMode.COMMAND && !st.menus.length && !st.ui.length && !st.textInput && !st.dialog && !st.messages.more
    if (this.lastInput === 'touch' && this.session.playing && !this.session.watching && this.session.gamedata && this.ctx.mode === 'command' && still && !this.overlays.hasClientOverlay && performance.now() - Math.max(this.lastSent, this.lastHeard) > SPELL_LOOK_STILL_MS) this.spellBook.look()
  }

  /** The spell bar stands (and the messages over it): a finger playing a character with spells. */
  private spellsShown(): boolean {
    return this.lastInput === 'touch' && this.session.playing && !this.session.watching && this.spellBook.spells.length > 0
  }

  /** crawl's question which spell, asked of the bar's own cast on its way to the aim (spl-cast.cc `cast_a_spell`) */
  private castPrompt(): boolean {
    if (this.ctx.mode !== 'prompt' || !this.spellBar.casting()) return false
    // a line on the prompt channel, not a prompt the context parses: "Cast which spell? (? or * to list)", or with the
    // last spell offered first (trunk), "Confirm with . or Enter, or press ? or * to list all spells."
    const last = this.session.state.messages.lines.at(-1)
    return !!last && last.channel === MSGCH.PROMPT && /^Cast which spell\b|\bto list all spells\b/.test(formattedStringToText(last.text).trim())
  }

  /** Its buttons show: on the map, in an aim, and through the cast's own prompt, with nothing of ours up. Elsewhere its row is bare. */
  private spellsLive(): boolean {
    const m = this.ctx.mode
    return (m === 'command' || (m === 'targeting' && !this.ctx.examining) || this.castPrompt()) && !this.overlays.hasClientOverlay && !this.chat.capturing && !this.mapShown
  }

  /** A spell on the bar tapped: armed, or spent (spell-bar.ts SpellBar). */
  private spellTap(spell: Spell) {
    this.inputFrom('touch')
    this.inputActed()
    this.spellBar.tap(spell)
    this.needsRender = true
  }

  /** The bar's More: every spell, in crawl's cast list (X's Spells). */
  private spellMore() {
    this.inputFrom('touch')
    this.inputActed()
    if (this.ctx.mode === 'command') this.openActionTab('spells')
  }

  private inputActed() {
    this.tapArmed.clear()
    this.spellBar?.disarm()
    this.holding = null
    if (!this.pointerLive) return
    this.pointerLive = false
    clearTimeout(this.tooltipTimer)
    this.hud.hideTooltip()
    this.needsRender = true
  }

  /** One of the menu keys (MENU_KEYS): it opens that menu, and closes it again as the button does. */
  private menuKey(menu: CommandMenu | 'levelmap' | 'equipment' | 'system') {
    const open = this.overlays.openMenu
    if (this.session.watching) {
      // a spectator has the Orbrun menu only, as the pad's Start
      if (menu !== 'system') return
      if (open === 'system') this.overlays.clientOverlayInput('close')
      else if (!this.overlays.hasClientOverlay) this.uiOp('system')
      return
    }
    // Select's level map is crawl's own: F2 again puts it away, as Escape would
    if (menu === 'levelmap' && this.ctx.mode === 'levelmap') this.runner.execute({ kind: 'keys', label: 'Cancel', seq: [{ key: 27 }] })
    else if (open === menu) this.overlays.clientOverlayInput('close')
    // the pack is crawl's own menu: F4 again puts it away, as Escape would
    else if (menu === 'equipment' && this.ctx.mode === 'menu' && this.ctx.menu && isPack(this.ctx.menu.menu)) this.runner.execute({ kind: 'keys', label: 'Cancel', seq: [{ key: 27 }] })
    // and so are X's actions
    else if (menu === 'battle' && this.ctx.mode === 'menu' && this.ctx.menu?.actions) this.runner.execute({ kind: 'keys', label: 'Cancel', seq: [{ key: 27 }] })
    // from the map, or from another of the four, the key goes straight to its own menu
    else if (this.ctx.mode === 'command' && (!this.overlays.hasClientOverlay || open)) {
      // the level map is crawl's, under ours: the menu up goes first
      if (menu === 'levelmap' && open) this.overlays.clientOverlayInput('close')
      this.uiOp(menu === 'battle' ? 'commands' : menu)
    }
    else if (this.overlays.hasClientOverlay) this.overlays.clientOverlayInput('close')
    // elsewhere the Orbrun menu opens where Start opens it, and nowhere Start means something else
    else if (menu === 'system') { const a = buttonAction('START', this.ctx); if (a?.kind === 'ui' && a.op === 'system') this.uiOp('system') }
    // off the map F2 opens the palette for the screen, which no button opens
    else if (menu === 'levelmap') this.overlays.showPalette(this.ctx.mode === 'targeting' || this.ctx.mode === 'menu' ? this.ctx.mode : 'command')
  }

  private onKeyDown(ev: KeyboardEvent) {
    this.wake()
    const target = ev.target as HTMLElement | null
    // a key typed into a field is still the keyboard speaking (a server prompt's on-screen keyboard goes away for it)
    this.inputFrom('keyboard')
    if (target && isTextEntry(target)) return
    // F2–F5 are Orbrun's own: the pad's four menus, so a player can rebind a button (or anything) to them. A bare
    // F1 goes on to Crawl (keys.ts CODES), which binds it to CMD_GAME_MENU alongside `~`; crawl binds none of these.
    const menu = !ev.shiftKey && !ev.ctrlKey && !ev.altKey && !ev.metaKey ? MENU_KEYS[ev.key] : undefined
    if (menu) {
      ev.preventDefault()
      if (!ev.repeat) this.menuKey(menu)
      return
    }
    if (this.overlays.hasClientOverlay) {
      if (ev.key === 'Escape') this.overlays.clientOverlayInput('cancel')
      else if (ev.key === 'ArrowDown') this.overlays.clientOverlayInput('next')
      else if (ev.key === 'ArrowUp') this.overlays.clientOverlayInput('prev')
      else if (ev.key === 'ArrowLeft') this.overlays.clientOverlayInput('left')
      else if (ev.key === 'ArrowRight') this.overlays.clientOverlayInput('right')
      else if (ev.key === 'PageDown') this.overlays.clientOverlayInput('pageNext')
      else if (ev.key === 'PageUp') this.overlays.clientOverlayInput('pagePrev')
      else if (ev.key === 'Home') this.overlays.clientOverlayInput('first')
      else if (ev.key === 'End') this.overlays.clientOverlayInput('last')
      // Enter and space both fire the row the cursor is on, as they do in a server menu
      else if (ev.key === 'Enter' || ev.key === ' ') this.overlays.clientOverlayInput('select')
      // an empty tab of X's actions: crawl's own keys for the two that are no list
      else if (this.overlays.openMenu === 'battle' && (ev.key === SWAP_WEAPONS_KEY || ev.key === SHOUT_KEY)) this.actionKey(ev.key)
      else if (!ev.altKey && !ev.metaKey) {
        if (ev.key === 'Tab') this.overlays.clientOverlayHotkey('Tab')
        else if (ev.key.length === 1) this.overlays.clientOverlayHotkey(ev.ctrlKey ? 'Ctrl-' + ev.key.toUpperCase() : ev.key)
      }
      ev.preventDefault()
      return
    }
    if (ev.key === 'F12' || ev.code === 'F12') {
      // client.js: F12 focuses chat
      if (this.chatOn) this.chat.focus()
      ev.preventDefault()
      return
    }
    if (this.session.watching) {
      if (ev.key === 'Escape') this.overlays.showSystem({ spectating: true, inGame: true })
      return
    }
    // Esc is the server's game menu; Orbrun's settings are also under Commands → More.
    const mode = this.ctx.mode
    // on a screen the keyboard is a pad: Enter, Escape, Space and the arrows are its buttons and its
    // d-pad, and do exactly what those do (bindings.ts screenKey), down the same path
    if (!ev.ctrlKey && !ev.altKey && !ev.metaKey && !ev.shiftKey) {
      const sk = screenKey(ev.key, this.ctx, this.overlays.popupScrolls)
      if (sk) {
        ev.preventDefault()
        // a pad's buttons never repeat (gamepad.ts): a held Enter confirms once, not on every screen it
        // opens; the arrows repeat as the d-pad does
        if (ev.repeat && 'button' in sk) return
        this.inputActed()
        const a = 'button' in sk ? buttonAction(sk.button, this.ctx) : resolve({ type: 'dir', dir: sk.dir, source: 'dpad' }, this.ctx)
        if (a) this.runner.execute(a)
        this.needsRender = true
        return
      }
    }
    // a server menu: paging and the paging characters move its hover and page on
    // the client, as menu.js does before any key reaches the server
    if (mode === 'menu' && this.ctx.menu?.menu.type !== 'crt' && this.overlays.menuKey(this.session.state, ev)) {
      ev.preventDefault()
      this.inputActed()
      this.needsRender = true
      return
    }
    // a popup that scrolls on the client (describe screens, help, the game-over
    // text): arrows, paging and the paging characters scroll it, as ui-layouts.js does
    if ((mode === 'popup' || mode === 'ended') && this.overlays.popupKey(this.session.state, ev)) {
      ev.preventDefault()
      this.inputActed()
      this.needsRender = true
      return
    }
    // direction keys are rewritten in command and targeting modes only; macro capture and everything else is raw
    if (mode === 'command' || mode === 'targeting') {
      const d = directionKey(ev)
      if (d) {
        ev.preventDefault()
        // the key's compass meaning is taken as relative to facing; the runner rotates it back
        // (plain: step / cursor move, Shift: run / fire that way, Ctrl: attack).
        // Left and right turn or strafe as this key set's setting says
        this.inputActed()
        this.runner.step(d.abs as RelDir, { run: d.mod === 'shift', attack: d.mod === 'ctrl', turns: leftRightTurns(d.source, this.settings()) })
        this.needsRender = true
        return
      }
    }
    const msg: ClientMessage | null = keydownMessage(ev)
    if (!msg) return
    ev.preventDefault()
    this.inputActed()
    this.runner.send(msg)
  }

  /**
   * Mouse and touch alike: the pointer stays visible and free (the browser
   * never takes it). Press and release without moving acts on the cell under
   * the pointer, right click describes it; dragging past a small slop orbits
   * the camera instead, and no click follows the drag. Pointer capture keeps
   * the drag alive off the canvas. A hovering mouse still selects the cell it
   * rests on, and while targeting it moves the server's cursor. The gamepad's
   * right stick turns the camera whenever it is pushed, drag or no drag.
   */
  private attachPointer(c: HTMLCanvasElement) {
    c.addEventListener('contextmenu', (ev) => ev.preventDefault())
    c.addEventListener('pointerdown', (ev) => {
      this.inputFrom(ev.pointerType === 'touch' ? 'touch' : 'pointer')
      // mouse_control.js: any mousedown hides the cell tooltip
      clearTimeout(this.tooltipTimer)
      this.hud.hideTooltip()
      // a click is the mouse speaking: its selection is live again, so a click right after a key still acts on the hovered cell
      if (ev.pointerType === 'mouse') this.pointerLive = true
      if (this.drag) {
        if (this.startPinch(this.drag, ev)) c.setPointerCapture(ev.pointerId)
        return
      }
      const d: Drag = (this.drag = { id: ev.pointerId, x: ev.clientX, y: ev.clientY, x0: ev.clientX, y0: ev.clientY, moved: false, button: ev.button, touch: ev.pointerType === 'touch' })
      // a finger held still on the view is R3, the stick click the touch bar has no cell for (bindings.ts TOUCH_CELLS):
      // what is ahead examined on the map, the overview on the level map; the lift then does nothing more
      if (d.touch) {
        d.hold = window.setTimeout(() => {
          if (this.drag !== d || d.moved) return
          d.held = true
          this.touchPress('R3')
        }, HOLD_MS)
      }
      c.setPointerCapture(ev.pointerId)
    })
    c.addEventListener('pointermove', (ev) => {
      if (ev.pointerType === 'mouse') {
        const rect = this.canvas.getBoundingClientRect()
        this.hover = { x: ev.clientX - rect.left, y: ev.clientY - rect.top }
        this.hoverMoved = true
        this.pointerLive = true
        // the hovered cell is picked again next frame; only a change of cell draws one
        this.pickDirty = true
        this.wake()
        this.armCellTooltip(ev.pageX, ev.pageY)
      }
      if (this.pinch?.pts.has(ev.pointerId)) return this.pinchMap(ev)
      const d = this.drag
      if (!d || ev.pointerId !== d.id) return
      // the button came up somewhere the page could not see it (off the window
      // entirely, so no pointerup was ever delivered): this move, with nothing
      // held, is that release. Drop the drag instead of orbiting a held button
      // that is not held.
      if (ev.pointerType === 'mouse' && ev.buttons === 0) return this.cancelDrag()
      const dx = ev.clientX - d.x
      const dy = ev.clientY - d.y
      d.x = ev.clientX
      d.y = ev.clientY
      if (!d.moved && Math.hypot(ev.clientX - d.x0, ev.clientY - d.y0) < DRAG_SLOP) return
      if (d.held) return
      d.moved = true
      clearTimeout(d.hold)
      if (d.touch && this.panMapBy(d, dx, dy)) return
      const st = this.hooks.settings()
      // radians per css pixel; a full drag across the view is about a half turn
      const k = (Math.PI / Math.max(300, this.canvas.clientWidth)) * st.lookSensitivity
      // the drag grabs the world, the way a Mac scrolls: the dungeon follows the
      // pointer, so dragging right swings the view left and dragging down looks up
      this.cam.lookBy(-dx * k, (st.invertLook ? -dy : dy) * k)
      this.needsRender = true
    })
    const end = (ev: PointerEvent) => {
      if (this.pinch?.pts.has(ev.pointerId)) {
        // either finger lifting ends the pinch, and the one left on the glass does nothing more
        for (const id of this.pinch.pts.keys()) if (c.hasPointerCapture(id)) c.releasePointerCapture(id)
        this.pinch = null
        this.drag = null
        return
      }
      const d = this.drag
      if (!d || ev.pointerId !== d.id) return
      this.drag = null
      clearTimeout(d.hold)
      if (c.hasPointerCapture(ev.pointerId)) c.releasePointerCapture(ev.pointerId)
      if (d.held || d.pan) return
      if (d.moved) {
        this.cam.endDrag(d.touch)
        this.needsRender = true
      } else if (ev.type === 'pointerup') {
        // the message pane lets the press through to here (hud.ts dismissesMoreAt): on a pending --more-- it is space
        if (this.hud.dismissesMoreAt(ev.clientX, ev.clientY)) return this.runner.execute(CONTINUE)
        if (d.touch && this.tapSteps()) return this.stepForward()
        const rect = this.canvas.getBoundingClientRect()
        if (d.touch && this.tapMapCursor(ev.clientX - rect.left, ev.clientY - rect.top)) return
        this.onPointer(ev.clientX - rect.left, ev.clientY - rect.top, d.button)
      }
    }
    // a drag does not survive leaving the page: the button released out there
    // sends no pointerup, and coming back should not still be a press
    // (the one listener reads `cancelDrag` when it fires, so it always lets go of the canvas in play; adding it again is a no-op)
    this.onWindowBlur ??= () => this.cancelDrag()
    window.addEventListener('blur', this.onWindowBlur)
    this.cancelDrag = () => {
      if (this.pinch) {
        for (const id of this.pinch.pts.keys()) if (c.hasPointerCapture(id)) c.releasePointerCapture(id)
        this.pinch = null
        this.drag = null
        return
      }
      const d = this.drag
      if (!d) return
      this.drag = null
      clearTimeout(d.hold)
      if (c.hasPointerCapture(d.id)) c.releasePointerCapture(d.id)
      if (!d.moved || d.pan) return
      this.cam.endDrag(d.touch)
      this.needsRender = true
    }
    c.addEventListener('pointerup', end)
    c.addEventListener('pointercancel', end)
    c.addEventListener('pointerleave', (ev) => {
      if (ev.pointerType === 'mouse') this.hover = null
      clearTimeout(this.tooltipTimer)
      this.hud.hideTooltip()
    })
  }

  /**
   * Android's back (back.ts): B, the way out of whatever is up, but over the
   * map with nothing up, where crawl ignores Escape, Save and exit as the
   * Orbrun menu's row sends it. Crawl's S asks first, so a second back is the
   * B that answers no. The device stays what it was: back is no finger on the
   * view, nor the pad.
   */
  back() {
    if (this.ctx.mode === 'command' && !this.session.watching && !this.overlays.hasClientOverlay && !this.chat.capturing) {
      this.runner.send(cm.input('S'))
      return
    }
    const t = performance.now()
    this.pad({ type: 'press', button: 'B', t, touch: true })
    this.pad({ type: 'release', button: 'B', t, held: 0, touch: true })
  }

  /** A finger pressing and releasing one of the pad's buttons at once, as the touch bar's do over time. */
  private touchPress(button: Button) {
    this.inputFrom('touch')
    const now = performance.now()
    this.hooks.gamepad.virtualDown(button, now, true)
    this.hooks.gamepad.virtualUp(button, now, true)
  }

  /**
   * dungeon_renderer.js handle_mouse + mouse_control.js handle_cell_tooltip:
   * with `tile_web_mouse_control` on, a pointer resting on a cell with a
   * monster for half a second shows its name, and what a click would do
   * (select target while targeting, describe on right click). The cell is
   * the pointer's selection (`pointerCell`); the tip is drawn at page
   * coordinates (pageX, pageY), where the pointer is.
   */
  private armCellTooltip(pageX: number, pageY: number) {
    clearTimeout(this.tooltipTimer)
    this.hud.hideTooltip()
    const st = this.session.state
    if (st.options.tile_web_mouse_control === false) return
    this.tooltipTimer = window.setTimeout(() => {
      if (this.drag) return
      const key = this.ctx.mode === 'command' ? this.pointerCell() : this.hover ? this.renderer.pick(this.hover.x, this.hover.y) : null
      if (key === null) return
      const x = (key & 1023) - 512
      const y = (key >> 10) - 512
      const cell = st.map.cells.get(mapKey(x, y))
      if (!cell?.mon) return
      const im = st.inputMode
      const canTarget = im === MouseMode.TARGET || im === MouseMode.TARGET_DIR || im === MouseMode.TARGET_PATH
      const canDescribe = canTarget || im === MouseMode.COMMAND || st.uiState === UiState.VIEW_MAP
      const visible = this.session.scene.cells.get(cellKey(x, y))?.visibility === 'visible'
      let text = ''
      if (canTarget && visible) text += 'Left click: select target'
      if (canDescribe) text += (text ? '<br>' : '') + 'Right click: describe'
      if (text) text = '<br><br>' + text
      this.hud.showTooltip(escapeHtml(cell.mon.name || '') + text, pageX + 10, pageY + 10)
    }, 500)
  }

  /**
   * action_panel.js show_panel / hide_panel: the panel's X folds it away and
   * the placeholder unfolds it again, the rc's `action_panel_show` either
   * way, and the change goes back to the rc, so the official client and
   * Orbrun agree on the next game.
   */
  private setPanelShown(shown: boolean) {
    const st = this.session.state
    if (st.options.action_panel_disabled === true) return
    st.options.action_panel_show = shown
    st.rev.player++
    if (!this.session.watching) this.runner.send(cm.setOption('action_panel_show', shown))
  }

  /**
   * A server popup or dialog is up, and the pointer may close it: ui.js
   * registers its handlers on the same condition. Under a finger (`touch`) a
   * menu is one too, as menu.js shows it with ui.show_popup: on a phone the
   * menu covers the view, and a tap beside it is the way out a finger reaches.
   */
  private popupUp(touch = false): boolean {
    if (this.session.watching || this.overlays.hasClientOverlay) return false
    if (this.ctx.mode !== 'popup' && this.ctx.mode !== 'dialog' && !(touch && this.ctx.mode === 'menu')) return false
    return this.session.state.options.tile_web_mouse_control !== false
  }

  /**
   * ui.js popup_clickoutside_handler: while a popup is up (with
   * `tile_web_mouse_control` on) a mousedown outside it sends Escape, "since
   * for crawl we really need to send a 'close popup' message to the server
   * rather than do it in the client". The chat is outside the game
   * (`target_outside_game`) and keeps its clicks. Orbrun adds: a right click
   * closes wherever it lands, inside the popup too, the mirror of the right
   * click that opened a describe, so a look is over as fast as it began.
   * Under a finger, a crawl menu goes the same way (`popupUp`), and so do
   * Orbrun's own panels: a tap outside them is their Escape, a step back
   * (B). A mouse leaves those be, as before: it has the view to drag while
   * a setting is tuned. The touch bar is no outside: its buttons are the
   * pad's, and its Back already says what it does.
   */
  private onDocPointer(ev: PointerEvent) {
    this.wake()
    this.pointerClosed = false
    // a finger anywhere (a menu's row, a prompt's chip) is the finger speaking: the touch bar comes up for it
    const touch = ev.pointerType === 'touch'
    if (touch) this.inputFrom('touch')
    const t = ev.target instanceof Element ? ev.target : null
    if (t?.closest('.touchbar')) return
    if (touch && this.overlays.hasClientOverlay && !this.session.watching) {
      // inside a panel, on the on-screen keyboard or in the chat, the press is theirs
      if (t?.closest('.popup, .osk') || (t && this.chat.root.contains(t))) return
      ev.preventDefault()
      ev.stopPropagation()
      this.overlays.clientOverlayInput('cancel')
      if (!this.overlays.hasClientOverlay) this.overlayOpener = null
      this.needsRender = true
      this.pointerClosed = true
      return
    }
    if (!this.popupUp(touch)) return
    if (t && this.chat.root.contains(t)) return
    // the perf pane takes its own taps (it saves the log); a tap on it is not a tap outside the popup
    if (t?.closest('.perf')) return
    const inside = !!t?.closest('.popup')
    if (inside && ev.button !== 2) return
    ev.preventDefault()
    ev.stopPropagation()
    clearTimeout(this.tooltipTimer)
    this.hud.hideTooltip()
    this.runner.send(cm.key(27))
    this.pointerClosed = true
  }

  /**
   * A tap or click on the minimap opens the level map only from the game
   * itself. Over a menu it is a tap outside the menu, which closes it and
   * nothing more: under a finger the press already did (`onDocPointer`), and
   * a mouse's click closes it here.
   */
  private minimapTap() {
    if (this.pointerClosed) return
    if (!this.session.watching) {
      if (this.overlays.hasClientOverlay) {
        this.overlays.clientOverlayInput('cancel')
        if (!this.overlays.hasClientOverlay) this.overlayOpener = null
        this.needsRender = true
        return
      }
      if (MINIMAP_CLOSES.has(this.ctx.mode)) return this.runner.send(cm.key(27))
    }
    this.runner.execute(LEVEL_MAP)
  }

  /** ui.js context_disable: no browser context menu while a popup is up, except on a text input. */
  private onDocContextMenu(ev: MouseEvent) {
    this.wake()
    // a long press on a menu's row is the finger's (onDocPointer took it as touch first): no callout over the menu
    if (!this.popupUp(this.lastInput === 'touch')) return
    const t = ev.target instanceof Element ? ev.target : null
    if (t && (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement)) return
    ev.preventDefault()
  }

  /**
   * A click at canvas coordinates (px, py): the official client's
   * `click_cell` on the cell the pointer selects, with the button numbered as
   * `ev.which` (1 left, 2 middle, 3 right), and the server decides what it
   * means (see Runner.clickCell). The camera is never turned: the player's
   * view is where the drag left it.
   */
  private onPointer(px: number, py: number, button: number) {
    if (this.session.watching) return
    // tile_web_mouse_control = false turns off clicking on the dungeon view
    if (this.session.state.options.tile_web_mouse_control === false) return
    const key = this.renderer.pick(px, py)
    if (key === null) return
    this.runner.clickCell((key & 1023) - 512, (key >> 10) - 512, button + 1)
  }

  /**
   * A finger's tap on the view walks: on the map with nothing up, a tap is a
   * step the way the view faces, the pad's forward (bindings.ts `resolve`),
   * a bump attack on whatever stands there. Elsewhere (aiming, the level
   * map, a popup) it stays crawl's click on the cell, as a mouse's is.
   */
  private tapSteps(): boolean {
    return this.ctx.mode === 'command' && !this.session.watching && !this.overlays.hasClientOverlay
  }

  /**
   * A finger's tap on the level map puts its cursor on the cell tapped, as a
   * click does in local tiles; a WebTiles click there does nothing.
   */
  private tapMapCursor(px: number, py: number): boolean {
    if (this.ctx.mode !== 'levelmap' || this.session.watching) return false
    const c = this.session.state.cursors[2]
    const key = this.renderer.pick(px, py)
    if (!c || key === null) return true
    this.inputActed()
    // taps quicker than the server's echo walk on from the last one's cell
    const t = this.mapTap
    const from = t && t.from.x === c.x && t.from.y === c.y && performance.now() - t.t < ORBIT_WINDOW_MS ? t.to : c
    const to = { x: (key & 1023) - 512, y: (key >> 10) - 512 }
    this.mapTap = { from: { x: c.x, y: c.y }, to, t: performance.now() }
    this.runner.mapCursorBy(to.x - from.x, to.y - from.y)
    return true
  }

  /**
   * A finger dragging the level map grabs it, as a drag grabs the 3D view:
   * the map follows the finger, so its cursor, which the map is centred on,
   * walks the other way a cell for each cell's width dragged.
   */
  private panMapBy(d: Drag, dx: number, dy: number): boolean {
    if (this.ctx.mode !== 'levelmap' || this.session.watching || !(this.renderer instanceof Render2d)) return false
    const cs = this.renderer.cellSize
    // the first move counts from where the finger came down: the slop it crossed is part of the drag
    const p = (d.pan ??= { x: d.x - d.x0 - dx, y: d.y - d.y0 - dy })
    p.x += dx
    p.y += dy
    const cx = Math.trunc(p.x / cs)
    const cy = Math.trunc(p.y / cs)
    if (!cx && !cy) return true
    p.x -= cx * cs
    p.y -= cy * cs
    this.inputActed()
    this.mapTap = null
    this.runner.mapCursorBy(-cx, -cy)
    return true
  }

  /**
   * A second finger down on the level map while the first is on it starts a
   * pinch. Crawl owns the map's zoom (tileweb.cc `zoom_dungeon`, a tenth of
   * `tile_map_scale` a step), so the pinch only decides how many steps of
   * the zoom keys to send.
   */
  private startPinch(d: Drag, ev: PointerEvent): boolean {
    if (!d.touch || ev.pointerType !== 'touch' || d.held || this.ctx.mode !== 'levelmap' || this.session.watching) return false
    clearTimeout(d.hold)
    const pts = new Map([
      [d.id, { x: d.x, y: d.y }],
      [ev.pointerId, { x: ev.clientX, y: ev.clientY }],
    ])
    const d0 = Math.max(1, Math.hypot(ev.clientX - d.x, ev.clientY - d.y))
    const o = this.session.state.options.tile_map_scale
    this.pinch = { pts, d0, scale0: typeof o === 'number' && o > 0 ? o : 60, sent: 0 }
    this.inputActed()
    return true
  }

  /** The fingers moved apart or together: zoom by as many steps as the spread asks, within crawl's 20%..300%. */
  private pinchMap(ev: PointerEvent) {
    const p = this.pinch!
    p.pts.set(ev.pointerId, { x: ev.clientX, y: ev.clientY })
    const [a, b] = [...p.pts.values()]
    const want = p.scale0 * (Math.hypot(a.x - b.x, a.y - b.y) / p.d0)
    const steps = Math.round((Math.min(MAP_SCALE_MAX, Math.max(MAP_SCALE_MIN, want)) - p.scale0) / MAP_SCALE_STEP)
    while (p.sent < steps) {
      p.sent++
      this.runner.sendKeys([{ text: '}' }])
    }
    while (p.sent > steps) {
      p.sent--
      // `{` as text would open a JSON message (keys.ts)
      this.runner.sendKeys([{ key: 123 }])
    }
  }

  private stepForward() {
    this.inputActed()
    this.runner.execute({ kind: 'step', dir: 0, turns: true })
    this.needsRender = true
  }

  /**
   * Right stick over the level map: accumulate deflection and step the map
   * cursor (north-up, absolute) each time a whole cell's worth builds up.
   */
  private panMap(dx: number, dy: number) {
    if (dx === 0 && dy === 0) {
      this.mapPan = { x: 0, y: 0 }
      return
    }
    const p = this.mapPan
    p.x += dx * MAP_PAN_RATE
    p.y += dy * MAP_PAN_RATE
    const sx = Math.abs(p.x) >= 1 ? Math.sign(p.x) : 0
    const sy = Math.abs(p.y) >= 1 ? Math.sign(p.y) : 0
    if (!sx && !sy) return
    p.x -= sx
    p.y -= sy
    const d = dirFromDelta(sx, sy)
    if (d !== null) this.runner.execute({ kind: 'cursor', dir: d })
  }

  /**
   * Face what a scene update announced: the monster a warning named, or
   * failing a name the nearest blocker; with no warning, the threat a
   * newcomer points at (the closest hostile, which may be one already in
   * view). rendering-3d.md III.2.
   */
  private faceEvent(scene: Scene, names: readonly string[], newcomer: boolean) {
    if (names.length) this.cam.faceBlocker(scene, namedMonster(scene, names))
    else if (newcomer) this.cam.faceHostile(scene)
  }

  /** The server takes commands again: pay the turn owed from under a --more--. */
  private payOwedTurn() {
    const owed = this.owedTurn
    if (!owed || this.session.state.inputMode !== MouseMode.COMMAND) return
    this.owedTurn = null
    if (this.cam.steering) return
    this.faceEvent(this.session.scene, owed.names, owed.newcomer)
    this.needsRender = true
  }

  private faceBillboard(b: Billboard) {
    this.cam.faceCell(this.session.scene, b.x, b.y)
    this.needsRender = true
  }

  private uiOp(op: string, arg?: number, category?: CommandCategory, section?: string) {
    switch (op) {
      case 'commands':
        this.openActionTab(this.actionTabUp)
        break
      case 'actionTab':
        // from the tab being turned to, when presses run ahead of crawl
        this.openActionTab(actionNeighbour(this.actionTurn?.target ?? this.ctx.menu?.actions?.current ?? this.actionTabUp, arg ?? 1))
        break
      case 'equipment': {
        // crawl's own pack, at once, on the page and row it was left on: its pages are the tabs (pack-tabs.ts)
        const seq = openPackKeys(this.session.state, this.packPage)
        this.runner.execute({ kind: 'keys', label: 'Inventory', seq })
        // no turns: the page left is gone (or was the first), so the pack stays on its first, Gear
        this.packReturn = { page: seq.length > 1 && this.packPage ? this.packPage : 'gear', seen: false }
        break
      }
      case 'interact':
        this.overlays.showChoices('Interact', [
          { label: contextualLabel(this.ctx), run: () => this.runner.contextual(false) },
          { label: 'Pick up items', run: () => this.runner.contextual(true) },
        ])
        break
      case 'palette':
        this.overlays.showPalette(category || 'command', section)
        break
      case 'popupAction':
        this.overlays.triggerPopupAction(arg ?? 0)
        break
      case 'system':
        this.overlays.showSystem({ spectating: this.session.watching, inGame: true, chat: this.chatOn, run: (a) => this.runner.execute(a) })
        break
      case 'bindings':
        this.overlays.showBindings(this.hooks.gamepad.kind)
        break
      case 'faceHostile': {
        const scene = this.session.scene
        const m = autofightTarget(scene)
        if (m) this.faceBillboard(m)
        else this.hud.status('No hostiles in view')
        break
      }
      case 'toggleRenderer':
        this.userToggleRenderer()
        break
      case 'levelmap':
        this.runner.execute(LEVEL_MAP)
        break
      case 'scrollLog':
        if (arg) this.hud.scrollLog(arg)
        break
      case 'keyboard':
        this.overlays.oskOp('shift')
        break
    }
  }

  /**
   * One of X's actions as tabs (action-tabs.ts), by its key. The frame
   * lights the tab at once; crawl is asked for one menu at a time. From one
   * of its menus that one goes away first, and the key follows once it has
   * (`trackActions`): a key sent behind the Escape in one go could not wait
   * for `z`'s question, and a refused one would leak its `*` into the
   * dungeon. A press while a turn is under way only moves its target, so a
   * quick player never has a key land in the menu that was opening.
   */
  private openActionTab(id: ActionTabId) {
    this.actionTabUp = id
    this.overlays.showActionTabs(id, null)
    if (this.actionTurn) {
      this.actionTurn.target = id
      return
    }
    if (deriveMode(this.session.state) === 'menu') this.closeForTurn(id)
    else this.sendActionKey(id)
  }

  private closeForTurn(target: ActionTabId) {
    this.actionTurn = { target, sent: null, stage: 'closing', t: performance.now() }
    this.runner.execute({ kind: 'keys', label: 'Cancel', seq: [{ key: 27 }] })
  }

  private sendActionKey(target: ActionTabId) {
    const tab = actionTab(target)
    this.actionTurn = { target, sent: target, stage: 'sent', last: this.session.state.messages.lines.at(-1), t: performance.now() }
    this.runner.execute({ kind: 'keys', label: tab.label, seq: [{ text: tab.key }] })
  }

  /** Y or LT on an empty tab: the frame goes, and crawl's key for the action goes alone (no menu to put away). */
  private actionKey(key: string) {
    // a menu still opening would take the key as a row's letter: the frame waits for it
    if (this.actionTurn) return
    this.overlays.closeClientOverlay()
    this.runner.execute({ kind: 'keys', label: key === SHOUT_KEY ? 'Shout' : 'Swap weapons', seq: [{ text: key }] })
  }

  /**
   * A turn of X's tabs, seen through: the tab's menu up (the frame goes,
   * and X will open on it again), or crawl's line refusing it ("You don't
   * know any spells."), which the frame shows where the menu would be.
   * `z` asks before it lists (spl-cast.cc `cast_a_spell`, a prompt-channel
   * line), and `*` answers. Anything else crawl puts up, or nothing for a
   * while, ends the turn and the frame with it. The keys go as crawl's
   * answers land; the frame goes only from a drawn frame (`drawn`), once
   * what crawl put up stands in its place, or the screen would be bare
   * for a frame between the two.
   */
  private trackActions(now: number, drawn: boolean) {
    const turn = this.actionTurn
    const st = this.session.state
    // read off the state, not the frame's context: crawl's answer to one key may call for the next before a frame is drawn
    const mode = deriveMode(st)
    const menu = mode === 'menu' ? topMenu(st) : undefined
    const up = menu ? actionTabOf(menu) : null
    if (!turn) {
      if (up) this.actionTabUp = up
      return
    }
    const end = () => {
      if (!drawn) return
      this.actionTurn = null
      if (this.overlays.openMenu === 'battle') this.overlays.closeClientOverlay()
    }
    // the frame put away (B, F3) while crawl was still answering: what lands goes too
    const abandoned = this.overlays.openMenu !== 'battle'
    // a menu going away passes through `prompt` (its last line was one); anything else crawl puts up ends the turn
    const elsewhere = mode !== 'command' && mode !== 'menu' && mode !== 'prompt'
    if (elsewhere || now - turn.t > ACTION_TURN_MS) return end()
    if (turn.stage === 'closing') {
      // the menu left is still up until the Escape lands, whichever tab it is
      if (mode !== 'command') return
      if (abandoned) return end()
      return this.sendActionKey(turn.target)
    }
    if (up) {
      if (abandoned) {
        this.actionTurn = null
        this.runner.execute({ kind: 'keys', label: 'Cancel', seq: [{ key: 27 }] })
        return
      }
      // the player went on past this one while it opened
      if (up !== turn.target) return this.closeForTurn(turn.target)
      this.actionTabUp = up
      return end()
    }
    const last = st.messages.lines.at(-1)
    if (!last || last === turn.last) return
    const text = formattedStringToText(last.text).trim()
    if (text === OKAY_THEN) return
    // `z` asks before it lists, and waits for the answer; a refusal (some on the same channel) waits for nothing
    if (mode !== 'command') {
      if (turn.sent === 'spells' && turn.stage === 'sent' && last.channel === MSGCH.PROMPT) {
        turn.stage = 'listing'
        turn.last = last
        this.runner.execute({ kind: 'keys', label: 'List spells', seq: [{ text: '*' }] })
      }
      return
    }
    // refused: the tab is empty, and crawl's line says so; or the player has gone on, and the next key goes
    if (abandoned) return end()
    if (turn.sent !== turn.target) return this.sendActionKey(turn.target)
    this.actionTurn = null
    this.overlays.showActionTabs(turn.target, text)
  }

  /**
   * The pack's page and row, kept as the player leaves them, so Y brings the
   * pack back where it was: the same scroll under the cursor for reading it
   * again and again. Once Y's pack is on its page the cursor goes back to the
   * item, by its letter (a stack keeps its letter as it shrinks); an item
   * gone leaves crawl's own first row.
   */
  private trackPack() {
    const m = this.ctx.mode === 'menu' ? this.ctx.menu : undefined
    const page = m?.pack?.current
    const back = this.packReturn
    if (!m || !page) {
      // the pack put away (or never opened: crawl refused it) after Y's turn at it
      if (back?.seen && this.ctx.mode !== 'menu') this.packReturn = null
      return
    }
    if (back) {
      back.seen = true
      if (page !== back.page) return
      this.packReturn = null
      const key = this.packRow.get(page)
      if (key !== undefined) this.overlays.hoverHotkey(this.session.state, key)
    }
    this.packPage = page
    const hovered = m.menu.items[m.menu.last_hovered]?.hotkeys?.[0]
    if (hovered !== undefined) this.packRow.set(page, hovered)
  }

  private systemAction(op: string) {
    if (op === 'toggleRenderer') this.userToggleRenderer()
    else if (op === 'chat' && this.chatOn) this.chat.padFocus()
    else if (op === 'disconnect') this.hooks.onSystem('disconnect')
  }
}

/** How long a turn of X's tabs waits on crawl before it gives up (`trackActions`), as the runner's `awaitPrompt` waits on a prompt. */
const ACTION_TURN_MS = 1500

/** The keys for the pad's four menus: F2 Select's level map, F3 X's actions, F4 Y's gear, F5 Start's Orbrun menu. */
const MENU_KEYS: Record<string, CommandMenu | 'levelmap' | 'equipment' | 'system'> = { F2: 'levelmap', F3: 'battle', F4: 'equipment', F5: 'system' }

/** Degrees to radians: the Camera angle setting is degrees, every camera is radians. */
function radians(deg: number): number {
  return (Math.PI / 180) * deg
}

export { keyMessage }
