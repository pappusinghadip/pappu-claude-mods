import { expect, test } from 'claude-code/testing'

import { isPrivate, mask, maskDeep, targetsOf } from './lib'

test('masks the common secrets', async () => {
  expect(mask('mail me at jo.doe+x@acme.co.uk')).toBe('mail me at ‹email›')
  expect(mask('key sk-ant-api03-abcdefghijklmnop')).toBe('key ‹key›')
  expect(mask('ghp_abcdefghijklmnopqrstuvwxyz0123')).toBe('‹key›')
  expect(mask('price went from $29 to €1,039.50')).toBe('price went from ‹amount› to ‹amount›')
  expect(mask('call +39 333 123 4567')).toBe('call ‹phone›')
  expect(mask('password: hunter2pass')).toBe('password: ‹hidden›')
  expect(mask('server 10.0.0.12')).toBe('server ‹ip›')
})

test('leaves ordinary text alone, strict hides figures', async () => {
  expect(mask('line 42 of 100 in step 3')).toBe('line 42 of 100 in step 3')
  expect(mask('revenue grew 12% to 45,000', true)).toBe('revenue grew ‹%› to ‹n›')
  expect(maskDeep({ stdout: 'a@b.io', code: 0 })).toEqual({ stdout: '‹email›', code: 0 })
})

test('secret files', async () => {
  expect(isPrivate('/app/.env')).toBe(true)
  expect(isPrivate('/app/.env.production')).toBe(true)
  expect(isPrivate('cat ~/.ssh/id_rsa')).toBe(true)
  expect(isPrivate('/app/src/environment.ts')).toBe(false)
  expect(isPrivate('/app/README.md')).toBe(false)
  expect(targetsOf({ file_path: '/x/.env', limit: 3 })).toContain('/x/.env')
})
