import type { EngineInterface, Register } from 'claude-code'

import type { Agent, Goal, Task } from './lib'
import { eta, fromTodos, modelLabel, progress } from './lib'
import type { Tip } from './ui'
import { bandPixels, duration, moreStripSvg, STRIP_H, stripSvg, textBar, TONE, TRACK_H, trackSvg } from './ui'

const MAX_AGENT_ROWS = 3
const DONE_STAYS_MS = 10 * 60_000

let goal: Goal | null = null
let tasks: Task[] = []
const agents = new Map<string, Agent>()
let now = 0
let isHidden = false

const redraw = ($: EngineInterface) => $.ui.invalidate('ui.render')
const isOk = (r: { deny?: string; isError?: boolean }) => r.deny === undefined && r.isError !== true

async function start($: EngineInterface, text: string) {
  now = await $.clock.now()
  goal = { text: text.slice(0, 200), startedAt: now, endedAt: 0 }
  tasks = []
  agents.clear()
  isHidden = false
  redraw($)
}

async function finish($: EngineInterface) {
  if (!goal || goal.endedAt) return
  now = await $.clock.now()
  goal = { ...goal, endedAt: now }
  const p = progress(tasks)
  $.ui.toast(`Goal finished in ${duration(now - goal.startedAt)}${p.total ? ` · ${p.done}/${p.total} tasks` : ''}`)
  redraw($)
}

function setStatus(id: string, status: Task['status'] | 'deleted') {
  if (status === 'deleted') {
    tasks = tasks.filter(t => t.id !== id)
    return
  }
  tasks = tasks.map(t =>
    t.id !== id ? t : { ...t, status, startedAt: t.startedAt || (status !== 'pending' ? now : 0), doneAt: status === 'completed' ? t.doneAt || now : 0 },
  )
}

// a hover bubble on each mark between tasks, telling the task that ends there and how long it took
function tipsOf(list: Task[]): Tip[] {
  return list.slice(0, -1).map((t, i) => {
    const took = t.doneAt && t.startedAt ? ` · ${duration(t.doneAt - t.startedAt)}` : t.status === 'in_progress' ? ' · working' : ''
    return { at: (i + 1) / list.length, text: `${t.title}${took}` }
  })
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'goal-tracker', description: 'Hide or show the goal bar, or clear it: /goal-tracker hide|show|clear', argumentHint: '[hide|show|clear]' })
    $.clock.every(15_000, async () => {
      now = await $.clock.now()
      if (goal && (!goal.endedAt || now - goal.endedAt < DONE_STAYS_MS)) redraw($)
    })

    return next(e)
  })

  // the built-in /goal command starts or clears the goal
  on('command.run', { command: 'goal' }, async ($, e, next) => {
    const args = e.args.trim()
    if (args === 'clear') await finish($)
    else if (args) await start($, args)

    return next(e)
  })

  on('command.run', { command: 'goal-tracker' }, async ($, e) => {
    const arg = e.args.trim()
    if (arg === 'clear') {
      goal = null
      tasks = []
    } else isHidden = arg === 'hide'
    redraw($)

    return { text: arg === 'clear' ? 'Goal bar cleared.' : isHidden ? 'Goal bar hidden. /goal-tracker show brings it back.' : 'Goal bar shown.' }
  })

  on('tool.call', async ($, e, next) => {
    // a subagent's current tool shows on its row
    const agent = e.agentId ? agents.get(e.agentId) : undefined
    if (agent && agent.state === 'running') {
      agents.set(agent.id, { ...agent, tool: String(e.tool) })
      redraw($)
    }
    if (e.agentId) return next(e)

    const ran = await next(e)
    if (!isOk(ran)) return ran
    now = await $.clock.now()
    if (e.tool === 'ProposeGoal') await start($, e.condition)
    else if (e.tool === 'TaskCreate' && goal) {
      const task = (ran.result as { task?: { id: string; subject: string } } | undefined)?.task
      if (!task) return ran
      tasks = [...tasks, { id: task.id, title: task.subject, status: 'pending', startedAt: 0, doneAt: 0 }]
    } else if (e.tool === 'TaskUpdate' && e.status) setStatus(e.taskId, e.status)
    else if (e.tool === 'TodoWrite' && goal) tasks = fromTodos(e.todos, tasks, now)
    else return ran
    redraw($)

    return ran
  })

  on('agent.spawn', async ($, e, next) => {
    const started = await next(e)
    if (goal && !goal.endedAt && started.agentId) {
      now = await $.clock.now()
      agents.set(started.agentId, { id: started.agentId, title: e.description || e.subagentType || 'agent', model: started.model ?? '', state: 'running', tool: 'starting', startedAt: now, endedAt: 0 })
      redraw($)
    }

    return started
  })

  on('turn.complete', async ($, e, next) => {
    now = await $.clock.now()
    const agent = e.agentId ? agents.get(e.agentId) : undefined
    if (agent) {
      agents.set(agent.id, { ...agent, state: e.reason === 'answer' ? 'done' : 'failed', tool: '', endedAt: now })
      redraw($)
    }
    // the main turn ended with every task done: the goal is met
    const p = progress(tasks)
    if (!e.agentId && goal && !goal.endedAt && p.total > 0 && p.done === p.total) await finish($)

    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const below = await next(e)
    if (!goal || isHidden || e.props.hasSurvey) return below
    if (goal.endedAt && now - goal.endedAt > DONE_STAYS_MS) return below
    const el = $.ui.resolve(e)
    const { Box, Text } = el
    const Svg = 'Svg' in el ? el.Svg : undefined
    const p = progress(tasks)
    const isDone = goal.endedAt > 0
    const tone = isDone ? TONE.green : TONE.violet
    const left = isDone ? null : eta(tasks, goal)
    const stats = [
      p.total ? `${p.done}/${p.total} · ${p.pct}%` : 'planning',
      `${duration((goal.endedAt || now) - goal.startedAt)}${isDone ? ' total' : ''}`,
      left === null ? '' : `~${duration(left)} left`,
    ].filter(Boolean)
    const W = bandPixels(e.props.bodyColumns) - 16
    const active = tasks.find(t => t.status === 'in_progress')
    const pill = isDone ? `✓ ${duration(goal.endedAt - goal.startedAt)}` : active ? active.title : p.total ? `${p.pct}%` : 'planning'
    const track = Svg
      ? trackSvg({
          width: W,
          frac: isDone ? 1 : p.total ? p.done / p.total : 0,
          tone,
          pill,
          marks: tasks.slice(1).map((_, i) => (i + 1) / tasks.length),
          tips: tipsOf(tasks),
          clockSince: isDone ? undefined : goal.startedAt,
          now,
        })
      : null
    const bar =
      Svg && track ? (
        <Box key="gt-track">
          <Svg source={track.base} alt={`Goal ${p.pct}%: ${pill}`} width={W} height={TRACK_H} />
          <Box position="absolute" top={0} left={0}>
            <Svg source={track.hover} alt="Goal tasks: hover for times" width={W} height={TRACK_H} isInteractive />
          </Box>
        </Box>
      ) : (
        <Text key="gt-bar" color={isDone ? 'green' : 'magenta'}>{textBar(p.total ? p.done / p.total : 0, 30)}</Text>
      )

    const list = [...agents.values()].sort((a, b) => Number(b.state === 'running') - Number(a.state === 'running') || b.startedAt - a.startedAt)
    const shown = list.slice(0, MAX_AGENT_ROWS)
    const rest = list.slice(MAX_AGENT_ROWS)
    const order = [...agents.values()]
    const dot = { running: 'magenta', done: 'green', failed: 'red' } as const

    const mine = (
      <Box flexDirection="column" rowGap={0}>
        <Box flexDirection="row" justifyContent="space-between" width="100%" columnGap={2}>
          <Text bold wrap="truncate">{`${isDone ? '✓' : '◆'} ${goal.text}`}</Text>
          <Text color={isDone ? 'green' : undefined} dimColor={!isDone}>{stats.join(' · ')}</Text>
        </Box>
        {bar}
        {Svg
          ? shown.map(a => (
              <Svg
                key={`gt-agent-${a.id}`}
                source={stripSvg({ label: String(order.indexOf(a) + 1), title: a.title, model: modelLabel(a.model), state: a.state, tool: a.tool, startedAt: a.startedAt, endedAt: a.endedAt }, W, now)}
                alt={`${a.title}: ${a.state}${a.state === 'running' ? `, ${a.tool}` : ''}`}
                width={W}
                height={STRIP_H}
              />
            ))
          : shown.map(a => (
              <Box key={`gt-agent-${a.id}`} flexDirection="row" columnGap={1}>
                <Text color={dot[a.state]}>{a.state === 'running' ? '●' : a.state === 'done' ? '✓' : '✕'}</Text>
                <Text wrap="truncate">{a.title}</Text>
                {a.model ? <Text dimColor>{modelLabel(a.model)}</Text> : null}
                <Box flexGrow={1} />
                {a.state === 'running' ? <Text color="magenta">{a.tool}</Text> : null}
                <Text dimColor>{duration((a.endedAt || now) - a.startedAt)}</Text>
              </Box>
            ))}
        {rest.length ? (
          Svg ? (
            <Svg key="gt-more" source={moreStripSvg(rest.length, rest.filter(a => a.state === 'done').length, W)} alt={`${rest.length} more agents`} width={W} height={STRIP_H} />
          ) : (
            <Text dimColor>{`  +${rest.length} more agent${rest.length === 1 ? '' : 's'} · ${rest.filter(a => a.state === 'done').length} done`}</Text>
          )
        ) : null}
      </Box>
    )

    return below ? (
      <Box flexDirection="column">
        {mine}
        {below}
      </Box>
    ) : (
      mine
    )
  })
}
