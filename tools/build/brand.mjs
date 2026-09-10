#!/usr/bin/env node
/**
 * The brand, built from the Orb of Zot's tile (apps/orbrun/public/orb.png,
 * cut from the pinned gamedata's main.png) and the title screen's face
 * (assets/fonts/GrenzeGotisch-Bold.ttf, OFL; see ATTRIBUTION.md):
 *
 *   assets/logo.svg                    the README's wordmark: the orb beside the name, as the title screen sets it
 *   apps/orbrun/public/favicon.svg     the orb on a dark rounded square
 *   apps/orbrun/public/deck/art/*.png  Steam artwork: icon (the orb), logo, hero, grid, portrait (the wordmark)
 *
 *   node tools/build/brand.mjs
 *
 * Needs rsvg-convert and magick on the PATH (brew install librsvg imagemagick);
 * the name is written as outlines, so no renderer needs the font installed.
 * An ordinary build never runs this; it ships what this wrote.
 */
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import opentype from 'opentype.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const pub = path.join(root, 'apps/orbrun/public')
const art = path.join(pub, 'deck/art')
const tmp = fs.mkdtempSync(path.join(process.env.TMPDIR || '/tmp', 'orbrun-brand-'))
const run = (cmd, args) => execFileSync(cmd, args, { stdio: ['ignore', 'pipe', 'inherit'] })

// the tile, scaled up without smoothing once, so every renderer keeps its pixels
const orbBig = path.join(tmp, 'orb.png')
run('magick', [path.join(pub, 'orb.png'), '-filter', 'point', '-resize', '1600%', orbBig])
const ORB = `data:image/png;base64,${fs.readFileSync(orbBig).toString('base64')}`

const BG = '#0a0912'

/** the orb's glow: gold and violet, the colours the tile is made of */
const GLOW = `
  <defs>
    <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur stdDeviation="2.5" result="b"/>
      <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
    <filter id="inkshadow" x="-10%" y="-30%" width="120%" height="160%">
      <feDropShadow dx="0" dy="2" stdDeviation="8" flood-color="#000" flood-opacity="0.9"/>
    </filter>
    <filter id="orbglow" x="-60%" y="-60%" width="220%" height="220%">
      <feDropShadow dx="0" dy="0" stdDeviation="4" flood-color="#b9781f" flood-opacity="0.75"/>
      <feDropShadow dx="0" dy="0" stdDeviation="9" flood-color="#8b3fb0" flood-opacity="0.5"/>
    </filter>
  </defs>`

/** the orb drawn in a square: x, y, size */
const orb = (x, y, s, glow = true) => `<image x="${x}" y="${y}" width="${s}" height="${s}" href="${ORB}"${glow ? ' filter="url(#orbglow)"' : ''}/>`

// ---------------------------------------------------------------- the wordmark
// the title screen's lockup: the orb, then the name in Grenze Gotisch Bold, the orb's bright core as tall as the O
// (the same numbers as .frame.home-list .brand .head .place and its ::before in apps/orbrun/src/styles.css)
const INK = '#e9e2d0'
const FONT = path.join(root, 'assets/fonts/GrenzeGotisch-Bold.ttf')
const ORB_EM = 0.71, ORB_DROP = 0.055, ORB_GAP = 0.16
const W = 576, H = 168, PAD = 36

/** the name as outlines, glyph by glyph with the font's kerning (opentype.js can't shape this font's GSUB, and we need no ligatures) */
function outline(text, size) {
  const buf = fs.readFileSync(FONT)
  const font = opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength))
  const k = size / font.unitsPerEm
  let x = 0, d = '', prev = null
  for (const ch of text) {
    const g = font.charToGlyph(ch)
    if (prev) x += font.getKerningValue(prev, g) * k
    d += g.getPath(x, 0, size).toPathData(2)
    x += g.advanceWidth * k
    prev = g
  }
  return { d, width: x, cap: font.tables.os2.sCapHeight * k }
}

function wordmark({ background = true, rounded = true } = {}) {
  // the size that fills the width between the pads: orb, gap and name are all in ems of it
  const probe = outline('Orbrun', 100)
  const size = Math.floor((W - 2 * PAD) / (ORB_EM + ORB_GAP + probe.width / 100))
  const { d, cap } = outline('Orbrun', size)
  const orbSize = ORB_EM * size
  const baseline = Math.round(H / 2 + cap / 2)
  const x0 = Math.round((W - (ORB_EM + ORB_GAP) * size - (probe.width / 100) * size) / 2)
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Orbrun">${GLOW}
  ${background ? `<rect width="${W}" height="${H}" rx="${rounded ? 12 : 0}" fill="${BG}"/>` : ''}
  ${orb(x0, baseline + ORB_DROP * size - orbSize, orbSize)}
  <path transform="translate(${x0 + (ORB_EM + ORB_GAP) * size} ${baseline})" fill="${INK}" filter="url(#inkshadow)" d="${d}"/>
</svg>
`
}

// ---------------------------------------------------------------- the mark
/** the orb alone on a dark rounded square of `size` */
const mark = (size) => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 64 64" role="img" aria-label="Orbrun">${GLOW}
  <rect width="64" height="64" rx="10" fill="${BG}"/>
  ${orb(8, 8, 48)}
</svg>
`

// ---------------------------------------------------------------- write
const svg = (name, s) => {
  const p = path.join(tmp, name)
  fs.writeFileSync(p, s)
  return p
}
/** render an svg at a width, then centre it on a canvas of the deck's size */
function deck(out, src, width, canvasW, canvasH) {
  const png = path.join(tmp, path.basename(out))
  run('rsvg-convert', ['-w', String(width), '-o', png, src])
  if (canvasW) run('magick', ['-size', `${canvasW}x${canvasH}`, `xc:${BG}`, png, '-gravity', 'center', '-composite', out])
  else fs.copyFileSync(png, out)
  return out
}

fs.writeFileSync(path.join(root, 'assets/logo.svg'), wordmark())
fs.writeFileSync(path.join(pub, 'favicon.svg'), mark(64))

const word = svg('word.svg', wordmark({ background: false }))
const wordRounded = svg('word-rounded.svg', wordmark())
const icon = svg('icon.svg', mark(512))
fs.mkdirSync(art, { recursive: true })
deck(path.join(art, 'icon.png'), icon, 512)
deck(path.join(art, 'logo.png'), wordRounded, 1152)
deck(path.join(art, 'hero.png'), word, 1152, 1920, 620)
deck(path.join(art, 'grid.png'), word, 864, 920, 430)
deck(path.join(art, 'portrait.png'), word, 540, 600, 900)
for (const f of ['assets/logo.svg', 'apps/orbrun/public/favicon.svg', ...fs.readdirSync(art).map((f) => `apps/orbrun/public/deck/art/${f}`)]) console.log(`${f}  ${fs.statSync(path.join(root, f)).size} bytes`)
fs.rmSync(tmp, { recursive: true, force: true })
