import { expect, test } from 'claude-code/testing'

import type { Task } from './lib'
import { eta, fromTodos, modelLabel, progress } from './lib'

const t = (status: Task['status'], doneAt = 0): Task => ({ id: String(Math.random()), title: 'x', status, startedAt: 0, doneAt })

test('progress and eta', async () => {
  const goal = { text: 'g', startedAt: 0, endedAt: 0 }
  expect(progress([t('completed'), t('pending')])).toEqual({ done: 1, total: 2, pct: 50 })
  expect(eta([t('completed', 60_000), t('pending')], goal)).toBe(null)
  // two done in 4 minutes: 2 min each, two left
  expect(eta([t('completed', 60_000), t('completed', 240_000), t('pending'), t('in_progress')], goal)).toBe(240_000)
})

test('todo rewrites keep their times', async () => {
  const first = fromTodos([{ content: 'a', status: 'in_progress' }], [], 1000)
  const second = fromTodos([{ content: 'a', status: 'completed' }, { content: 'b', status: 'pending' }], first, 5000)
  expect(second[0]).toEqual({ id: 'todo-0', title: 'a', status: 'completed', startedAt: 1000, doneAt: 5000 })
  expect(second[1]?.startedAt).toBe(0)
})

test('model label', async () => {
  expect(modelLabel('claude-haiku-4-5-20251001')).toBe('Haiku 4.5')
  expect(modelLabel('sonnet')).toBe('sonnet')
})
