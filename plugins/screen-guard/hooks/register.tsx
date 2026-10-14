import type { EngineInterface, Register } from 'claude-code'

import { isPrivate, mask, maskDeep, targetsOf } from './lib'
import { TONE } from './ui'

type Flag = { isOn: boolean; isStrict: boolean; since: number }

// the switch lives in one file, so /rec in any chat turns every open chat on or off
let flag: Flag = { isOn: false, isStrict: false, since: 0 }
let flagPath = ''
let blocked = 0

const FILE_TOOLS = new Set(['Read', 'Edit', 'Write', 'NotebookEdit', 'Grep', 'Glob', 'Bash'])

async function readFlag($: EngineInterface): Promise<Flag> {
  try {
    const f = JSON.parse(await $.fs.read(flagPath))
    return { isOn: f.isOn === true, isStrict: f.isStrict === true, since: Number(f.since) || 0 }
  } catch {
    return { isOn: false, isStrict: false, since: 0 }
  }
}

async function syncFlag($: EngineInterface) {
  const f = await readFlag($)
  if (f.isOn === flag.isOn && f.isStrict === flag.isStrict) return
  flag = f
  $.ui.invalidate('ui.render')
}

const chipSvg = (isStrict: boolean) => {
  const label = isStrict ? 'REC · STRICT' : 'REC'
  const w = Math.round(34 + label.length * 7.4)
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="20" viewBox="0 0 ${w} 20">` +
    `<rect x=".5" y=".5" width="${w - 1}" height="19" rx="6" fill="${TONE.red}" fill-opacity=".12" stroke="${TONE.red}" stroke-opacity=".7"/>` +
    `<circle cx="13" cy="10" r="4" fill="${TONE.red}"><animate attributeName="r" values="4;2.6;4" dur="1.4s" repeatCount="indefinite"/></circle>` +
    `<text x="24" y="14" font-family="ui-sans-serif,system-ui,-apple-system,'Segoe UI',sans-serif" font-size="11.5" font-weight="700" letter-spacing="1" fill="${TONE.red}">${label}</text></svg>`
  return { svg, w }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const home = (await $.env.get('HOME')) ?? (await $.env.get('USERPROFILE')) ?? '.'
    flagPath = `${home.replace(/\\/g, '/')}/.claude/mods-data/screen-guard.json`
    flag = await readFlag($)
    await $.command.register({ name: 'rec', description: 'Screen guard: mask secrets on screen while recording (/rec, /rec strict, /rec off)', argumentHint: '[strict|off]', immediate: true })
    $.clock.every(3000, () => syncFlag($))

    return next(e)
  })

  on('command.run', { command: 'rec' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    const isOn = arg !== 'off'
    flag = { isOn, isStrict: isOn && arg === 'strict', since: isOn ? await $.clock.now() : 0 }
    await $.fs.write(flagPath, JSON.stringify(flag))
    blocked = 0
    $.ui.invalidate('ui.render')

    return {
      text: isOn
        ? `Screen guard on${flag.isStrict ? ' (strict)' : ''} in every open chat: emails, keys, tokens, money and phone numbers are masked on screen, and secret files stay closed. /rec off when you are done.`
        : 'Screen guard off.',
    }
  })

  // secret files stay closed while recording, so their contents never reach the screen
  on('tool.call', async ($, e, next) => {
    if (!flag.isOn || !FILE_TOOLS.has(String(e.tool))) return next(e)
    if (!isPrivate(targetsOf(e))) return next(e)
    blocked += 1

    return { deny: 'Screen guard is on (the user is recording), so secret files such as .env, keys and credentials stay closed. Continue without them, or ask the user to run /rec off first.' }
  })

  // the rows people read: prompts, replies and command output
  on('ui.render', { component: 'UserMessage' }, async ($, e, next) => (flag.isOn ? next({ ...e, props: { ...e.props, text: mask(e.props.text, flag.isStrict) } }) : next(e)))
  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => (flag.isOn ? next({ ...e, props: { ...e.props, text: mask(e.props.text, flag.isStrict) } }) : next(e)))
  on('ui.render', { component: 'CommandOutput' }, async ($, e, next) => (flag.isOn ? next({ ...e, props: { ...e.props, text: mask(e.props.text, flag.isStrict) } }) : next(e)))

  on('ui.render', { component: 'ToolUse' }, async ($, e, next) =>
    flag.isOn
      ? next({ ...e, props: { ...e.props, input: maskDeep(e.props.input, flag.isStrict), ...(e.props.output === undefined ? {} : { output: maskDeep(e.props.output, flag.isStrict) }) } })
      : next(e),
  )

  on('ui.render', { component: 'ToolResult' }, async ($, e, next) =>
    flag.isOn ? next({ ...e, props: { ...e.props, output: maskDeep(e.props.output, flag.isStrict) } }) : next(e),
  )

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const below = await next(e)
    if (!flag.isOn || e.props.hasSurvey) return below
    const el = $.ui.resolve(e)
    const { Box, Text } = el
    const c = chipSvg(flag.isStrict)
    const chip =
      'Svg' in el ? (
        <el.Svg key="sg-chip" source={c.svg} alt="Screen guard is on" width={c.w} height={20} />
      ) : (
        <Text key="sg-chip" color="red" bold>{flag.isStrict ? '● REC · STRICT' : '● REC'}</Text>
      )
    const mine = (
      <Box flexDirection="row" columnGap={2} alignItems="center">
        {chip}
        <Text dimColor>{blocked > 0 ? `masking on · ${blocked} secret file${blocked === 1 ? '' : 's'} kept closed` : 'masking on'}</Text>
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

  on('ui.render', { component: 'SessionMode' }, async ($, e, next) => {
    if (!flag.isOn) return next(e)
    const modes = Array.isArray(e.props.modes) ? e.props.modes : []

    return next({ ...e, props: { ...e.props, modes: ['● REC', ...modes] } })
  })
}
