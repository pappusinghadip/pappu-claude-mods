export type CacheKind = 'none' | 'warm' | 'cooling' | 'cold' | 'kept'

export const MIN = 60_000
export const COOLING_MS = 5 * MIN

// Where the prompt cache stands, from the last request that touched it
export function cacheState(lastAt: number, ttlMin: number, now: number, keepUntil: number): { kind: CacheKind; leftMs: number } {
  if (lastAt === 0) return { kind: 'none', leftMs: 0 }
  const leftMs = lastAt + ttlMin * MIN - now
  if (keepUntil > now && leftMs > 0) return { kind: 'kept', leftMs }
  if (leftMs <= 0) return { kind: 'cold', leftMs }
  return { kind: leftMs <= COOLING_MS ? 'cooling' : 'warm', leftMs }
}

// A keep-warm ping goes out this long before the cache would expire
export const pingLeadMs = (ttlMin: number) => (ttlMin >= 60 ? 6 * MIN : 75_000)

export const HANDOFF_MARK = '## Handoff'

export const HANDOFF_PROMPT =
  `Write a handoff so a fresh chat can continue this work without the history. Start with the line "${HANDOFF_MARK}", then cover: ` +
  'the goal, what is done (with file paths), decisions and why, what is still open, the exact next step, and how to verify it. ' +
  'Be complete but tight. Do not run any tools.'

// The text after the last handoff heading in a reply, or null
export function handoffIn(text: string): string | null {
  const at = text.lastIndexOf(HANDOFF_MARK)
  return at < 0 ? null : text.slice(at).trim()
}
