/** Tiny DOM helpers. */

export type Child = Node | string | number | null | undefined | false | Child[]

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, unknown> | null = null,
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag)
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === null || v === false) continue
      if (k === 'class') el.className = String(v)
      else if (k === 'style' && typeof v === 'object') {
        // custom properties (`--i`) are not style fields: assigning them makes a plain expando the CSS never sees
        for (const [prop, val] of Object.entries(v as Record<string, string>)) {
          if (prop.startsWith('--')) el.style.setProperty(prop, val)
          else (el.style as unknown as Record<string, string>)[prop] = val
        }
      }
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v as EventListener)
      else if (k === 'html') el.innerHTML = String(v)
      else if (k === 'dataset' && typeof v === 'object') Object.assign(el.dataset, v as Record<string, string>)
      else el.setAttribute(k, String(v))
    }
  }
  append(el, children)
  return el
}

function append(el: Node, children: Child[]) {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue
    if (Array.isArray(c)) append(el, c)
    else if (c instanceof Node) el.appendChild(c)
    else el.appendChild(document.createTextNode(String(c)))
  }
}

export function clear(el: Element) {
  while (el.firstChild) el.removeChild(el.firstChild)
}

export function replace(el: Element, ...children: Child[]) {
  clear(el)
  append(el, children)
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/**
 * Calls `cb` whenever the window's device pixel ratio changes: dragged to a
 * screen of another density, or zoomed. A canvas drawn for the old ratio is
 * left for the browser to scale until it is drawn again, and that reads as
 * the art itself changing. Returns the unsubscribe.
 */
export function onDprChange(cb: () => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => {}
  let mq: MediaQueryList | null = null
  const arm = () => {
    mq = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`)
    mq.addEventListener('change', fire, { once: true })
  }
  const fire = () => {
    arm()
    cb()
  }
  arm()
  return () => mq?.removeEventListener('change', fire)
}

/**
 * Nudges `el` (by its `translate`) so its top-left corner lands on a whole
 * device pixel. The grid's cells are a measured font advance wide, so what
 * stands on them sits between pixels, and Chrome draws a canvas there one
 * way while compositing it as a layer of its own and another once it folds
 * it back into the page — the same tiles changing under the player as it
 * goes quiet or busy. On whole pixels both ways agree.
 */
export function snapToPixels(el: HTMLElement) {
  el.style.translate = ''
  if (!el.isConnected || el.offsetParent === null) return
  const r = el.getBoundingClientRect()
  const dpr = window.devicePixelRatio || 1
  const dx = Math.round(r.left * dpr) / dpr - r.left
  const dy = Math.round(r.top * dpr) / dpr - r.top
  if (Math.abs(dx) > 0.001 || Math.abs(dy) > 0.001) el.style.translate = `${dx.toFixed(3)}px ${dy.toFixed(3)}px`
}
