// The room's own drawings: one card per member, and the message meter's colours.
import type { Member } from './lib'
import { roleColor, title } from './lib'
import { CLOCK_W, clockSvg, shortDuration } from './ui'

export const CARD_H = 30

const FONT = "ui-sans-serif,system-ui,-apple-system,'Segoe UI',sans-serif"
const escape = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c)

const CSS =
  `.nm{font:600 12.5px ${FONT};fill:#EEEDF2}.dm{font:400 11.5px ${FONT};fill:#A3A1AA}.av{font:700 12px ${FONT};fill:#FFFFFF}` +
  `.chip{font:600 10px ${FONT};letter-spacing:.4px}.card{fill:#262523;stroke:#3A3936}` +
  '@media (prefers-color-scheme:light){.nm{fill:#232227}.dm{fill:#5E5D63}.card{fill:#F6F5F2;stroke:#E2E0DA}}' +
  '.beat{animation:beat 1.2s ease-in-out infinite}@keyframes beat{50%{opacity:.25}}' +
  '.reel{animation-timing-function:steps(var(--n));animation-iteration-count:infinite;animation-name:roll}' +
  '@keyframes roll{to{transform:translateY(calc(var(--n) * -15px))}}' +
  '@media (prefers-reduced-motion:reduce){.beat,.reel{animation:none}}'

// avatar with the role's initial, the session name and a role chip, then what it is doing and for how long
export function memberCard(m: Member, isMe: boolean, width: number, now: number): string {
  const W = Math.max(220, Math.round(width))
  const H = CARD_H
  const tone = roleColor(m.role)
  const isLeft = m.status === 'left'
  const role = title(m.role)
  const chipW = role.length * 6.4 + 14
  const nameX = 40
  const name = `${m.name}${isMe ? ' (you)' : ''}`
  const chipX = nameX + name.length * 7 + 8
  const right = W - 12
  let status: string
  if (m.status === 'working') {
    const word = m.tool || 'thinking'
    status =
      `<circle cx="${right - CLOCK_W - 12 - word.length * 6.6 - 10}" cy="${H / 2}" r="3.5" fill="${tone}" class="beat"/>` +
      `<text x="${right - CLOCK_W - 12}" y="${H / 2 + 4}" text-anchor="end" class="dm" style="fill:${tone}">${escape(word)}</text>` +
      clockSvg(right - CLOCK_W / 2, H / 2 - 7.5, m.since, now, 'dm')
  } else {
    const word = isLeft ? 'left' : `idle · ${shortDuration(now - m.since)}`
    status = `<text x="${right}" y="${H / 2 + 4}" text-anchor="end" class="dm">${escape(word)}</text>`
  }
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><style>${CSS}</style>` +
    `<g opacity="${isLeft ? 0.45 : 1}">` +
    `<rect class="card" x=".5" y=".5" width="${W - 1}" height="${H - 1}" rx="10"/>` +
    `<rect x="1" y="1" width="3" height="${H - 2}" rx="1.5" fill="${tone}"/>` +
    `<circle cx="22" cy="${H / 2}" r="10" fill="${tone}"/><text x="22" y="${H / 2 + 4.2}" text-anchor="middle" class="av">${escape(role.charAt(0))}</text>` +
    `<text x="${nameX}" y="${H / 2 + 4.3}" class="nm">${escape(name)}</text>` +
    `<rect x="${chipX}" y="${H / 2 - 8}" width="${chipW}" height="16" rx="8" fill="${tone}" fill-opacity=".18"/>` +
    `<text x="${chipX + chipW / 2}" y="${H / 2 + 3.6}" text-anchor="middle" class="chip" style="fill:${tone}">${escape(role.toUpperCase())}</text>` +
    `${status}</g></svg>`
  )
}
