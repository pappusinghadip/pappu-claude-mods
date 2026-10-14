import { describe, expect, test } from 'claude-code/testing'

import { cacheState, handoffIn, HANDOFF_MARK, MIN, pingLeadMs } from './lib'

describe('cacheState', () => {
  test('walks warm, cooling, cold', async () => {
    expect(cacheState(0, 60, 1, 0).kind).toBe('none')
    expect(cacheState(1000, 60, 1000 + 10 * MIN, 0)).toEqual({ kind: 'warm', leftMs: 50 * MIN })
    expect(cacheState(1000, 60, 1000 + 57 * MIN, 0).kind).toBe('cooling')
    expect(cacheState(1000, 5, 1000 + 6 * MIN, 0).kind).toBe('cold')
  })
  test('kept only while still warm', async () => {
    expect(cacheState(1000, 60, 1000 + 10 * MIN, 1000 + 99 * MIN).kind).toBe('kept')
    expect(cacheState(1000, 60, 1000 + 61 * MIN, 1000 + 99 * MIN).kind).toBe('cold')
  })
})

test('ping lead and handoff parsing', async () => {
  expect(pingLeadMs(60)).toBe(6 * MIN)
  expect(handoffIn('blah')).toBe(null)
  expect(handoffIn(`intro\n${HANDOFF_MARK}\n- next: run tests`)).toBe(`${HANDOFF_MARK}\n- next: run tests`)
})
