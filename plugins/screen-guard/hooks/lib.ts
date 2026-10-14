// What screen-guard hides. Best effort: regexes catch the common shapes, not every secret.

const RULES: [RegExp, string][] = [
  [/\b[\w.+-]+@[\w-]+(?:\.[\w-]+)+\b/g, '‹email›'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, '‹private key›'],
  [/\b(?:sk|pk|rk)-[A-Za-z0-9_-]{16,}/g, '‹key›'],
  [/\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}|\bgithub_pat_[A-Za-z0-9_]{20,}/g, '‹key›'],
  [/\bxox[abposr]-[A-Za-z0-9-]{10,}/g, '‹key›'],
  [/\bAKIA[0-9A-Z]{16}\b|\bAIza[0-9A-Za-z_-]{35}\b/g, '‹key›'],
  [/\beyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]{8,}/g, '‹token›'],
  [/\b(Bearer|token|apikey|api_key|password|passwd|secret)(\s*[:=]\s*|\s+)["']?[^\s"']{6,}/gi, '$1$2‹hidden›'],
  [/\b[A-Fa-f0-9]{32,}\b/g, '‹hash›'],
  [/[$€£¥₹]\s?\d[\d,.]*(?:\s?[kKmM])?|\b\d[\d,.]*\s?(?:USD|EUR|GBP|INR|dollars|euros|rupees)\b/g, '‹amount›'],
  [/(?<![\w.])\+?\d[\d\s().-]{8,}\d(?![\w.])/g, '‹phone›'],
  [/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, '‹ip›'],
]

// strict: also every number of 4+ digits and every percentage
const STRICT: [RegExp, string][] = [
  [/\b\d+(?:[.,]\d+)?\s?%/g, '‹%›'],
  [/\b\d[\d,.]{3,}\b/g, '‹n›'],
]

export function mask(text: string, isStrict = false): string {
  const rules = isStrict ? [...RULES, ...STRICT] : RULES
  return rules.reduce((t, [re, to]) => t.replace(re, to), text)
}

// masks every string inside a JSON-like value
export function maskDeep(value: unknown, isStrict = false): unknown {
  if (typeof value === 'string') return mask(value, isStrict)
  if (Array.isArray(value)) return value.map(v => maskDeep(v, isStrict))
  if (value !== null && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, maskDeep(v, isStrict)]))
  return value
}

// files that stay closed while recording: env files, keys, credentials
const PRIVATE = /(^|[\/\\\s"'=])(\.env(\.[\w.-]+)?|[\w.-]*\.(pem|key|p12|pfx|keystore|jks)|id_(rsa|ed25519|ecdsa|dsa)|\.npmrc|\.pypirc|\.netrc|credentials(\.json)?|secrets?(\.\w+)?|\.aws[\/\\]|\.ssh[\/\\]|\.kube[\/\\]config)(?=$|[\/\\\s"'])/i

export const isPrivate = (target: string) => PRIVATE.test(target)

// every path or command a tool call names
export function targetsOf(input: unknown): string {
  if (input === null || typeof input !== 'object') return ''
  const o = input as Record<string, unknown>
  return ['file_path', 'notebook_path', 'path', 'command', 'pattern', 'glob']
    .map(k => (typeof o[k] === 'string' ? (o[k] as string) : ''))
    .join('\n')
}
