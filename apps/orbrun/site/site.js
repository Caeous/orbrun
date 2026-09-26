// The site's pages with a pad in hand, and in a window of Orbrun's own (../site-pages.ts inlines this).
//
// Up and down (d-pad or left stick) move the gold cursor to the next link (or Copy) on
// screen, and scroll when there is none; A follows it, B or Start go back to
// the game, the bumpers step between a document's sections, the right stick
// scrolls. The prompts in the corner say so, as the game's do, and only once
// a pad has been used.
//
// In a window of our own (a kiosk browser from Steam, an installed app:
// quit.ts canQuit) a page of the site takes the place of the one before it
// rather than adding to history, as the app's addresses do, so the app's
// Quit can still close the window; and the query the window was opened with
// (`?fullscreen`, `?perf`) goes along to every page and back into the game.
;(() => {
  const OWN_WINDOW = ['fullscreen', 'standalone', 'minimal-ui', 'window-controls-overlay']
  const query = new URLSearchParams(location.search)
  const own =
    (query.has('fullscreen') && query.get('fullscreen') !== '0') ||
    navigator.standalone === true ||
    OWN_WINDOW.some((m) => matchMedia(`(display-mode: ${m})`).matches)

  /** a page of this site, with the query carried */
  const here = (href) => {
    const url = new URL(href, location.href)
    if (url.origin !== location.origin) return null
    if (location.search && !url.search) url.search = location.search
    return url
  }
  const go = (href) => {
    const url = here(href)
    if (!url) return
    if (own) location.replace(url.href)
    else location.assign(url.href)
  }
  for (const a of document.querySelectorAll('a[href]')) {
    const url = here(a.getAttribute('href'))
    if (!url || a.target === '_blank') continue
    a.href = url.pathname + url.search + url.hash
    // a jump within the page is the browser's own; only a new page is sent round
    if (own && !(url.pathname === location.pathname && url.hash)) a.addEventListener('click', (e) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
      e.preventDefault()
      go(a.href)
    })
  }

  // the bar is the room while the room is under it, and takes a ground of its own once words are
  const bar = document.querySelector('.bar')
  const hero = document.querySelector('.hero')
  // About's hero has words under the still: the bar takes its ground once they reach it, not once the whole hero is gone
  const words = hero?.querySelector('.title')
  const ground = () =>
    bar.classList.toggle('solid', !hero || (words ?? hero).getBoundingClientRect()[words ? 'top' : 'bottom'] <= bar.offsetHeight)
  addEventListener('scroll', ground, { passive: true })
  addEventListener('resize', ground, { passive: true })
  ground()

  // About's comparison: WebTiles over Orbrun, cut where the slider stands
  for (const fig of document.querySelectorAll('.compare')) {
    const range = fig.querySelector('input')
    const set = () => fig.style.setProperty('--x', `${range.value}%`)
    range.addEventListener('input', set)
    set()
  }

  // a line to type (a document's fenced block) copied at a click; where the clipboard is shut, it is selected for Ctrl+C
  for (const pre of document.querySelectorAll('.doc pre')) {
    const box = document.createElement('div')
    box.className = 'copyable'
    pre.before(box)
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'copy'
    button.textContent = 'Copy'
    box.append(pre, button)
    let reset = 0
    button.addEventListener('click', async () => {
      const text = pre.textContent.replace(/\n$/, '')
      try {
        await navigator.clipboard.writeText(text)
        button.textContent = 'Copied'
      } catch {
        getSelection().selectAllChildren(pre)
        button.textContent = 'Ctrl+C'
      }
      clearTimeout(reset)
      reset = setTimeout(() => (button.textContent = 'Copy'), 2000)
    })
  }

  // ---------------------------------------------------------------- the pad
  let cursor = null
  const point = (el) => {
    cursor?.classList.remove('cursor')
    cursor = el
    if (!el) return
    el.classList.add('cursor')
    el.focus({ preventScroll: true })
    el.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }
  addEventListener('mousemove', () => point(null), { passive: true })

  const onScreen = () =>
    [...document.querySelectorAll('main a[href], main button.copy, header a[href], footer a[href]')].filter((el) => {
      const b = el.getBoundingClientRect()
      return b.width > 0 && b.top >= 56 && b.bottom <= innerHeight - 8
    })
  // the next link on screen in reading order (a two-column list reads down its first column first), or a scroll
  const step = (dir) => {
    const links = onScreen()
    const at = links.indexOf(cursor)
    const next = at < 0 ? links[dir > 0 ? 0 : links.length - 1] : links[at + dir]
    if (next) point(next)
    else scrollBy({ top: dir * innerHeight * 0.45, behavior: 'smooth' })
  }
  const section = (dir) => {
    const heads = [...document.querySelectorAll('.doc h2, .label h2')]
    if (!heads.length) return
    const now = heads.findLastIndex((h) => h.getBoundingClientRect().top <= 96)
    const next = heads[Math.max(0, Math.min(heads.length - 1, now + dir))]
    point(null)
    next.scrollIntoView({ behavior: 'smooth' })
  }

  const REPEAT_AFTER = 350
  const REPEAT_EVERY = 120
  const held = new Map()
  /** a press, and the repeats of one held (for up and down) */
  const press = (name, down, fn, t, repeat = false) => {
    const since = held.get(name)
    if (!down) return void held.delete(name)
    if (since === undefined) {
      held.set(name, { at: t, next: t + REPEAT_AFTER })
      fn()
    } else if (repeat && t >= since.next) {
      since.next = t + REPEAT_EVERY
      fn()
    }
  }
  // About's pad board: the standard mapping's index of each button it draws
  const board = document.querySelector('.padboard')
  const rows = board ? [...board.querySelectorAll('li[data-pad]')].map((li) => ({ li, names: li.dataset.pad.split(' ') })) : []
  const INDEX = { A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, SELECT: 8, START: 9, L3: 10, R3: 11 }
  const boardInView = () => {
    if (!board) return false
    const r = board.getBoundingClientRect()
    return r.top < innerHeight * 0.7 && r.bottom > innerHeight * 0.3
  }

  let polling = false
  const tick = (t) => {
    const pad = [...navigator.getGamepads()].find((p) => p && p.connected)
    if (pad) {
      document.body.classList.add('pad')
      const b = (i) => !!pad.buttons[i]?.pressed
      if (rows.length) {
        const stick = Math.hypot(pad.axes[0] ?? 0, pad.axes[1] ?? 0) > 0.5
        const dpad = b(12) || b(13) || b(14) || b(15)
        for (const { li, names } of rows) li.classList.toggle('lit', names.some((n) => (n === 'LSTICK' ? stick : n === 'DPAD' ? dpad : b(INDEX[n]))))
      }
      if (boardInView()) {
        // only the right stick moves on, so every other button can be tried
        const ry = pad.axes[3] ?? 0
        if (Math.abs(ry) > 0.2) scrollBy(0, ry * 18)
        // and a button still down when the board scrolls away does nothing until it is pressed again
        for (const n of ['up', 'down', 'a', 'b', 'lb', 'rb']) held.set(n, { at: t, next: Infinity })
        requestAnimationFrame(tick)
        return
      }
      const ly = pad.axes[1] ?? 0
      press('up', b(12) || ly < -0.6, () => step(-1), t, true)
      press('down', b(13) || ly > 0.6, () => step(1), t, true)
      press('a', b(0), () => cursor?.click(), t)
      press('b', b(1) || b(9), () => go('/'), t)
      press('lb', b(4), () => section(-1), t)
      press('rb', b(5), () => section(1), t)
      const ry = pad.axes[3] ?? 0
      if (Math.abs(ry) > 0.2) scrollBy(0, ry * 18)
    }
    requestAnimationFrame(tick)
  }
  const start = () => {
    if (polling) return
    polling = true
    requestAnimationFrame(tick)
  }
  addEventListener('gamepadconnected', start)
  // a pad already in use before this page opened is there without a new connection
  if ([...navigator.getGamepads?.() ?? []].some(Boolean)) start()
})()
