import type { EngineInterface, Register } from 'claude-code'

import type { Ledger } from './lib'
import { ago, findClash, prune } from './lib'

const MIN = 60_000

let dir = ''
let me: Ledger = { id: '', cwd: '', title: '', at: 0, isEnded: false, files: {} }
let windowMin = 30
let isOn = true
let asked = 0

const ownPath = () => `${dir}/${me.id}.json`

async function save($: EngineInterface) {
  me.at = await $.clock.now()
  await $.fs.write(ownPath(), JSON.stringify(me))
}

async function others($: EngineInterface, now: number): Promise<Ledger[]> {
  const out: Ledger[] = []
  for (const f of await $.fs.list(dir).catch(() => [])) {
    if (!f.name.endsWith('.json') || f.name === `${me.id}.json`) continue
    // ponytail: a chat whose file went quiet past the window cannot clash, so it is skipped unread
    if (now - f.mtimeMs > windowMin * MIN) continue
    try {
      out.push(JSON.parse(await $.fs.read(`${dir}/${f.name}`)))
    } catch {
      // a file mid-write is read next time
    }
  }

  return out
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const home = (await $.env.get('HOME')) ?? (await $.env.get('USERPROFILE')) ?? '.'
    dir = `${home.replace(/\\/g, '/')}/.claude/mods-data/edit-guard`
    const cwd = await $.session.cwd()
    me = { id: await $.session.id(), cwd, title: cwd.split(/[\\/]/).pop() ?? 'chat', at: 0, isEnded: false, files: {} }
    const saved = await $.store.get('settings')
    if (saved && typeof saved === 'object') {
      const s = saved as { windowMin?: number; isOn?: boolean }
      windowMin = s.windowMin ?? windowMin
      isOn = s.isOn ?? isOn
    }
    await $.command.register({ name: 'editguard', description: 'Edit guard: status, /editguard on|off, /editguard window <minutes>', argumentHint: '[on|off|window N]' })

    return next(e)
  })

  on('session.end', async ($, e, next) => {
    if (me.id) {
      me.isEnded = true
      me.files = {}
      await save($).catch(() => {})
    }

    return next(e)
  })

  on('command.run', { command: 'editguard' }, async ($, e) => {
    const [key, value] = e.args.trim().toLowerCase().split(/\s+/)
    if (key === 'on' || key === 'off') isOn = key === 'on'
    else if (key === 'window' && Number(value) > 0) windowMin = Math.min(24 * 60, Math.round(Number(value)))
    await $.store.set('settings', { windowMin, isOn })
    const now = await $.clock.now()
    const live = (await others($, now)).filter(o => !o.isEnded && Object.values(o.files).some(at => now - at <= windowMin * MIN))
    const lines = live.map(o => `- ${o.title}: ${Object.keys(prune(o.files, now, windowMin * MIN)).length} file(s) edited`)

    return {
      text: [
        `Edit guard is ${isOn ? 'on' : 'off'}; it looks back ${windowMin} minutes. Asked ${asked} time(s) in this chat.`,
        live.length ? `Other chats editing now:\n${lines.join('\n')}` : 'No other chat has edited files recently.',
      ].join('\n'),
    }
  })

  on('tool.call', { tool: ['Edit', 'Write', 'NotebookEdit'] }, async ($, e, next) => {
    const file = 'notebook_path' in e ? e.notebook_path : e.file_path
    if (!isOn || !me.id || !file) return next(e)

    const now = await $.clock.now()
    const hit = findClash(file, me.id, await others($, now), now, windowMin * MIN)
    if (hit) {
      asked += 1
      const name = file.split(/[\\/]/).pop()
      const answer = await $.ui.ask(`The chat "${hit.chat}" edited ${name} ${ago(hit.agoMs)}. Edit it here too?`, {
        header: 'Edit guard',
        options: ['Go ahead', 'Use a worktree', 'Skip this edit'],
      })
      if (answer === 'Use a worktree') {
        return { deny: `edit-guard: another chat is working on ${file}. The user wants this chat in its own worktree: call EnterWorktree, then make the edit there.` }
      }
      if (answer !== 'Go ahead') {
        const why = answer === 'Skip this edit' ? 'The user skipped this edit.' : `The user says: ${answer}`
        return { deny: `edit-guard: another chat edited ${file} ${ago(hit.agoMs)}. ${why}` }
      }
    }

    const ran = await next(e)
    if (ran.deny === undefined && ran.isError !== true) {
      me.files = { ...prune(me.files, now, windowMin * MIN), [file]: now }
      await save($)
    }

    return ran
  })
}
