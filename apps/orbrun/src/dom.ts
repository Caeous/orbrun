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
