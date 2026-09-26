// The site's pages with a pad in hand, and in a window of Orbrun's own (../site-pages.ts inlines this).
//
// Up and down (d-pad or left stick) move the gold cursor to the next link on
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
  const ground = () => bar.classList.toggle('solid', !hero || hero.getBoundingClientRect().bottom <= bar.offsetHeight)
  addEventListener('scroll', ground, { passive: true })
  addEventListener('resize', ground, { passive: true })
  ground()

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
    [...document.querySelectorAll('main a[href], header a[href], footer a[href]')].filter((el) => {
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
    const heads = [...document.querySelectorAll('.doc h2')]
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
  let polling = false
  const tick = (t) => {
    const pad = [...navigator.getGamepads()].find((p) => p && p.connected)
    if (pad) {
      document.body.classList.add('pad')
      const b = (i) => !!pad.buttons[i]?.pressed
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
