import type { EngineInterface, Register } from 'claude-code'

import { memberCard, CARD_H } from './cards'
import type { Member, Room, Sent } from './lib'
import { briefing, countSent, DEFAULT_LIMIT, feed, findMember, MAX_KEPT, nameOf, parseCommand, roleColor, routeUserMessage, title } from './lib'
import { bandPixels, clockTime, TONE, TRACK_H, trackSvg } from './ui'

const PANE = 'agent-room'
const HELP = [
  'Agent room puts your open Claude Code sessions in one room so they can work together.',
  '',
  'In each session, join with a room name and a role:',
  '  /room join feat planner      (session 1)',
  '  /room join feat coder        (session 2)',
  '  /room join feat reviewer     (session 3)',
  'Then give the planner the task. The pane (/room) shows every message, who is working, and the message limit.',
  '',
  'Also: /room pause, /room resume, /room stop (stops every member), /room limit 20, /room leave.',
].join('\n')

let base = '' // ~/.claude/mods-data/agent-room
let myId = ''
let room = '' // the room this session is in, or ''
let me: Member | null = null
let members: Member[] = []
let state: Room = { limit: DEFAULT_LIMIT, isPaused: false, stopAt: 0 }
let signature = ''
let now = 0
let turnId = ''
let turnStartedAt = 0
let note = '' // a short line under the composer: what just happened

const roomDir = () => `${base}/${room}`
const redraw = ($: EngineInterface) => $.ui.invalidate('ui.render')

async function saveMe($: EngineInterface) {
  if (!me || !room) return
  me = { ...me, sent: me.sent.slice(-MAX_KEPT) }
  await $.fs.write(`${roomDir()}/${myId}.json`, JSON.stringify(me))
}

async function saveRoom($: EngineInterface) {
  if (room) await $.fs.write(`${roomDir()}/room.json`, JSON.stringify(state))
}

async function setStatus($: EngineInterface, status: Member['status'], tool = '') {
  if (!me || (me.status === status && me.tool === tool)) return
  now = await $.clock.now()
  me = { ...me, status, tool, since: me.status === status ? me.since : now }
  await saveMe($)
}

// reads every member's file and the switches; redraws only when something moved
async function load($: EngineInterface) {
  if (!room) return
  now = await $.clock.now()
  const next: Member[] = []
  for (const f of await $.fs.list(roomDir()).catch(() => [])) {
    if (!f.name.endsWith('.json') || f.name === 'room.json') continue
    try {
      next.push(f.name === `${myId}.json` && me ? me : JSON.parse(await $.fs.read(`${roomDir()}/${f.name}`)))
    } catch {
      // a file mid-write is read on the next tick
    }
  }
  try {
    const r = JSON.parse(await $.fs.read(`${roomDir()}/room.json`))
    state = { limit: Number(r.limit) || DEFAULT_LIMIT, isPaused: r.isPaused === true, stopAt: Number(r.stopAt) || 0 }
  } catch {
    // no switches yet: the defaults stand
  }
  members = next.sort((a, b) => a.joinedAt - b.joinedAt)
  // stop-all: a member still in a turn that began before the stop ends it
  if (state.stopAt > turnStartedAt && turnId && me?.status === 'working') {
    const id = turnId
    turnId = ''
    await $.turn.abort({ turnId: id }).catch(() => {})
  }
  const sig = JSON.stringify([members.map(m => [m.id, m.status, m.tool, m.sent.length]), state])
  if (sig !== signature) {
    signature = sig
    redraw($)
  }
}

async function join($: EngineInterface, name: string, role: string): Promise<{ text: string; context?: string[] }> {
  if (room && room !== name) await leave($)
  room = name
  now = await $.clock.now()
  me = { id: myId, name: nameOf(room, role), role, joinedAt: now, status: 'idle', tool: '', since: now, sent: me?.sent ?? [] }
  await saveMe($)
  await $.store.set(`member:${myId}`, { room, role })
  await load($)
  if (!members.some(m => m.id !== myId)) await saveRoom($)
  // the session's name becomes its address: feat-coder
  void $.command.run({ command: 'rename', args: me.name }).catch(() => {})
  void $.ui.open({ id: PANE, title: `Room · ${room}` })

  return { text: `Joined room "${room}" as the ${role}. This session is now ${me.name}. /room opens the room.`, context: [briefing(room, role, members, state.limit)] }
}

async function leave($: EngineInterface) {
  if (!me || !room) return
  await setStatus($, 'left')
  await $.store.delete(`member:${myId}`)
  room = ''
  me = null
  members = []
  redraw($)
}

async function sendFromUser($: EngineInterface, text: string) {
  if (!me || !text.trim()) return
  const { to, body } = routeUserMessage(text, members, myId)
  if (!to.length) {
    note = 'Nobody else is in the room yet.'
    redraw($)
    return
  }
  now = await $.clock.now()
  let delivered = 0
  for (const m of to) {
    const r = await $.session.send({ to: { sessionId: m.id }, text: `Message from the user, typed in the agent-room pane:\n${body}` })
    if (r.isDelivered) {
      delivered += 1
      me = { ...me, sent: [...me.sent, { to: m.name, text: body, at: now, isUser: true }] }
    }
  }
  note = delivered === to.length ? `Sent to ${to.map(m => title(m.role)).join(', ')}.` : `Delivered to ${delivered} of ${to.length}.`
  await saveMe($)
  await load($)
  redraw($)
}

async function setRoom($: EngineInterface, change: Partial<Room>, words: string) {
  await load($)
  state = { ...state, ...change }
  await saveRoom($)
  note = words
  signature = ''
  await load($)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const home = (await $.env.get('HOME')) ?? (await $.env.get('USERPROFILE')) ?? '.'
    base = `${home.replace(/\\/g, '/')}/.claude/mods-data/agent-room`
    myId = await $.session.id()
    await $.command.register({ name: 'room', description: 'Agent room: /room join <room> <role>, /room, /room pause|resume|stop|leave, /room limit N', argumentHint: '[join <room> <role>|pause|resume|stop|limit N|leave]' })
    // after a reload, or a resumed session, come back to the room this session was in
    const saved = (await $.store.get(`member:${myId}`)) as { room?: string; role?: string } | undefined
    if (saved?.room && saved.role) {
      room = saved.room
      now = await $.clock.now()
      try {
        me = { ...JSON.parse(await $.fs.read(`${roomDir()}/${myId}.json`)), status: 'idle', since: now }
      } catch {
        me = { id: myId, name: nameOf(room, saved.role), role: saved.role, joinedAt: now, status: 'idle', tool: '', since: now, sent: [] }
      }
      await saveMe($)
    }
    $.clock.every(2000, () => load($))

    return next(e)
  })

  on('session.end', async ($, e, next) => {
    await setStatus($, 'left').catch(() => {})

    return next(e)
  })

  on('command.run', { command: 'room' }, async ($, e) => {
    const c = parseCommand(e.args)
    if (c.kind === 'join') return join($, c.room, c.role)
    if (c.kind === 'help') return { text: HELP }
    if (c.kind === 'open') {
      if (!room) return { text: HELP }
      await load($)
      await $.ui.open({ id: PANE, title: `Room · ${room}` })
      return { text: `Room "${room}" opened.` }
    }
    if (!room) return { text: `Not in a room yet.\n\n${HELP}` }
    if (c.kind === 'leave') {
      const was = room
      await leave($)
      return { text: `Left room "${was}".` }
    }
    if (c.kind === 'limit') {
      await setRoom($, { limit: c.value }, `Limit set to ${c.value}.`)
      return { text: `Room limit set to ${c.value} messages.` }
    }
    if (c.kind === 'pause' || c.kind === 'resume') {
      await setRoom($, { isPaused: c.kind === 'pause' }, c.kind === 'pause' ? 'Paused.' : 'Resumed.')
      return { text: c.kind === 'pause' ? 'Room paused: messages between members are held back.' : 'Room resumed.' }
    }
    now = await $.clock.now()
    await setRoom($, { isPaused: true, stopAt: now }, 'Stopped every member.')
    return { text: 'Stopping every member and pausing the room. /room resume to carry on.' }
  })

  on('turn.start', async ($, e, next) => {
    turnId = e.turnId
    turnStartedAt = await $.clock.now()
    await setStatus($, 'working', me?.tool ?? '')

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (!e.agentId) {
      turnId = ''
      await setStatus($, 'idle')
    }

    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    if (me && !e.agentId) await setStatus($, 'working', String(e.tool))

    return next(e)
  })

  // messages to room members: held while paused, refused past the limit, logged when delivered
  on('session.send', async ($, e, next) => {
    if (!room || !me || e.origin.kind !== 'model') return next(e)
    await load($)
    const target = findMember(e.to, members)
    if (!target) return next(e)
    if (state.isPaused) return { isDelivered: false, reason: 'The agent room is paused by the user. Wait for the user before messaging teammates.' }
    if (countSent(members) >= state.limit) {
      return { isDelivered: false, reason: `The agent room reached its limit of ${state.limit} messages. Stop messaging teammates and report to the user.` }
    }
    const sent = await next(e)
    if (sent.isDelivered) {
      now = await $.clock.now()
      const line: Sent = { to: target.name, text: e.text, at: now }
      me = { ...me, sent: [...me.sent, line] }
      await saveMe($)
      signature = ''
      await load($)
    }

    return sent
  })

  // while paused, teammates' messages are dropped on arrival; the person's own ones from the pane still land
  on('session.receive', async ($, e, next) => {
    const isFromTeammate = e.origin.kind === 'peer' && !('plugin' in e.origin && e.origin.plugin === 'agent-room')
    if (room && state.isPaused && isFromTeammate) return { consumed: 'agent-room is paused' }

    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const el = $.ui.resolve(e)
    const { Box, Text, Button } = el
    const Svg = 'Svg' in el ? el.Svg : undefined
    const Input = 'Input' in el ? el.Input : undefined
    const Markdown = 'Markdown' in el ? el.Markdown : undefined
    const W = Math.max(280, bandPixels(e.props.bodyColumns) - 24)

    if (!room || !me) {
      return (
        <Box flexDirection="column" rowGap={1}>
          <Text bold>◈ Agent room</Text>
          <Text dimColor>{HELP}</Text>
          {Input ? (
            <Input
              key="room-join"
              label="Join a room"
              placeholder="room role, e.g. feat coder"
              submitLabel="Join"
              onSubmit={value => {
                const c = parseCommand(`join ${value}`)
                if (c.kind === 'join') void join($, c.room, c.role).then(r => $.ui.toast(r.text))
                else $.ui.toast('Type a room name and a role, e.g. feat coder')
              }}
            />
          ) : null}
        </Box>
      )
    }

    const used = countSent(members)
    const isFull = used >= state.limit
    const tone = state.isPaused ? TONE.amber : isFull ? TONE.red : TONE.violet
    const word = state.isPaused ? 'paused' : isFull ? 'limit reached' : 'live'
    const meter = trackSvg({ width: W, frac: used / state.limit, tone, pill: `${used} / ${state.limit} messages`, hoverText: `${state.limit - Math.min(used, state.limit)} left · /room limit N`, now })
    const working = members.filter(m => m.status === 'working').length
    const lines = feed(members)
    const rows = e.viewport?.rows ?? 30
    const room4feed = Math.max(3, Math.floor((rows - 10 - members.length * 2) / 4))
    const shown = lines.slice(-room4feed)

    return (
      <Box flexDirection="column" rowGap={1}>
        <Box flexDirection="row" justifyContent="space-between" width="100%">
          <Text bold>{`◈ ${room}`}</Text>
          <Text color={state.isPaused ? 'yellow' : isFull ? 'red' : 'green'}>{`● ${word} · ${members.filter(m => m.status !== 'left').length} in room · ${working} working`}</Text>
        </Box>
        {Svg ? (
          <Box key="room-meter">
            <Svg source={meter.base} alt={`${used} of ${state.limit} messages used`} width={W} height={TRACK_H} />
            <Box position="absolute" top={0} left={0}>
              <Svg source={meter.hover} alt="Messages left" width={W} height={TRACK_H} isInteractive />
            </Box>
          </Box>
        ) : (
          <Text dimColor>{`${used} / ${state.limit} messages`}</Text>
        )}

        <Box flexDirection="column" rowGap={0}>
          {members.map(m =>
            Svg ? (
              <Svg key={`card-${m.id}`} source={memberCard(m, m.id === myId, W, now)} alt={`${m.name}, ${m.role}, ${m.status}`} width={W} height={CARD_H} />
            ) : (
              <Text key={`card-${m.id}`} dimColor={m.status === 'left'}>{`● ${title(m.role)} · ${m.name} · ${m.status}${m.tool ? ` (${m.tool})` : ''}`}</Text>
            ),
          )}
        </Box>

        <Box flexDirection="column" rowGap={1}>
          {shown.length === 0 ? <Text dimColor>No messages yet. Give the planner a task and they will start talking here.</Text> : null}
          {lines.length > shown.length ? <Text dimColor>{`… ${lines.length - shown.length} earlier message${lines.length - shown.length === 1 ? '' : 's'}`}</Text> : null}
          {shown.map((l, i) => {
            const body = l.text.length > 700 ? `${l.text.slice(0, 700)}…` : l.text
            return (
              <Box key={`msg-${l.at}-${i}`} flexDirection="column">
                <Box flexDirection="row" columnGap={1}>
                  <Text bold color={l.isUser ? undefined : roleColor(l.from.role)}>{l.isUser ? 'You' : title(l.from.role)}</Text>
                  <Text dimColor>{`→ ${l.to ? title(l.to.role) : l.toName}`}</Text>
                  <Box flexGrow={1} />
                  <Text dimColor>{clockTime(l.at)}</Text>
                </Box>
                {Markdown ? <Markdown text={body} /> : <Text wrap="wrap">{body}</Text>}
              </Box>
            )
          })}
        </Box>

        {Input ? (
          <Input key="room-say" placeholder="Message everyone, or @coder … for one" submitLabel="Send" onSubmit={value => void sendFromUser($, value)} />
        ) : null}
        <Box flexDirection="row" columnGap={2}>
          <Button
            key="room-pause"
            hotkey="p"
            variant={state.isPaused ? 'primary' : undefined}
            label={state.isPaused ? 'Resume' : 'Pause'}
            onPress={() => void setRoom($, { isPaused: !state.isPaused }, state.isPaused ? 'Resumed.' : 'Paused.')}
          />
          <Button key="room-stop" hotkey="s" label="Stop all" onPress={() => void $.clock.now().then(t => setRoom($, { isPaused: true, stopAt: t }, 'Stopped every member.'))} />
          <Button key="room-more" hotkey="m" label="+5 messages" onPress={() => void setRoom($, { limit: state.limit + 5 }, `Limit raised to ${state.limit + 5}.`)} />
          <Button key="room-leave" hotkey="x" label="Leave" onPress={() => void leave($)} />
          {note ? <Text dimColor>{note}</Text> : null}
        </Box>
      </Box>
    )
  })

  // a one-line reminder above the prompt while this session is in a room
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const below = await next(e)
    if (!room || !me || e.props.hasSurvey) return below
    const { Box, Text, Button } = $.ui.resolve(e)
    const used = countSent(members)
    const working = members.filter(m => m.status === 'working' && m.id !== myId).length
    const mine = (
      <Box flexDirection="row" columnGap={2} alignItems="center">
        <Text bold color={roleColor(me.role)}>{`◈ ${room} · ${title(me.role)}`}</Text>
        <Text dimColor>{`${used}/${state.limit} messages${working ? ` · ${working} teammate${working === 1 ? '' : 's'} working` : ''}${state.isPaused ? ' · paused' : ''}`}</Text>
        <Button key="room-open" plain hotkey="r" label="open room" onPress={() => void $.ui.open({ id: PANE, title: `Room · ${room}` })} />
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
