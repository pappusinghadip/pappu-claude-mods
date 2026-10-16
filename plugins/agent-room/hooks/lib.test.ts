import { expect, test } from 'claude-code/testing'

import type { Member } from './lib'
import { briefing, countSent, feed, findMember, parseCommand, roleColor, routeUserMessage, slug } from './lib'

const m = (id: string, role: string, sent: Member['sent'] = [], status: Member['status'] = 'idle'): Member => ({ id, name: `feat-${role}`, role, joinedAt: 0, status, tool: '', since: 0, sent })

test('commands', async () => {
  expect(parseCommand('join Feat X Coder')).toEqual({ kind: 'join', room: 'feat', role: 'x' })
  expect(parseCommand('join payments-api reviewer')).toEqual({ kind: 'join', room: 'payments-api', role: 'reviewer' })
  expect(parseCommand('')).toEqual({ kind: 'open' })
  expect(parseCommand('limit 20')).toEqual({ kind: 'limit', value: 20 })
  expect(parseCommand('join onlyroom')).toEqual({ kind: 'help' })
  expect(slug('My Room!!')).toBe('my-room')
})

test('feed merges every member log in time order and resolves targets', async () => {
  const planner = m('p1', 'planner', [{ to: 'feat-coder', text: 'build it', at: 10 }])
  const coder = m('c1', 'coder', [{ to: 'reviewer', text: 'done, review?', at: 30 }])
  const reviewer = m('r1', 'reviewer', [{ to: 'c1', text: 'one fix', at: 20 }, { to: 'feat-coder', text: 'from the user', at: 40, isUser: true }])
  const lines = feed([planner, coder, reviewer])
  expect(lines.map(l => `${l.from.role}>${l.to?.role}`)).toEqual(['planner>coder', 'reviewer>coder', 'coder>reviewer', 'reviewer>coder'])
  expect(countSent([planner, coder, reviewer])).toBe(3)
  expect(findMember('@FEAT-CODER', [coder])?.id).toBe('c1')
})

test('user messages: @role goes to one, the rest to everyone else', async () => {
  const all = [m('p1', 'planner'), m('c1', 'coder'), m('r1', 'reviewer', [], 'left')]
  expect(routeUserMessage('@coder add tests', all, 'p1')).toEqual({ to: [all[1]], body: 'add tests' })
  expect(routeUserMessage('status please', all, 'p1').to.map(x => x.id)).toEqual(['c1'])
})

test('briefing and colours', async () => {
  const text = briefing('feat', 'coder', [m('p1', 'planner'), m('c1', 'coder')], 12)
  expect(text).toContain('feat-planner (planner)')
  expect(text).toContain('12 messages')
  expect(roleColor('planner')).toBe('#7C5CE0')
  expect(roleColor('designer')).toBe(roleColor('designer'))
})
