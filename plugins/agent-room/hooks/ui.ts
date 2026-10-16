// Shared drawing helpers. A plugin may only import its own files, so scripts/sync.sh copies this file into
// every plugin that uses it. Edit it here, then run the script.

export const TONE = {
  green: '#2E9E6B',
  amber: '#C98A1B',
  red: '#D14B4B',
  blue: '#5B7CF0',
  teal: '#2F8FAD',
  violet: '#7C5CE0',
  grey: '#7A7883',
} as const

export const TRACK_H = 22
export const STRIP_H = 18

const FONT = "ui-sans-serif,system-ui,-apple-system,'Segoe UI',sans-serif"
const WHITE = '#FFFFFF'

const escape = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c)

// rough text width in px, enough to size pills and bubbles
export const textPx = (s: string, size = 12) =>
  [...s].reduce((w, ch) => w + (/[iljtf.,:;'|!\s]/.test(ch) ? 0.3 : /[mwMW@]/.test(ch) ? 0.85 : 0.56) * size, 0)

// Desktop draws about 8 CSS px per column of the band
export const bandPixels = (columns?: number) => Math.max(320, (columns ?? 100) * 8)

// a stable 0..1 number per (a, b): the dots must sit still between redraws
function noise(a: number, b: number): number {
  let h = Math.imul(a, 374761393) + Math.imul(b, 668265263)
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

const rgbOf = (hex: string) => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16))
const blend = (a: string, b: string, t: number) => {
  const y = rgbOf(b)
  return `rgb(${rgbOf(a).map((v, i) => Math.round(v + ((y[i] ?? 0) - v) * t)).join(',')})`
}

// ---------- a clock that ticks by itself ----------
// Each digit is a column of figures behind a one-line window, rolled by a CSS animation whose negative delay is the
// time already gone, so the picture never needs redrawing to count. Up to 99m 59s; past that it shows hours, fixed.

const ROW = 15
const DIGIT_W = 7.2

const CLOCK_CSS =
  '.reel{animation-timing-function:steps(var(--n));animation-iteration-count:infinite;animation-name:roll}' +
  '@keyframes roll{to{transform:translateY(calc(var(--n) * -15px))}}' +
  '@media (prefers-reduced-motion:reduce){.reel{animation:none}}'

export const CLOCK_W = 4 * DIGIT_W + 2 * 9 + 4

function reel(x: number, baseY: number, count: number, periodS: number, goneS: number, cls: string, clip: string, isZeroBlank = false): string {
  const figure = (i: number) => (isZeroBlank && i % count === 0 ? ' ' : String(i % count))
  const figures = Array.from({ length: count + 1 }, (_, i) => `<tspan x="${x.toFixed(1)}" y="${baseY + i * ROW}">${figure(i)}</tspan>`).join('')
  return (
    `<g clip-path="url(#${clip})"><g class="reel" style="--n:${count};animation-duration:${periodS}s;animation-delay:-${goneS.toFixed(1)}s">` +
    `<text class="${cls}" text-anchor="middle">${figures}</text></g></g>`
  )
}

// a clock centred on cx showing the time since `since`, as of `now`
export function clockSvg(cx: number, top: number, since: number, now: number, cls: string): string {
  const gone = Math.max(0, (now - since) / 1000)
  const baseY = top + 11.5
  if (gone >= 100 * 60) {
    const h = Math.floor(gone / 3600)
    const m = Math.floor(gone / 60) % 60
    return `<text x="${cx}" y="${baseY}" class="${cls}" text-anchor="middle">${h}h ${String(m).padStart(2, '0')}m</text>`
  }
  const left = cx - CLOCK_W / 2
  const clip = `clk${Math.round(cx)}x${Math.round(top)}`
  const x = (i: number, units: number) => left + DIGIT_W / 2 + i * DIGIT_W + units * 9 + (units ? 4 : 0)
  return (
    `<clipPath id="${clip}"><rect x="${left - 2}" y="${top}" width="${CLOCK_W + 4}" height="${ROW}"/></clipPath>` +
    reel(x(0, 0), baseY, 10, 6000, gone, cls, clip, true) +
    reel(x(1, 0), baseY, 10, 600, gone, cls, clip) +
    `<text x="${left + 2 * DIGIT_W}" y="${baseY}" class="${cls}">m</text>` +
    reel(x(2, 1), baseY, 6, 60, gone, cls, clip) +
    reel(x(3, 1), baseY, 10, 10, gone, cls, clip) +
    `<text x="${left + 4 * DIGIT_W + 13}" y="${baseY}" class="${cls}">s</text>`
  )
}

// ---------- the track ----------

export type Tip = { at: number; text: string }
export type TrackSpec = {
  width: number
  frac: number
  tone: string
  pill: string
  marks?: number[] // 0..1, a small dot on the track at each
  tips?: Tip[] // hover bubbles at those points
  clockSince?: number // pill hover: a live clock from this moment
  hoverText?: string // pill hover: this text instead
  now: number
}

// Returns a plain picture (`base`) and a see-through layer to lay on top of it (`hover`, drawn interactive) that
// holds the hover bubbles and the pill's hover face.
export function trackSvg(t: TrackSpec): { base: string; hover: string; hasHover: boolean } {
  const W = Math.max(80, Math.round(t.width))
  const H = TRACK_H
  const f = Math.max(0, Math.min(1, t.frac))
  const head = f * W

  // dots on a 3px grid, sparse at the tail and packed near the head, warming from grey to the tone
  const byClass = new Map<string, string>()
  for (let x = 0; x < head; x += 3) {
    const u = (x + 1.5) / Math.max(1, head)
    const density = 0.18 + 0.8 * Math.pow(u, 1.7)
    for (let r = 0; r < 7; r++) {
      if (noise(x, r) > density) continue
      const cls = `w${Math.min(3, Math.floor(u * 4))} k${Math.floor(noise(r, x) * 3)}`
      byClass.set(cls, `${byClass.get(cls) ?? ''}M${x} ${1 + r * 3}h2v2h-2z`)
    }
  }
  const dots = [...byClass].map(([cls, d]) => `<path class="${cls}" d="${d}"/>`).join('')
  const warm = [0, 1, 2, 3].map(i => `.w${i}{fill:${blend('#86848C', t.tone, 0.25 + i * 0.25)};fill-opacity:${(0.45 + i * 0.17).toFixed(2)}}`).join('')

  const marks = (t.marks ?? [])
    .filter(m => m > 0 && m < 1)
    .map(m => {
      const x = m * W
      const isPassed = x < head
      return `<circle cx="${x.toFixed(1)}" cy="${H / 2}" r="1.7" fill="${isPassed ? '#FFFFFF' : '#A9A7B0'}" fill-opacity="${isPassed ? 0.85 : 0.55}"/>`
    })
    .join('')

  // the pill rides at the head of the fill, kept inside the track
  const label = t.pill.length > 48 ? `${t.pill.slice(0, 47)}…` : t.pill
  const hoverW = t.clockSince ? CLOCK_W : t.hoverText ? textPx(t.hoverText) : 0
  const pw = Math.min(W, Math.round(Math.max(textPx(label), hoverW) + 24))
  const px = Math.max(pw / 2, Math.min(W - pw / 2, head))
  const pill = (inner: string) =>
    `<g transform="translate(${px.toFixed(1)} 0)"><rect x="${-pw / 2}" width="${pw}" height="${H}" rx="${H / 2}" fill="${t.tone}"/>${inner}</g>`

  const open = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`
  const base =
    `${open}<style>${warm}.k0{animation:glint 2.4s ease-in-out infinite}.k1{animation:glint 3.1s ease-in-out -1s infinite}` +
    '@keyframes glint{50%{opacity:.4}}@media (prefers-reduced-motion:reduce){.k0,.k1{animation:none}}' +
    `.pt{font:600 12px ${FONT};fill:${WHITE}}</style>` +
    `<defs><clipPath id="cap"><rect width="${W}" height="${H}" rx="${H / 2}"/></clipPath>` +
    `<linearGradient id="glow" x1="0" x2="1"><stop offset="0" stop-color="${t.tone}" stop-opacity=".04"/><stop offset="1" stop-color="${t.tone}" stop-opacity=".3"/></linearGradient></defs>` +
    `<g clip-path="url(#cap)"><rect width="${W}" height="${H}" fill="#8A8890" fill-opacity=".16"/>` +
    `<rect width="${head.toFixed(1)}" height="${H}" fill="url(#glow)"/>${dots}${marks}</g>` +
    pill(`<text y="${H / 2 + 4.2}" text-anchor="middle" class="pt">${escape(label)}</text>`) +
    '</svg>'

  const tips = (t.tips ?? [])
    .map(tip => {
      const x = Math.max(0, Math.min(1, tip.at)) * W
      const bw = textPx(tip.text, 11) + 18
      const bx = Math.max(0, Math.min(W - bw, x - bw / 2))
      return (
        `<g class="tip"><rect x="${(x - 6).toFixed(1)}" width="12" height="${H}" fill="#000" fill-opacity="0"/>` +
        `<g class="bubble"><rect x="${bx.toFixed(1)}" y="2" width="${bw.toFixed(1)}" height="${H - 4}" rx="${(H - 4) / 2}" fill="#1E1D1C" fill-opacity=".95"/>` +
        `<text x="${(bx + 9).toFixed(1)}" y="${H / 2 + 3.8}" class="bt">${escape(tip.text)}</text></g></g>`
      )
    })
    .join('')
  const face = t.clockSince
    ? clockSvg(0, 3.5, t.clockSince, t.now, 'pt')
    : t.hoverText
      ? `<text y="${H / 2 + 4.2}" text-anchor="middle" class="pt">${escape(t.hoverText)}</text>`
      : ''
  const pillHover = face
    ? `<g class="ph"><rect x="${(px - pw / 2).toFixed(1)}" width="${pw}" height="${H}" fill="#000" fill-opacity="0"/><g class="face">${pill(face)}</g></g>`
    : ''
  const hover =
    `${open}<style>:root,html,body{background:transparent!important;margin:0;overflow:hidden;color-scheme:light dark}svg{display:block}` +
    `.bubble,.face{opacity:0;transition:opacity .15s;pointer-events:none}.tip:hover .bubble,.ph:hover .face{opacity:1}.tip,.ph{cursor:default}` +
    `.bt{font:400 11px ${FONT};fill:#F1EFF6}.pt{font:600 12px ${FONT};fill:${WHITE};font-variant-numeric:tabular-nums}${CLOCK_CSS}</style>` +
    `${tips}${pillHover}</svg>`

  return { base, hover, hasHover: tips !== '' || face !== '' }
}

// ---------- agent strips ----------

export type AgentRow = { label: string; title: string; model: string; state: 'running' | 'done' | 'failed'; tool: string; startedAt: number; endedAt: number }

const STATE_TONE = { running: TONE.violet, done: TONE.green, failed: TONE.red } as const
const GUTTER = 34

// a little robot head: face, two eyes, an antenna
const ROBOT = (y: number) =>
  `<g transform="translate(2 ${y + 3})" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round">` +
  '<rect x=".6" y="3.6" width="10.8" height="7.8" rx="2"/><path d="M6 3.6V1.2"/><circle cx="6" cy=".9" r=".6" fill="currentColor"/>' +
  '<path d="M3.8 7.2v1.2M8.2 7.2v1.2"/></g>'

const STRIP_CSS =
  `.sn{font:400 11.5px ${FONT};fill:#EEEDF2}.sd{fill:#A3A1AA}.gut{color:#A3A1AA}.gut .sn{fill:currentColor;font-weight:600}.pg{fill:#232220}` +
  '@media (prefers-color-scheme:light){.sn{fill:#232227}.sd{fill:#5E5D63}.gut{color:#5E5D63}.pg{fill:#FFFFFF}}' +
  '.beat{animation:beat 1.2s ease-in-out infinite}@keyframes beat{50%{opacity:.3}}' +
  `@media (prefers-reduced-motion:reduce){.beat{animation:none}}${CLOCK_CSS}`

// one tinted row per subagent: number, name and model, what it is doing, and how long
export function stripSvg(a: AgentRow, width: number, now: number): string {
  const W = Math.max(160, Math.round(width))
  const H = STRIP_H
  const tone = STATE_TONE[a.state]
  const timeX = W - 10
  const time =
    a.state === 'running'
      ? clockSvg(timeX - CLOCK_W / 2, 2, a.startedAt, now, 'sn sd')
      : `<text x="${timeX}" y="${H / 2 + 4}" text-anchor="end" class="sn sd">${escape(shortDuration(a.endedAt - a.startedAt))}</text>`
  const toolX = timeX - CLOCK_W - 12
  const word = a.state === 'running' ? a.tool : ''
  const room = toolX - (word ? textPx(word, 11.5) + 14 : 0) - (GUTTER + 22)
  let name = a.title
  while (name.length > 4 && textPx(name, 11.5) + textPx(` ${a.model}`, 11.5) > room) name = name.slice(0, -1)
  if (name !== a.title) name = `${name.trimEnd()}…`

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><style>${STRIP_CSS}</style>` +
    `<g class="gut">${ROBOT(0)}<text x="17" y="${H / 2 + 4}" class="sn">${escape(a.label)}</text></g>` +
    `<rect class="pg" x="${GUTTER}" width="${W - GUTTER}" height="${H}" rx="${H / 2}"/>` +
    `<rect x="${GUTTER}" width="${W - GUTTER}" height="${H}" rx="${H / 2}" fill="${tone}" fill-opacity=".17"/>` +
    `<circle cx="${GUTTER + 11}" cy="${H / 2}" r="3" fill="${tone}"${a.state === 'running' ? ' class="beat"' : ''}/>` +
    `<text x="${GUTTER + 21}" y="${H / 2 + 4}" class="sn">${escape(name)}${a.model ? `<tspan class="sd"> ${escape(a.model)}</tspan>` : ''}</text>` +
    (word ? `<text x="${toolX}" y="${H / 2 + 4}" text-anchor="end" class="sn" style="fill:${tone}">${escape(word)}</text>` : '') +
    time +
    '</svg>'
  )
}

// the row that stands for the agents that did not fit
export function moreStripSvg(hidden: number, done: number, width: number): string {
  const W = Math.max(160, Math.round(width))
  const H = STRIP_H
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><style>${STRIP_CSS}</style>` +
    `<g class="gut">${ROBOT(0)}<text x="17" y="${H / 2 + 4}" class="sn">+${hidden}</text></g>` +
    `<rect class="pg" x="${GUTTER}" width="${W - GUTTER}" height="${H}" rx="${H / 2}"/>` +
    `<rect x="${GUTTER}" width="${W - GUTTER}" height="${H}" rx="${H / 2}" fill="#8A8890" fill-opacity=".15"/>` +
    `<text x="${GUTTER + 11}" y="${H / 2 + 4}" class="sn sd">${hidden} more agent${hidden === 1 ? '' : 's'} · ${done} done</text></svg>`
  )
}

// ---------- terminal fallbacks and words ----------

export function textBar(frac: number, cells: number): string {
  const lit = Math.round(Math.max(0, Math.min(1, frac)) * cells)
  return '▰'.repeat(lit) + '▱'.repeat(cells - lit)
}

export function shortDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`
  return `${Math.floor(s / 3600)}h ${String(Math.floor(s / 60) % 60).padStart(2, '0')}m`
}

export function duration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m`
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`
}

export const tokens = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : String(n))

export const clockTime = (ms: number) => {
  const d = new Date(ms)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}
