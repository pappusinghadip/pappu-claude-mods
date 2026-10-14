import type { EngineInterface, Register } from 'claude-code'

import { cacheState, handoffIn, HANDOFF_PROMPT, MIN, pingLeadMs } from './lib'
import { bandPixels, clockTime, duration, textBar, tokens, TONE, TRACK_H, trackSvg } from './ui'

// one session's figures; the band redraws through $.ui.invalidate when they move
const S = {
  now: 0,
  lastAt: 0,
  ttlMin: 60,
  isWorking: false,
  ctx: 0,
  window: 0,
  limits: [] as { kind: string; pct: number }[],
  usd: undefined as number | undefined,
  keepUntil: 0,
  pings: 0,
  warnedFor: 0,
  isPinging: false,
  isHandoffAsked: false,
}

const redraw = ($: EngineInterface) => $.ui.invalidate('ui.render')

async function measure($: EngineInterface) {
  const u = await $.session.usage()
  S.ctx = u.context.tokens ?? S.ctx
  S.window = u.context.window
  S.limits = u.rateLimits.map(r => ({ kind: r.kind === 'five_hour' ? '5h' : r.kind === 'seven_day' ? '7d' : r.kind, pct: r.percentUsed }))
  S.usd = u.cost?.usd
}

// One tick: warn before the cache goes cold, and ping it while keep-warm is on
async function tick($: EngineInterface) {
  S.now = await $.clock.now()
  const st = cacheState(S.lastAt, S.ttlMin, S.now, S.keepUntil)
  if (st.kind === 'cooling' && S.warnedFor !== S.lastAt) {
    S.warnedFor = S.lastAt
    $.ui.toast(`Prompt cache goes cold in ${duration(st.leftMs)}. Send a message, /keepwarm, or hand off.`, { timeoutMs: 12_000 })
  }
  const isDue = S.keepUntil > S.now && st.leftMs > 0 && st.leftMs <= pingLeadMs(S.ttlMin)
  if (isDue && !S.isWorking && !S.isPinging) {
    S.isPinging = true
    // ponytail: a fork rides the chat's cached prefix; it stops itself if the read misses the cache
    const r = await $.model.fork({ prompt: 'Keep-alive ping from cache-meter. Reply with only: ok' })
    S.isPinging = false
    const u = 'usage' in r ? r.usage : undefined
    const isCacheHit = r.isAnswered && u !== undefined && (u.cache_read_input_tokens ?? 0) > (u.cache_creation_input_tokens ?? 0)
    if (isCacheHit) {
      S.pings += 1
      S.lastAt = await $.clock.now()
    } else {
      S.keepUntil = 0
      $.ui.toast('Keep-warm stopped: the ping did not read the cache, so it may already be cold.')
    }
  }
  redraw($)
}

async function clearAndContinue($: EngineInterface) {
  const replies = (await $.session.messages()).filter(m => m.role === 'assistant')
  const handoff = replies.map(m => handoffIn(m.text)).filter(t => t !== null).at(-1)
  if (!handoff) {
    $.ui.toast('No handoff in this chat yet. Press Handoff first.')
    return
  }
  await $.command.run({ command: 'clear' })
  S.lastAt = 0
  S.isHandoffAsked = false
  await $.prompt.submit({ text: `Continue from this handoff:\n\n${handoff}`, asUser: true })
}

async function keepWarm($: EngineInterface, arg: string): Promise<string> {
  S.now = await $.clock.now()
  if (arg === 'off') {
    S.keepUntil = 0
    redraw($)
    return `Keep-warm off after ${S.pings} ping(s).`
  }
  if (cacheState(S.lastAt, S.ttlMin, S.now, 0).kind === 'cold') return 'The cache is already cold; keep-warm only helps while it is warm. Send a message first.'
  const hours = Math.min(24, Number(arg) > 0 ? Number(arg) : 2)
  S.keepUntil = S.now + hours * 60 * MIN
  S.pings = 0
  redraw($)

  return `Keeping the cache warm until ${clockTime(S.keepUntil)} (${hours}h). /keepwarm off stops it.`
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const saved = await $.store.get('ttlMin')
    if (saved === 5 || saved === 60) S.ttlMin = saved
    await $.command.register({ name: 'keepwarm', description: 'Keep the prompt cache warm for N hours (default 2), or /keepwarm off', argumentHint: '[hours|off]' })
    await $.command.register({ name: 'cachemeter', description: 'Cache meter status, or /cachemeter ttl 5|60', argumentHint: '[ttl 5|60]' })
    $.clock.every(20_000, () => tick($))
    S.now = await $.clock.now()
    await measure($)

    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    await measure($)
    redraw($)

    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    S.isWorking = true

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (!e.agentId) {
      S.isWorking = false
      S.lastAt = await $.clock.now()
      S.now = S.lastAt
      redraw($)
    }

    return next(e)
  })

  on('command.run', { command: 'keepwarm' }, async ($, e) => ({ text: await keepWarm($, e.args.trim()) }))

  on('command.run', { command: 'cachemeter' }, async ($, e) => {
    const [key, value] = e.args.trim().split(/\s+/)
    if (key === 'ttl' && (value === '5' || value === '60')) {
      S.ttlMin = Number(value)
      await $.store.set('ttlMin', S.ttlMin)
      redraw($)
      return { text: `Cache window set to ${value} minutes.` }
    }
    S.now = await $.clock.now()
    const st = cacheState(S.lastAt, S.ttlMin, S.now, S.keepUntil)
    const limits = S.limits.map(l => `${l.kind} ${l.pct}%`).join(' · ')

    return {
      text: [
        `Cache: ${st.kind}${st.kind === 'none' ? '' : st.leftMs > 0 ? `, ${duration(st.leftMs)} left` : `, cold for ${duration(-st.leftMs)}`} (window ${S.ttlMin} min).`,
        `Context: ${tokens(S.ctx)}${S.window ? ` of ${tokens(S.window)}` : ''}.${limits ? ` Limits: ${limits}.` : ''}${S.usd === undefined ? '' : ` Session: $${S.usd.toFixed(2)}.`}`,
        'Change the window with /cachemeter ttl 5 or /cachemeter ttl 60.',
      ].join('\n'),
    }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const below = await next(e)
    if (e.props.hasSurvey || (S.lastAt === 0 && S.ctx === 0)) return below
    const el = $.ui.resolve(e)
    const { Box, Text, Button } = el
    const Svg = 'Svg' in el ? el.Svg : undefined
    const now = Math.max(S.now, S.lastAt)
    const st = cacheState(S.lastAt, S.ttlMin, now, S.keepUntil)

    const look = {
      none: { tone: TONE.grey, name: 'grey', frac: 0, words: 'cache –' },
      warm: { tone: TONE.green, name: 'green', frac: st.leftMs / (S.ttlMin * MIN), words: `warm · ${duration(st.leftMs)} left` },
      cooling: { tone: TONE.amber, name: 'yellow', frac: st.leftMs / (S.ttlMin * MIN), words: `cooling · ${duration(st.leftMs)} left` },
      cold: { tone: TONE.red, name: 'red', frac: 0, words: `cold · ${duration(-st.leftMs)}` },
      kept: { tone: TONE.blue, name: 'blue', frac: st.leftMs / (S.ttlMin * MIN), words: `kept warm · ${S.pings} ping${S.pings === 1 ? '' : 's'}` },
    }[st.kind]
    const cacheTip = S.lastAt ? `last reply ${clockTime(S.lastAt)} · expires ${clockTime(S.lastAt + S.ttlMin * MIN)}` : 'no reply yet'
    const fill = S.window ? S.ctx / S.window : 0
    const ctxTone = fill > 0.9 ? TONE.red : fill > 0.7 ? TONE.amber : TONE.teal
    const ctxWords = `${tokens(S.ctx)}${S.window ? ` / ${tokens(S.window)} · ${Math.round(fill * 100)}%` : ''}`
    const ctxTip = `${tokens(S.ctx)} of ${S.window ? tokens(S.window) : '?'} tokens`

    const W = Math.round(bandPixels(e.props.bodyColumns) - 90)
    // desktop: a dotted track whose pill carries the words; hover the pill for the times or counts behind it.
    // terminal: a text bar with the words after it
    const row = (key: string, label: string, frac: number, tone: string, words: string, hoverText: string, color?: string) => {
      const track = Svg ? trackSvg({ width: W, frac, tone, pill: words, hoverText, now }) : null
      return (
        <Box key={key} flexDirection="row" columnGap={2} alignItems="center">
          <Box width={8} flexShrink={0}>
            <Text dimColor>{label}</Text>
          </Box>
          {Svg && track ? (
            <Box key={`${key}-t`}>
              <Svg source={track.base} alt={`${label}: ${words}`} width={W} height={TRACK_H} />
              <Box position="absolute" top={0} left={0}>
                <Svg source={track.hover} alt={`${label}: ${hoverText}`} width={W} height={TRACK_H} isInteractive />
              </Box>
            </Box>
          ) : (
            <Text color={tone}>{textBar(frac, 24)}</Text>
          )}
          {Svg ? null : <Text color={color} dimColor={color === undefined}>{words}</Text>}
        </Box>
      )
    }
    const limits = S.limits.map(l => `${l.kind} ${l.pct}%`).join(' · ')
    const facts = [limits, S.usd === undefined ? '' : `session $${S.usd.toFixed(2)}`].filter(Boolean).join(' · ')

    const mine = (
      <Box flexDirection="column" rowGap={1}>
        {row('cm-cache', 'Cache', look.frac, look.tone, look.words, cacheTip, st.kind === 'warm' || st.kind === 'none' ? undefined : look.name)}
        {row('cm-ctx', 'Context', fill, ctxTone, ctxWords, ctxTip)}
        <Box flexDirection="row" justifyContent="space-between" width="100%" columnGap={2}>
          <Text dimColor wrap="truncate">{facts}</Text>
          <Box flexDirection="row" columnGap={2} flexShrink={0}>
            {st.kind === 'kept' ? (
              <Button key="cm-warm" plain label="stop warm" onPress={() => { S.keepUntil = 0; redraw($) }} />
            ) : st.kind === 'warm' || st.kind === 'cooling' ? (
              <Button key="cm-warm" plain label="keep warm" onPress={() => void keepWarm($, '').then(text => $.ui.toast(text))} />
            ) : null}
            <Button
              key="cm-handoff"
              plain
              hotkey="h"
              label={S.isHandoffAsked ? 'handoff asked' : 'handoff'}
              onPress={() => {
                S.isHandoffAsked = true
                redraw($)
                void $.prompt.submit({ text: HANDOFF_PROMPT })
              }}
            />
            <Button key="cm-continue" plain hotkey="c" label="clear & continue" onPress={() => void clearAndContinue($)} />
          </Box>
        </Box>
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
