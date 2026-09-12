import { cm, mapKey, MouseMode, UiState, keyMessage, type ClientMessage, type GameMessage, type GameState } from '@orbrun/webtiles'
import { cellKey, dirFromDelta, isThreat, nearestHostile, type Billboard, type CellKey, type MapRenderer, type Scene, type SceneCursor } from '@orbrun/scene'
import { linesSince, namedInWarnings, namedMonster } from './warnings'
import { Render3d } from '@orbrun/render-3d'
import { viewmodelFor } from '@orbrun/scene-webtiles'
import { Render2d, horizontalFov } from '@orbrun/render-2d'
import { escapeHtml, h } from './dom'
import type { Session } from './session'
import { CameraController } from './camera'
import { deriveContext, deriveMode, isFocusMode, type Context } from './context'
import type { FocusOp } from './focus'
import { HOLD_MS, LEVEL_MAP, barLabels, contextualLabel, armsTapOrHold, holdAction, resolve, type Action, type CommandCategory, type RelDir } from './bindings'
import { MORPH, animate, containTransform, reducedMotion } from './mapmorph'
import { Runner, stepIsOurs, type LastStep } from './runner'
import { Hud, MINIMAP_WEDGE_ALPHA, MINIMAP_WEDGE_REACH } from './hud'
import { GridHost } from './grid/host'
import { gameSplit, levelMapSplit, type GameLayout } from './grid/console'
import { Chat } from './chat'
import { Overlays } from './overlays'
import { directionKey, isTextEntry, keydownMessage } from './keys'
import { isPadActivity, type Button, type GamepadInput, type PadEvent } from './gamepad'
import { gamepadHints, type PadHintEvidence } from './gamepad-hints'
import { CHAMFER, getSavedView, saveSettings, saveView, WALL_INSET, type Settings } from './servers'
import { CAM_DISTANCES, CAM_HEIGHTS } from './settings-rows'

/** The most drawn pixels per CSS pixel the game view gets (Part IV of rendering-3d.md): the display's density, capped here. */
const VIEW_MAX_DPR = 1

/** css pixels a touch must travel before a press becomes a look drag */
const DRAG_SLOP = 6
/** css pixels of wheel that make one stop of third-person camera distance */
const WHEEL_STEP = 40
/** wheel lines (deltaMode 1) are worth this many pixels */
const WHEEL_LINE = 40
/** level-map cells per unit of right-stick look while the map is open */
const MAP_PAN_RATE = 0.12
/** game.js `show_diameter`: the cells across a full field of view, which the view is fitted to */
const SHOW_DIAMETER = 17
/** how far the 2D view's facing wedge reaches, in cells (render-2d's own default) */
const VIEW_WEDGE_REACH = 8
/** keyboard keys the focus layer takes over on a screen that offers a cursor */
const FOCUS_KEYS: Record<string, FocusOp> = { ArrowUp: 'prev', ArrowDown: 'next', ArrowLeft: 'left', ArrowRight: 'right', Enter: 'select', Escape: 'cancel', PageUp: 'pagePrev', PageDown: 'pageNext' }

/** The device the player touched last; the prompt strip is drawn for it. */
export type InputDevice = 'pad' | 'keyboard' | 'pointer'

export interface GameHooks {
  settings(): Settings
  settingsPanel(): HTMLElement
  onSystem(op: 'disconnect'): void
  gamepad: GamepadInput
  initialInput?: InputDevice
}

/** An outgoing view kept on screen while it animates away. */
interface Ghost {
  canvas: HTMLCanvasElement
  renderer: MapRenderer
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
  private lastMapView = false
  private session: Session
  private cam = new CameraController()
  private runner: Runner
  private hud: Hud
  private chat: Chat
  private overlays: Overlays
  private hooks: GameHooks
  private ctx: Context
  private unsub: (() => void)[] = []
  private needsRender = true
  /** `rev.player` the viewmodel was last built from */
  private viewmodelRev = -1
  private lastFrame = performance.now()
  private raf = 0
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
  private lastCursor: SceneCursor | null = null
  private lastOptKey = ''
  private drag: { id: number; x: number; y: number; x0: number; y0: number; moved: boolean; button: number } | null = null
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
  /**
   * What the player touched last: the prompt strip is drawn for it (pad
   * glyphs, key caps, nothing for the mouse). Merely plugging in a pad is
   * not input; the front end passes along the device used to launch play.
   */
  private lastInput: InputDevice = 'keyboard'
  private padHints = gamepadHints()
  private padStep: LastStep | null = null
  private padLooking = false
  /** right-stick travel accumulated toward the next level-map cursor step */
  private mapPan = { x: 0, y: 0 }

  constructor(host: HTMLElement, session: Session, hooks: GameHooks) {
    this.session = session
    this.hooks = hooks
    this.root = h('div', { class: 'screen game' })
    host.append(this.root)
    this.root.append(this.canvas, this.loading)
    const st = hooks.settings()
    this.is3d = st.renderer === '3d'
    this.grid = new GridHost(this.root, this.textPx())
    this.grid.onfit = () => this.relayout(true)
    this.renderer = this.makeRenderer()
    this.cam.reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
    // the rest angle first: a saved view is already where the player left it
    this.cam.setRestPitch(radians(st.restPitch))
    // point the camera where the last session left it
    const view = getSavedView()
    if (view) this.cam.restore(view)
    window.addEventListener('pagehide', this.saveView)
    this.hud = new Hud(this.root, {
      onSelectMonster: (b) => this.faceBillboard(b),
      onBarAction: (a) => this.runner.execute(a),
      onMinimapClick: () => this.runner.execute(LEVEL_MAP),
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
      settingsPanel: () => this.hooks.settingsPanel(),
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
    })
    this.ctx = deriveContext(session.state, session.scene, this.cam.camera, 'micro')
    this.lastInput = hooks.initialInput ?? 'keyboard'
    this.padHints.cancel() // no pending server reply survives a screen/run change
    this.unsub.push(
      session.on((e) => {
        if (e.type === 'scene') this.onScene()
        else if (e.type === 'state') {
          this.needsRender = true
          this.trackHop()
          if (e.msg.msg === 'input_mode') this.payOwedTurn()
          // a new game on the same version reuses the loaded gamedata, so no
          // `gamedata` event follows: only wait when the session is fetching
          if (e.msg.msg === 'game_client' || e.msg.msg === 'go_lobby') {
            if (this.session.gamedata && !this.session.loading) this.hideLoading()
            else this.showLoading('Loading game data…')
          }
        } else if (e.type === 'gamedata') {
          if (e.status === 'ready') {
            this.hideLoading()
            if (this.session.gamedata) this.renderer.setTiles(this.session.gamedata)
            this.needsRender = true
          } else if (e.status === 'error') this.showLoading('Could not load game data: ' + (e.detail || ''))
          else this.showLoading(`Loading game data… ${e.done ?? 0}/${e.total ?? 0}`)
        }
      }),
    )
    if (this.session.gamedata) {
      this.renderer.setTiles(this.session.gamedata)
      this.hideLoading()
    } else this.showLoading('Loading game data…')
    this.onKeyDown = this.onKeyDown.bind(this)
    window.addEventListener('keydown', this.onKeyDown, true)
    this.onResize = this.onResize.bind(this)
    window.addEventListener('resize', this.onResize)
    this.onDocPointer = this.onDocPointer.bind(this)
    document.addEventListener('pointerdown', this.onDocPointer, true)
    this.onDocContextMenu = this.onDocContextMenu.bind(this)
    document.addEventListener('contextmenu', this.onDocContextMenu, true)
    this.attachPointer(this.canvas)
    this.hud.setMinimapTiles(st.minimapTiles, st.minimapCell)
    this.relayout(true)
    this.loop = this.loop.bind(this)
    this.raf = requestAnimationFrame(this.loop)
  }

  destroy() {
    this.saveView()
    window.removeEventListener('pagehide', this.saveView)
    cancelAnimationFrame(this.raf)
    window.removeEventListener('keydown', this.onKeyDown, true)
    window.removeEventListener('resize', this.onResize)
    document.removeEventListener('pointerdown', this.onDocPointer, true)
    document.removeEventListener('contextmenu', this.onDocContextMenu, true)
    for (const u of this.unsub) u()
    this.grid.destroy()
    this.renderer.destroy()
    this.root.remove()
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
   * say so (`levelMapSplit`). Cheap to call every frame; only acts on change.
   */
  private relayout(force = false) {
    if (!this.hud) return
    const st = this.session.state
    const o = st.options
    const g = this.grid.grid
    const mapView = st.uiState === UiState.VIEW_MAP
    const hideSidebar = mapView && o.tile_level_map_hide_sidebar === true
    const hideMessages = mapView && o.tile_level_map_hide_messages === true
    // no character yet: the official client's crt layer (game.js `set_ui_state`, `client.set_layer("crt")`) covers
    // the sidebar while the new-game chooser has the UI in CRT state (newgame.cc `choose_game`), until the redraw
    // that sends the first `player` (tileweb.cc `redraw`); a continued game has no sheet before that message either
    const hideStats = hideSidebar || st.uiState === UiState.CRT || !st.player.received
    const key = [g.cols, g.rows, g.cw, g.ch, g.ox, g.oy, st.messages.paneHeight, hideStats, hideSidebar, hideMessages].join(',')
    if (!force && key === this.layoutKey) return
    this.layoutKey = key
    const cells = gameSplit(g, st.messages.paneHeight)
    const view = mapView ? levelMapSplit(g, cells, { hideSidebar, hideMessages }) : cells.view
    this.grid.place(this.canvas, view)
    const px = this.grid.px(view)
    this.viewPx = px
    this.renderer.resize(px.width, px.height, this.viewDpr())
    // what rides the view's edges keeps clear of the panes
    const free = mapView ? view : cells.clear
    this.hud.layout(this.grid, cells, free, { stats: hideStats, sidebar: hideSidebar, messages: hideMessages })
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
   * the weapon; null with no hand there (2D, third person, hands off, unarmed).
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

  /** Remember where the camera points so the next session starts facing the same way. */
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

  private makeRenderer(): MapRenderer {
    const st = this.hooks.settings()
    const r: MapRenderer = this.is3d ? new Render3d(this.render3dOptions(st)) : new Render2d({ cellSize: 32, fov: this.horizontalFov(st.fov) })
    r.mount(this.canvas)
    this.viewmodelRev = -1
    if (this.session.gamedata) r.setTiles(this.session.gamedata)
    r.setScene(this.session.scene)
    r.setCamera(this.cam.camera)
    return r
  }

  applySettings() {
    const st = this.hooks.settings()
    this.cam.thirdPerson = st.view === 'third'
    this.cam.setRestPitch(radians(st.restPitch))
    document.documentElement.style.setProperty('--ui-scale', String(st.uiScale))
    this.grid.setTextSize(this.textPx())
    const want3d = st.renderer === '3d' && !this.mapBorrowed2d
    if (want3d !== this.is3d) this.toggleRenderer()
    else if (this.is3d) (this.renderer as Render3d).setOptions(this.render3dOptions(st))
    else (this.renderer as Render2d).setOptions({ fov: this.horizontalFov(st.fov) })
    this.hud.setFov(this.horizontalFov(st.fov))
    // the minimap's size is the layout's to set
    this.hud.setMinimapTiles(st.minimapTiles, st.minimapCell)
    this.relayout(true)
    this.needsRender = true
  }

  private render3dOptions(st: Settings) {
    return { view: st.view, camDistance: st.camDistance, camHeight: st.camHeight, eyeHeight: st.eyeHeight, restPitch: radians(st.restPitch), fov: st.fov, viewmodel: st.viewmodel, wallInset: WALL_INSET, chamfer: CHAMFER, motion: !this.cam.reducedMotion }
  }

  /** A melee attack lifts the weapon a touch (rendering-3d.md II.7); frames follow until it settles. */
  private swing() {
    if (!this.is3d) return
    ;(this.renderer as Render3d).attack()
    this.needsRender = true
  }

  /**
   * The hands hold what the `player` message says is wielded; rebuilt only
   * when that message changes.
   */
  private syncViewmodel(st: GameState) {
    if (!this.is3d || st.rev.player === this.viewmodelRev) return
    this.viewmodelRev = st.rev.player
    ;(this.renderer as Render3d).setViewmodel(viewmodelFor(st, this.session.gamedata ?? undefined))
  }

  /** The 3D camera's horizontal field of view, from the vertical setting and the view's aspect. */
  private horizontalFov(verticalDeg: number): number {
    const w = this.canvas.clientWidth || 16
    const h = this.canvas.clientHeight || 9
    return horizontalFov(verticalDeg, w / h)
  }

  /**
   * Swap 2D ⇄ 3D. With `keepGhost` the outgoing canvas stays in the DOM
   * (inert, above the new one) for the caller to animate away; its renderer
   * is destroyed with it in `dropGhost`.
   */
  private toggleRenderer(keepGhost = false): Ghost | null {
    const old = { canvas: this.canvas, renderer: this.renderer }
    this.is3d = !this.is3d
    // a fresh canvas: WebGL and 2D contexts cannot share one
    const c = h('canvas', { class: 'view' })
    // the new view slides in underneath; the old one is never detached while
    // it lingers, since re-inserting a WebGL canvas drops its drawing buffer
    old.canvas.before(c)
    this.canvas = c
    this.attachPointer(c)
    this.renderer = this.makeRenderer()
    this.lastOptKey = ''
    this.relayout(true)
    this.needsRender = true
    if (!keepGhost) {
      old.renderer.destroy()
      old.canvas.remove()
      return null
    }
    old.canvas.classList.remove('locked')
    old.canvas.classList.add('ghost')
    return old
  }

  private showLoading(text: string) {
    this.loading.textContent = text
    this.loading.style.display = ''
  }
  private hideLoading() {
    this.loading.style.display = 'none'
  }

  private onResize() {
    // the grid host watches the root too; a window resize is the sure signal on browsers without a ResizeObserver
    this.grid.fit()
  }

  // ------------------------------------------------------------- frame loop

  private loop(now: number) {
    this.raf = requestAnimationFrame(this.loop)
    const dt = Math.min(0.1, (now - this.lastFrame) / 1000)
    this.lastFrame = now
    if (this.session.flushScene()) this.needsRender = true
    const beforeLook = this.cam.view
    if (this.cam.update(dt)) this.needsRender = true
    if (this.padLooking && this.lastInput === 'pad' && this.ctx.mode === 'command' && !this.overlays.hasClientOverlay && !this.session.watching) {
      const after = this.cam.view
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
    this.ctx = deriveContext(st, this.session.scene, this.cam.camera, 'micro')
    this.fireHolds(now)
    // the server reports targeting alone; the runner knows whether its `x` opened it
    if (this.runner.examining(this.ctx.mode)) this.ctx.examining = true
    this.viewHeld = this.runner.holdingView(this.ctx.mode)
    this.runner.startAimAhead(this.ctx.mode)
    if (this.ctx.mode === 'popup') this.ctx.popupActions = this.overlays.popupActions()
    this.overlays.updatePrompt(this.ctx.mode, this.ctx.prompt, this.lastInput)
    this.overlays.syncFocus(this.ctx)
    const fi = this.overlays.focusInfo(this.ctx)
    if (fi) this.ctx.focus = fi
    this.padHints.observe(this.padHintEvidence(), now)
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
    this.relayout()
    this.syncMapRenderer(st)
    this.applyServerOptions()
    this.hud.keepClear(this.handsLeft())
    // the monster list or the edge pips, one or the other; in 2D the top-down view frames everything in sight, so the list stands in
    const nearby = this.is3d ? this.hooks.settings().nearby : 'list'
    const settings = this.hooks.settings()
    const padLabels = this.overlays.hasClientOverlay || this.chat.capturing ? [] : this.padHints.prompts(this.ctx, settings.hints)
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
    this.hud.update(st, this.session.scene, this.cam.camera, this.ctx, this.hooks.gamepad.kind, this.session.gamedata, this.session.watching, this.lastInput, nearby, settings.hints !== 'off', padLabels, held)
    this.chat.update(st, st.phase === 'playing' || st.phase === 'watching', !!st.lobby.username)
    if (this.ctx.mode === 'targeting') this.pointTarget()
    else this.lastTargetSent = -1
    if (this.needsRender) {
      this.needsRender = false
      this.syncViewmodel(st)
      // dungeon_renderer.js set_view_center: the 2D view sits on the server's view
      // centre (`vgrdc`), the player in normal play and the map cursor while the
      // level map is open, so the map scrolls under the cursor as WebTiles' does
      if (this.renderer instanceof Render2d) this.renderer.setOptions({ center: st.map.viewCenter })
      this.renderer.setScene(this.session.scene)
      this.renderer.setCamera(this.cam.camera)
      this.renderer.render()
      // edge pips follow the frame just drawn: only a 3D frame has a lens to be out of
      const r3d = this.renderer instanceof Render3d ? this.renderer : null
      this.hud.renderPips(this.session.scene, st, this.session.gamedata, r3d ? r3d.projector() : null, nearby === 'pips' ? 'all' : 'off')
    }
  }

  /**
   * The level map (X) is the WebTiles 2D view fullscreen: while it is open
   * a 3D view swaps to the 2D renderer, and swaps back when it closes.
   *
   * The swap is staged as a morph (see mapmorph.ts): opening, the corner
   * minimap grows into the fullscreen map; closing, the map shrinks back into
   * the corner. The outgoing canvas lingers as a non-interactive ghost for
   * the duration so nothing cuts to black.
   */
  private syncMapRenderer(st: GameState) {
    const mapView = st.uiState === UiState.VIEW_MAP
    if (mapView === this.lastMapView) return
    this.lastMapView = mapView
    // the canvas has its level-map cells by now (`relayout` ran first in the frame)
    const view = this.canvas.getBoundingClientRect()
    const mini = this.hud.minimapRect()
    const reduced = reducedMotion()
    if (mapView) {
      if (this.is3d) {
        this.mapBorrowed2d = true
        const ghost = this.toggleRenderer(true)
        const t = reduced ? MORPH.reduced : MORPH.enter
        const opts = { duration: t.duration, easing: t.easing }
        // the world recedes a touch as the map comes forward
        if (ghost)
          void animate(
            ghost.canvas,
            reduced
              ? [{ opacity: 1 }, { opacity: 0 }]
              : [
                  { opacity: 1, transform: 'none' },
                  { opacity: 1, offset: 0.15 },
                  { opacity: 0, transform: 'scale(1.04)', offset: 0.85 },
                  { opacity: 0, transform: 'scale(1.04)' },
                ],
            opts,
          ).then(() => this.dropGhost(ghost))
        void animate(
          this.canvas,
          reduced
            ? [{ opacity: 0 }, { opacity: 1 }]
            : [
                { transform: containTransform(view, mini), opacity: 0 },
                { opacity: 1, offset: 0.45 },
                { transform: 'none', opacity: 1 },
              ],
          opts,
        )
      }
      void this.hud.expandMinimap(view)
    } else {
      if (this.mapBorrowed2d) {
        this.mapBorrowed2d = false
        if (!this.is3d) {
          const ghost = this.toggleRenderer(true)
          const t = reduced ? MORPH.reduced : MORPH.exit
          const opts = { duration: t.duration, easing: t.easing }
          if (ghost)
            void animate(
              ghost.canvas,
              reduced
                ? [{ opacity: 1 }, { opacity: 0 }]
                : [
                    { transform: 'none', opacity: 1 },
                    { opacity: 0.9, offset: 0.5 },
                    { transform: containTransform(view, mini), opacity: 0 },
                  ],
              opts,
            ).then(() => this.dropGhost(ghost))
          void animate(this.canvas, [{ opacity: 0 }, { opacity: 1, offset: 0.6 }, { opacity: 1 }], opts)
        }
      }
      void this.hud.collapseMinimap(view)
    }
  }

  /** The outgoing view has finished its morph: release its renderer and canvas. */
  private dropGhost(g: Ghost) {
    g.renderer.destroy()
    g.canvas.remove()
  }

  /** First ⇄ third person (rendering-3d.md II.11): a setting, so it sticks across sessions. */
  private toggleView() {
    const st = this.hooks.settings()
    st.view = st.view === 'third' ? 'first' : 'third'
    saveSettings(st)
    this.applySettings()
    this.hud.status(st.view === 'third' ? 'Third person' : 'First person')
  }

  /**
   * Third-person camera distance (rendering-3d.md II.11), one stop at a
   * time. It clamps at the ends rather than wrapping the way the settings
   * row does: a wheel that jumped from nearest to furthest would read as a
   * cut, not a zoom. A setting, so it sticks; the shot still pulls the
   * camera in when the cells behind are tight.
   */
  private zoomCamera(d: number) {
    const st = this.hooks.settings()
    const n = step(CAM_DISTANCES, st.camDistance, d)
    if (n === st.camDistance) return
    st.camDistance = n
    saveSettings(st)
    this.applySettings()
    this.hud.status(`Camera ${n.toFixed(2)} cells back`)
  }

  /**
   * Third-person camera height (rendering-3d.md II.11), Shift and the wheel,
   * one stop at a time and clamped at the ends the way the distance is: from
   * the doll's waist to just under the lid.
   */
  private raiseCamera(d: number) {
    const st = this.hooks.settings()
    const n = step(CAM_HEIGHTS, st.camHeight, d)
    if (n === st.camHeight) return
    st.camHeight = n
    saveSettings(st)
    this.applySettings()
    this.hud.status(`Camera ${n.toFixed(2)} cells up`)
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
    const mapView = st.uiState === UiState.VIEW_MAP
    const key = JSON.stringify([
      this.is3d,
      mapView,
      // the cell size is fitted to the view (`cellPixels`), so its size belongs to the key
      this.canvas.clientWidth,
      this.canvas.clientHeight,
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
    if (this.is3d) (this.renderer as Render3d).setMinibars(minibars)
    else {
      const num = (v: unknown, d: number) => (typeof v === 'number' && v > 0 ? v : d)
      const px = num(o.tile_cell_pixels, 32)
      const scale = mapView ? num(o.tile_map_scale, 60) : num(o.tile_viewport_scale, 100)
      const mode = o.tile_display_mode === 'glyphs' ? 'glyphs' : o.tile_display_mode === 'hybrid' ? 'hybrid' : 'tiles'
      ;(this.renderer as Render2d).setOptions({
        cellSize: this.cellPixels(Math.max(8, Math.round((px * scale) / 100)), mode),
        mode,
        // the level map is the minimap fullscreen, so it wears the minimap's short, faint
        // facing wedge; the 2D view keeps the main view's long, solid one
        wedgeReach: mapView ? MINIMAP_WEDGE_REACH : VIEW_WEDGE_REACH,
        wedgeAlpha: mapView ? MINIMAP_WEDGE_ALPHA : 1,
        filterScaling: o.tile_filter_scaling === true,
        glyphFont: typeof o.glyph_mode_font === 'string' && o.glyph_mode_font ? o.glyph_mode_font : 'monospace',
        minibars,
      })
    }
    this.needsRender = true
  }

  /**
   * dungeon_renderer.js `fit_to`: the cells from the rc options, shrunk to fit
   * if a full field of view (game.js `show_diameter`) would not otherwise
   * stand in the view. Glyph modes size their cells from the font instead, so
   * they are left alone.
   */
  private cellPixels(cell: number, mode: string): number {
    if (mode === 'glyphs') return cell
    const w = this.canvas.clientWidth
    const h = this.canvas.clientHeight
    if (!w || !h) return cell
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
   * own aims, look mode (`x`) and fire (`f`) alike, the view holds its
   * heading while the cursor walks in front of the player, and turns to
   * the nearest heading only when the cursor goes beside or behind (camera
   * `faceCursorBehind`); the keys read against whatever grid is in view
   * (camera `gridFacing`). A fire that locked onto a target behind the
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
    // every pointer move, camera move, resize and level change marks a render, so this is the only time the pick can change
    if (this.needsRender || this.pickMemo === undefined) this.pickMemo = this.renderer.pick(this.hover.x, this.hover.y)
    return this.pickMemo
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
      this.lastLevel = level
      const moved = p.x !== this.lastPos.x || p.y !== this.lastPos.y
      if (moved || newLevel) {
        // the feet moved on: whatever turn was owed is about the old spot
        this.owedTurn = null
        const dx = p.x - this.lastPos.x
        const dy = p.y - this.lastPos.y
        // ours only if it went the way our last step was sent: a one-cell
        // explore right after a keyed step is the explore's, not ours. Several
        // echoes of a held stick in one frame are ours when every hop went that way.
        const wasOurs = stepIsOurs(this.runner.lastStep, dx, dy, performance.now(), jumped ? [] : hops)
        this.cam.snapTo(p.x, p.y)
        const sameLevel = !newLevel && !Number.isNaN(this.lastPos.x) && !(dx === 0 && dy === 0)
        const single = Math.abs(dx) <= 1 && Math.abs(dy) <= 1
        if (sameLevel && wasOurs && this.padStep === this.runner.lastStep && !this.session.watching) {
          this.padHints.moved(Math.max(1, hops.length))
          this.padStep = null
        }
        // Several cells in one frame is still a walk when every hop the server
        // sent was one cell: travel, explore, a spectated player. The last hop
        // is the way the feet went. A single position update spanning several
        // cells (`travel_delay -1`, a blink, a teleport) has no hops: the
        // travel trail tells the last step, else the displacement stands in.
        const walk = sameLevel && hops.length > 0 && !jumped
        if (!sameLevel) {
          // level change: never nose-to-wall
          if (!this.cam.steering) this.arrivalPending = !this.cam.faceAfterArrival(scene)
        } else if (this.cam.steering) {
          // the player is looking around: leave the view alone
        } else if (wasOurs) {
          // our own step: only one that turned the view (forward, or an attack)
          // snaps the camera onto the exact vector the feet took. A strafe --
          // j, y, u, b, n -- keeps its heading.
          if (this.runner.lastStep?.turned) this.cam.faceStep(dx, dy)
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
      const keyedJustNow = !!this.runner.lastStep && performance.now() - this.runner.lastStep.t < 400
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
    if (this.chat.capturing || this.overlays.hasClientOverlay || this.ctx.mode !== 'command') {
      this.tapArmed.clear()
      return
    }
    for (const [b, t0] of this.pressTimes) {
      if (this.holdFired.has(b) || !this.tapArmed.has(b) || !this.hooks.gamepad.isHeld(b as Button)) continue
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
    // a press, a stick or the d-pad is the pad speaking; a stick settling back to centre is not
    if (isPadActivity(ev)) this.inputFrom('pad')
    if (this.chat.capturing) {
      this.chat.pad(ev)
      return
    }
    if (this.overlays.hasClientOverlay) {
      if (ev.type === 'press') {
        if (ev.button === 'A') this.overlays.clientOverlayInput('select')
        else if (ev.button === 'START') this.overlays.clientOverlayInput('submit')
        else if (ev.button === 'B') this.overlays.clientOverlayInput('cancel')
        // Select opened this screen (or Start did): pressing it again puts it away
        else if (ev.button === 'SELECT') this.overlays.clientOverlayInput('close')
        else if (ev.button === 'X') this.overlays.clientOverlayInput('keyboard')
        else if (ev.button === 'LB') this.overlays.clientOverlayInput('bumperPrev')
        else if (ev.button === 'RB') this.overlays.clientOverlayInput('bumperNext')
      } else if (ev.type === 'dir' || ev.type === 'dirRepeat') {
        if (ev.dir === 0) this.overlays.clientOverlayInput('prev')
        else if (ev.dir === 4) this.overlays.clientOverlayInput('next')
        else if (ev.dir === 6) this.overlays.clientOverlayInput('left')
        else if (ev.dir === 2) this.overlays.clientOverlayInput('right')
      }
      return
    }
    const st = this.hooks.settings()
    if (ev.type === 'look') {
      this.padLooking = ev.dx !== 0 || ev.dy !== 0
      if (this.ctx.mode === 'levelmap') {
        // the level map is north-up: the right stick pans it instead of the camera
        this.panMap(ev.dx, ev.dy)
        return
      }
      this.mapPan = { x: 0, y: 0 }
      this.cam.look(ev.dx, ev.dy, st.lookSensitivity, st.invertLook)
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
      if (ev.type === 'press' && (ev.button === 'B' || ev.button === 'START')) this.overlays.showSystem({ spectating: true, inGame: true })
      // a spectator's chat is one button away, as F12 is in the official client
      if (ev.type === 'press' && ev.button === 'X') this.chat.padFocus()
      if ((ev.type === 'dir' || ev.type === 'dirRepeat') && ev.dir !== null) this.hud.scrollLog(ev.dir === 0 ? -1 : ev.dir === 4 ? 1 : 0)
      return
    }
    const a = resolve(ev, this.ctx)
    if (!a) return
    this.inputActed()
    this.executePadAction(a)
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

  private inputActed() {
    this.tapArmed.clear()
    this.holding = null
    if (!this.pointerLive) return
    this.pointerLive = false
    clearTimeout(this.tooltipTimer)
    this.hud.hideTooltip()
    this.needsRender = true
  }

  private onKeyDown(ev: KeyboardEvent) {
    const target = ev.target as HTMLElement | null
    // a key typed into a field is still the keyboard speaking (a server prompt's on-screen keyboard goes away for it)
    this.inputFrom('keyboard')
    if (target && isTextEntry(target)) return
    // F2 is Orbrun's own: the player's commands. A bare F1 goes on to Crawl (keys.ts CODES), which binds it
    // to CMD_GAME_MENU alongside `~`, so it opens the usual WebTiles game menu.
    if (ev.key === 'F2' && !ev.shiftKey && !ev.ctrlKey && !ev.altKey && !ev.metaKey) {
      ev.preventDefault()
      if (!ev.repeat && !this.session.watching) {
        // the keyboard's Select: it toggles, as the button does
        if (this.overlays.hasClientOverlay) this.overlays.clientOverlayInput('close')
        else if (this.ctx.mode === 'command') this.overlays.showCommands((a) => this.runner.execute(a), 'select')
        else this.overlays.showPalette(this.ctx.mode === 'targeting' || this.ctx.mode === 'levelmap' || this.ctx.mode === 'menu' ? this.ctx.mode : 'command')
      }
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
      else if (!ev.altKey && !ev.metaKey) {
        if (ev.key === 'Tab') this.overlays.clientOverlayHotkey('Tab')
        else if (ev.key.length === 1) this.overlays.clientOverlayHotkey(ev.ctrlKey ? 'Ctrl-' + ev.key.toUpperCase() : ev.key)
      }
      ev.preventDefault()
      return
    }
    if (ev.key === 'F12' || ev.code === 'F12') {
      // client.js: F12 focuses chat
      this.chat.focus()
      ev.preventDefault()
      return
    }
    if (this.session.watching) {
      if (ev.key === 'Escape') this.overlays.showSystem({ spectating: true, inGame: true })
      return
    }
    // Esc is the server's game menu; Orbrun's settings are also under Commands → More.
    const mode = this.ctx.mode
    // a server menu: arrows, paging and the paging characters move its hover and
    // page on the client, as menu.js does before any key reaches the server
    if (mode === 'menu' && this.ctx.menu?.menu.type !== 'crt' && this.overlays.menuKey(this.session.state, ev)) {
      ev.preventDefault()
      this.inputActed()
      this.needsRender = true
      return
    }
    // the focus layer: arrows, Enter and Escape drive the cursor over a screen that offers one; otherwise the keys stay raw
    if (isFocusMode(this.ctx) && !ev.ctrlKey && !ev.altKey && !ev.metaKey && !ev.shiftKey) {
      // space fires the cursor too, except on a popup that scrolls its own text, where
      // it pages (ui-layouts.js scroller_handle_key) — the reading key stays the reader's
      const op = FOCUS_KEYS[ev.key] ?? (ev.key === ' ' && !this.overlays.popupScrolls ? 'select' : undefined)
      if (op && this.overlays.focusKey(this.session.state, this.ctx, op)) {
        ev.preventDefault()
        this.inputActed()
        this.needsRender = true
        return
      }
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
        // (plain: step / cursor move, Shift: run / fire that way, Ctrl: attack)
        this.inputActed()
        this.runner.step(d.abs as RelDir, { run: d.mod === 'shift', attack: d.mod === 'ctrl', keyboard: true })
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
      this.inputFrom('pointer')
      // mouse_control.js: any mousedown hides the cell tooltip
      clearTimeout(this.tooltipTimer)
      this.hud.hideTooltip()
      // a click is the mouse speaking: its selection is live again, so a click right after a key still acts on the hovered cell
      if (ev.pointerType === 'mouse') this.pointerLive = true
      if (this.drag) return
      this.drag = { id: ev.pointerId, x: ev.clientX, y: ev.clientY, x0: ev.clientX, y0: ev.clientY, moved: false, button: ev.button }
      c.setPointerCapture(ev.pointerId)
    })
    c.addEventListener('pointermove', (ev) => {
      if (ev.pointerType === 'mouse') {
        const rect = this.canvas.getBoundingClientRect()
        this.hover = { x: ev.clientX - rect.left, y: ev.clientY - rect.top }
        this.hoverMoved = true
        this.pointerLive = true
        this.needsRender = true
        this.armCellTooltip(ev.pageX, ev.pageY)
      }
      const d = this.drag
      if (!d || ev.pointerId !== d.id) return
      const dx = ev.clientX - d.x
      const dy = ev.clientY - d.y
      d.x = ev.clientX
      d.y = ev.clientY
      if (!d.moved && Math.hypot(ev.clientX - d.x0, ev.clientY - d.y0) < DRAG_SLOP) return
      d.moved = true
      const st = this.hooks.settings()
      // radians per css pixel; a full drag across the view is about a half turn
      const k = (Math.PI / Math.max(300, this.canvas.clientWidth)) * st.lookSensitivity
      // the drag grabs the world, the way a Mac scrolls: the dungeon follows the
      // pointer, so dragging right swings the view left and dragging down looks up
      this.cam.lookBy(-dx * k, (st.invertLook ? -dy : dy) * k)
      this.needsRender = true
    })
    const end = (ev: PointerEvent) => {
      const d = this.drag
      if (!d || ev.pointerId !== d.id) return
      this.drag = null
      if (c.hasPointerCapture(ev.pointerId)) c.releasePointerCapture(ev.pointerId)
      if (d.moved) {
        this.cam.endDrag()
        this.needsRender = true
      } else if (ev.type === 'pointerup') {
        const rect = this.canvas.getBoundingClientRect()
        this.onPointer(ev.clientX - rect.left, ev.clientY - rect.top, d.button)
      }
    }
    // the wheel pulls the third-person camera in and out, and with Shift raises
    // and lowers it; in first person there is nothing to zoom, and the page
    // keeps its own scroll
    c.addEventListener('wheel', (ev) => {
      if (!this.is3d || this.hooks.settings().view !== 'third') return
      ev.preventDefault()
      // a browser turns Shift+wheel into a horizontal scroll, so the notch can
      // arrive on either axis: take whichever one moved
      const raw = ev.deltaY || ev.deltaX
      const px = ev.deltaMode === 0 ? raw : raw * WHEEL_LINE
      const shift = ev.shiftKey
      this.wheel = this.wheel * px > 0 && shift === this.wheelShift ? this.wheel + px : px
      this.wheelShift = shift
      if (Math.abs(this.wheel) < WHEEL_STEP) return
      const d = Math.sign(this.wheel)
      this.wheel = 0
      // wheel up (negative delta) draws the camera in, or with Shift lifts it
      if (shift) this.raiseCamera(-d)
      else this.zoomCamera(d)
    }, { passive: false })
    c.addEventListener('pointerup', end)
    c.addEventListener('pointercancel', end)
    c.addEventListener('pointerleave', (ev) => {
      if (ev.pointerType === 'mouse') this.hover = null
      clearTimeout(this.tooltipTimer)
      this.hud.hideTooltip()
    })
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

  /** A server popup or dialog is up, and the pointer may close it: ui.js registers its handlers on the same condition. */
  private popupUp(): boolean {
    if (this.session.watching || this.overlays.hasClientOverlay) return false
    if (this.ctx.mode !== 'popup' && this.ctx.mode !== 'dialog') return false
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
   * Orbrun's own overlays are not server popups and handle their own
   * pointer.
   */
  private onDocPointer(ev: PointerEvent) {
    if (!this.popupUp()) return
    const t = ev.target instanceof Element ? ev.target : null
    if (t && this.chat.root.contains(t)) return
    const inside = !!t?.closest('.popup')
    if (inside && ev.button !== 2) return
    ev.preventDefault()
    ev.stopPropagation()
    clearTimeout(this.tooltipTimer)
    this.hud.hideTooltip()
    this.runner.send(cm.key(27))
  }

  /** ui.js context_disable: no browser context menu while a popup is up, except on a text input. */
  private onDocContextMenu(ev: MouseEvent) {
    if (!this.popupUp()) return
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
      case 'travel':
        this.overlays.showCommands((a) => this.runner.execute(a), op === 'travel' ? 'select' : 'battle')
        break
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
        this.overlays.showSystem({ spectating: this.session.watching, inGame: true })
        break
      case 'bindings':
        this.overlays.showBindings(this.hooks.gamepad.kind)
        break
      case 'faceHostile': {
        const scene = this.session.scene
        const m = nearestHostile(scene)
        if (m) this.faceBillboard(m)
        else this.hud.status('No hostiles in view')
        break
      }
      case 'toggleRenderer':
        this.userToggleRenderer()
        break
      case 'toggleView':
        this.toggleView()
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

  private systemAction(op: string) {
    if (op === 'toggleRenderer') this.userToggleRenderer()
    else if (op === 'toggleView') this.toggleView()
    else if (op === 'chat') this.chat.padFocus()
    else if (op === 'disconnect') this.hooks.onSystem('disconnect')
  }
}

/**
 * The stop `d` steps from whichever of `values` `cur` is nearest, clamped at
 * the ends rather than wrapping the way the settings row does: a wheel that
 * jumped from nearest to furthest would read as a cut, not a move.
 */
function step(values: readonly number[], cur: number, d: number): number {
  let i = 0
  for (let k = 1; k < values.length; k++) {
    if (Math.abs(values[k] - cur) < Math.abs(values[i] - cur)) i = k
  }
  return values[Math.max(0, Math.min(values.length - 1, i + d))]
}

/** Degrees to radians: the Camera angle setting is degrees, every camera is radians. */
function radians(deg: number): number {
  return (Math.PI / 180) * deg
}

export { keyMessage }
