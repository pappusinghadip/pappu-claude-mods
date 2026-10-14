// Each chat keeps one small file listing what it edited and when; the others read them before an edit.
export type Ledger = { id: string; cwd: string; title: string; at: number; isEnded: boolean; files: Record<string, number> }
export type Hit = { chat: string; cwd: string; agoMs: number }

// the most recent edit of `file` by another live chat within the window, or null
export function findClash(file: string, mine: string, others: Ledger[], now: number, windowMs: number): Hit | null {
  let best: Hit | null = null
  for (const o of others) {
    if (o.id === mine || o.isEnded) continue
    const at = o.files[file]
    if (at === undefined || now - at > windowMs) continue
    if (!best || now - at < best.agoMs) best = { chat: o.title || o.id.slice(0, 8), cwd: o.cwd, agoMs: now - at }
  }
  return best
}

// entries older than the window drop off, so a ledger stays small
export const prune = (files: Record<string, number>, now: number, windowMs: number) =>
  Object.fromEntries(Object.entries(files).filter(([, at]) => now - at <= windowMs))

export const ago = (ms: number) => (ms < 60_000 ? 'just now' : `${Math.round(ms / 60_000)} min ago`)
