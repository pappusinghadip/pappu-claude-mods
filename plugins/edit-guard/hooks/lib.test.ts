import { expect, test } from 'claude-code/testing'

import type { Ledger } from './lib'
import { ago, findClash, prune } from './lib'

const MIN = 60_000
const chat = (id: string, files: Record<string, number>, isEnded = false): Ledger => ({ id, cwd: '/p', title: id, at: 0, isEnded, files })

test('finds the newest clash from another live chat', async () => {
  const now = 100 * MIN
  const others = [chat('me', { '/a.ts': now }), chat('old', { '/a.ts': now - 40 * MIN }), chat('b', { '/a.ts': now - 5 * MIN }), chat('c', { '/a.ts': now - 2 * MIN }, true)]
  expect(findClash('/a.ts', 'me', others, now, 30 * MIN)).toEqual({ chat: 'b', cwd: '/p', agoMs: 5 * MIN })
  expect(findClash('/other.ts', 'me', others, now, 30 * MIN)).toBe(null)
})

test('prune and ago', async () => {
  expect(prune({ a: 0, b: 50 * MIN }, 60 * MIN, 30 * MIN)).toEqual({ b: 50 * MIN })
  expect(ago(20_000)).toBe('just now')
  expect(ago(12 * MIN)).toBe('12 min ago')
})
