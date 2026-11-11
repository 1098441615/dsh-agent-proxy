/**
 * dsh-agent-proxy — a settings-page switch that makes the commands DSH runs
 * (git clone, npm install, pip install …) go through a local HTTP proxy.
 *
 * Two layers are applied while the switch is on:
 *
 *   1. Tool configuration files — the only layer a shell that was already
 *      running can see. DSH can keep a long-lived shell session, and that
 *      process's environment never changes, so the environment alone cannot
 *      reach it:
 *        - git: `http.proxy` / `https.proxy` (global config, original value kept)
 *        - npm: `proxy` / `https-proxy` in the user .npmrc
 *        - pip: `proxy` in pip.ini / pip.conf
 *      Every original value is recorded in `$DSH_HOME/agent-proxy.json` and
 *      restored on switch-off.
 *   2. The child environment, for tools spawned afterwards. The Harness
 *      rebuilds it and re-applies its *launch-time* proxy policy, which clears
 *      `http_proxy` / `https_proxy` / `all_proxy`; the per-tool names survive:
 *        - `GIT_CONFIG_PARAMETERS` (git's own `-c` channel)
 *        - `npm_config_proxy` / `npm_config_https_proxy`
 *        - `PIP_PROXY` / `PIP_HTTPS_PROXY`
 *
 * Proxy address resolution, highest first:
 *   1. the address saved in the settings page (`$DSH_HOME/agent-proxy.json`)
 *   2. the row's `config.proxyUrl`
 *   3. the Windows system proxy (HKCU Internet Settings, when enabled)
 *   4. a proxy already exported in the Harness environment
 *
 * `config.enabled` is only the initial default before the state file exists.
 */

import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

export const name = 'dsh-agent-proxy'

const API_PREFIX = '/api/dsh-agent-proxy'
const MUTATION_HEADER = 'x-dsh-agent-proxy'
const NODE_PROXY_FLAG = 'NODE_USE_ENV_PROXY'
const PROXY_ENV_KEYS = ['http_proxy', 'https_proxy', 'all_proxy', 'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY']
const NPM_ENV_KEYS = ['npm_config_proxy', 'npm_config_https_proxy']
const PIP_ENV_KEYS = ['PIP_PROXY', 'PIP_HTTPS_PROXY']
/** Process-wide flag: this process currently carries the plugin's proxy values. */
const APPLIED = Symbol.for('dsh-agent-proxy.applied')
/** The environment as it was when this plugin first loaded in this process. */
const ORIGINAL = Symbol.for('dsh-agent-proxy.original')

/* --------------------------------------------------------------- utilities */

function messageOf(error) {
  if (!error) return '未知错误'
  return String(error.message ?? error)
}

function trimOrEmpty(value) {
  return typeof value === 'string' ? value.trim() : ''
}

/** One proxy URL from the accepted forms: URL, `host:port`, WinINET `http=…;https=…`. */
function normalizeProxyUrl(raw) {
  const value = trimOrEmpty(raw)
  if (!value) return ''
  if (value.includes('=')) {
    const parts = value.split(';').map((part) => part.trim()).filter(Boolean)
    const http = parts.find((part) => part.toLowerCase().startsWith('http=')) ?? parts[0]
    const endpoint = http ? http.slice(http.indexOf('=') + 1).trim() : ''
    return normalizeProxyUrl(endpoint)
  }
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) {
    try {
      const url = new URL(value)
      if (!url.hostname) return ''
      return value.replace(/\/+$/, '')
    } catch {
      return ''
    }
  }
  if (/^[^\s/]+:\d{1,5}$/.test(value)) return `http://${value}`
  return ''
}

/** HKCU Internet Settings proxy, or '' when Windows has no system proxy on. */
function readWindowsSystemProxy() {
  if (process.platform !== 'win32') return ''
  let output = ''
  try {
    output = execFileSync(
      'reg',
      ['query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings'],
      { encoding: 'utf8', windowsHide: true, timeout: 4000, stdio: ['ignore', 'pipe', 'ignore'] },
    )
  } catch {
    return ''
  }
  const enabled = /ProxyEnable\s+REG_DWORD\s+0x([0-9a-f]+)/i.exec(output)
  if (!enabled || Number.parseInt(enabled[1], 16) !== 1) return ''
  const server = /ProxyServer\s+REG_SZ\s+([^\r\n]+)/i.exec(output)
  return normalizeProxyUrl(server?.[1] ?? '')
}

function proxyFromEnvironment() {
  for (const key of ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy', 'ALL_PROXY', 'all_proxy']) {
    const value = normalizeProxyUrl(process.env[key])
    if (value) return value
  }
  return ''
}

/** Resolve the address to use, with a note about where it came from. */
function resolveProxy(configured) {
  const explicit = normalizeProxyUrl(configured)
  if (explicit) return { url: explicit, source: 'config' }
  const system = readWindowsSystemProxy()
  if (system) return { url: system, source: 'system' }
  const exported = proxyFromEnvironment()
  if (exported) return { url: exported, source: 'env' }
  return { url: '', source: '' }
}

/* -------------------------------------------------------------- persistence */

function stateFile() {
  const home = trimOrEmpty(process.env.DSH_HOME) || join(homedir(), '.dsh')
  return join(home, 'agent-proxy.json')
}

function readState() {
  try {
    const parsed = JSON.parse(readFileSync(stateFile(), 'utf8'))
    return parsed && typeof parsed === 'object' ? parsed : undefined
  } catch {
    return undefined
  }
}

function writeState(state) {
  const file = stateFile()
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, `${JSON.stringify(state, null, 2)}\n`)
}

/* --------------------------------------------------------------- git config */

function gitconfigPath() {
  const configured = trimOrEmpty(process.env.GIT_CONFIG_GLOBAL)
  if (configured) return configured
  return join(process.env.USERPROFILE || homedir(), '.gitconfig')
}

/** Section name of a header line; sub-section headers (`[http "url"]`) never match. */
function sectionNameOf(line) {
  const match = /^\s*\[([^\]]+)\]\s*$/.exec(line)
  return match ? match[1].trim().toLowerCase() : undefined
}

function readSectionProxy(text, section) {
  let value = ''
  let current = ''
  for (const line of splitLines(text)) {
    const name = sectionNameOf(line)
    if (name !== undefined) {
      current = name
      continue
    }
    if (current !== section) continue
    const match = /^\s*proxy\s*=\s*(.*)$/i.exec(line)
    if (match) value = match[1].trim()
  }
  return value
}

/** Replace (or delete, with `undefined`) the `proxy` key inside one plain section. */
/** Drop sections that only kept a header after the proxy key was removed. */
function squashEmptySections(text) {
  const eol = text.includes('\r\n') ? '\r\n' : '\n'
  const lines = splitLines(text)
  const out = []
  for (let index = 0; index < lines.length; index += 1) {
    const name = sectionNameOf(lines[index])
    if (name !== undefined) {
      let hasContent = false
      for (let next = index + 1; next < lines.length; next += 1) {
        if (sectionNameOf(lines[next]) !== undefined) break
        if (lines[next].trim() !== '') {
          hasContent = true
          break
        }
      }
      if (!hasContent) {
        while (index + 1 < lines.length && lines[index + 1].trim() === '') index += 1
        continue
      }
    }
    out.push(lines[index])
  }
  while (out.length && out[out.length - 1].trim() === '') out.pop()
  return out.length ? out.join(eol) + eol : ''
}

function rewriteGitSection(text, section, proxy) {
  const eol = text.includes('\r\n') ? '\r\n' : '\n'
  const out = []
  let current = ''
  let found = false
  for (const line of splitLines(text)) {
    const name = sectionNameOf(line)
    if (name !== undefined) {
      current = name
      out.push(line)
      if (current === section) {
        found = true
        if (proxy !== undefined) out.push(`\tproxy = ${proxy}`)
      }
      continue
    }
    if (current === section && /^\s*proxy\s*=/i.test(line)) continue
    out.push(line)
  }
  if (!found && proxy !== undefined) {
    if (out.length && out[out.length - 1].trim() !== '') out.push('')
    out.push(`[${section}]`, `\tproxy = ${proxy}`)
  }
  return out.length ? out.join(eol) + eol : ''
}

function readGitProxy() {
  const text = readTextFile(gitconfigPath())
  return { http: readSectionProxy(text, 'http'), https: readSectionProxy(text, 'https') }
}

function applyGitProxy(url) {
  let text = readTextFile(gitconfigPath())
  text = rewriteGitSection(text, 'http', url)
  text = rewriteGitSection(text, 'https', url)
  writeTextFile(gitconfigPath(), text)
}

function restoreGitProxy(saved) {
  let text = readTextFile(gitconfigPath())
  text = rewriteGitSection(text, 'http', trimOrEmpty(saved?.http) || undefined)
  text = rewriteGitSection(text, 'https', trimOrEmpty(saved?.https) || undefined)
  writeTextFile(gitconfigPath(), squashEmptySections(text))
}

/* --------------------------------------------------------------- npm config */

function npmrcPath() {
  const configured = trimOrEmpty(process.env.npm_config_userconfig)
  if (configured) return configured
  return join(process.env.USERPROFILE || homedir(), '.npmrc')
}

function splitLines(text) {
  if (!text) return []
  const lines = text.split(/\r?\n/)
  if (lines.length && lines[lines.length - 1] === '') lines.pop()
  return lines
}

function npmProxyValue(text) {
  const values = { proxy: '', 'https-proxy': '' }
  for (const line of splitLines(text)) {
    const match = /^\s*(proxy|https-proxy)\s*=\s*(.*)$/i.exec(line)
    if (match) values[match[1].toLowerCase()] = match[2].trim()
  }
  return values
}

function npmWithProxy(text, url) {
  const eol = text.includes('\r\n') ? '\r\n' : '\n'
  const lines = splitLines(text).filter((line) => !/^\s*(proxy|https-proxy)\s*=/i.test(line))
  lines.push(`proxy=${url}`, `https-proxy=${url}`)
  return lines.join(eol) + eol
}

function npmWithoutProxy(text, saved) {
  const eol = text.includes('\r\n') ? '\r\n' : '\n'
  const lines = splitLines(text).filter((line) => !/^\s*(proxy|https-proxy)\s*=/i.test(line))
  if (trimOrEmpty(saved?.proxy)) lines.push(`proxy=${saved.proxy}`)
  if (trimOrEmpty(saved?.['https-proxy'])) lines.push(`https-proxy=${saved['https-proxy']}`)
  return lines.length ? lines.join(eol) + eol : ''
}

function readTextFile(path) {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return ''
  }
}

function writeTextFile(path, text) {
  if (text.trim() === '') {
    try {
      unlinkSync(path)
    } catch {
      // already gone
    }
    return
  }
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, text)
}

/* --------------------------------------------------------------- pip config */

function pipIniPath() {
  const configured = trimOrEmpty(process.env.PIP_CONFIG_FILE)
  if (configured) return configured
  if (process.platform === 'win32') {
    return join(process.env.APPDATA || join(homedir(), 'AppData', 'Roaming'), 'pip', 'pip.ini')
  }
  return join(homedir(), '.config', 'pip', 'pip.conf')
}

function pipProxyValue(text) {
  let value = ''
  let section = ''
  for (const line of splitLines(text)) {
    const header = /^\s*\[([^\]]+)\]\s*$/.exec(line)
    if (header) {
      section = header[1].trim().toLowerCase()
      continue
    }
    if (section !== 'global') continue
    const match = /^\s*proxy\s*=\s*(.*)$/i.exec(line)
    if (match) value = match[1].trim()
  }
  return value
}

function pipWithProxy(text, url) {
  const eol = text.includes('\r\n') ? '\r\n' : '\n'
  const out = []
  let inGlobal = false
  let wrote = false
  for (const line of splitLines(text)) {
    const header = /^\s*\[([^\]]+)\]\s*$/.exec(line)
    if (header) {
      inGlobal = header[1].trim().toLowerCase() === 'global'
      out.push(line)
      if (inGlobal) {
        out.push(`proxy = ${url}`)
        wrote = true
      }
      continue
    }
    if (inGlobal && /^\s*proxy\s*=/i.test(line)) continue
    out.push(line)
  }
  if (!wrote) {
    if (out.length && out[out.length - 1].trim() !== '') out.push('')
    out.push('[global]', `proxy = ${url}`)
  }
  return out.join(eol) + eol
}

function pipWithoutProxy(text, saved) {
  const eol = text.includes('\r\n') ? '\r\n' : '\n'
  const original = trimOrEmpty(saved?.proxy)
  const out = []
  let inGlobal = false
  let wrote = false
  for (const line of splitLines(text)) {
    const header = /^\s*\[([^\]]+)\]\s*$/.exec(line)
    if (header) {
      inGlobal = header[1].trim().toLowerCase() === 'global'
      out.push(line)
      if (inGlobal && original) {
        out.push(`proxy = ${original}`)
        wrote = true
      }
      continue
    }
    if (inGlobal && /^\s*proxy\s*=/i.test(line)) continue
    out.push(line)
  }
  if (original && !wrote) {
    if (out.length && out[out.length - 1].trim() !== '') out.push('')
    out.push('[global]', `proxy = ${original}`)
  }
  return out.length ? out.join(eol) + eol : ''
}

/* ------------------------------------------------ tool config orchestration */

function captureToolConfig() {
  const npmText = readTextFile(npmrcPath())
  const pipText = readTextFile(pipIniPath())
  return {
    git: readGitProxy(),
    npm: npmProxyValue(npmText),
    pip: { proxy: pipProxyValue(pipText) },
  }
}

function applyToolConfig(url) {
  applyGitProxy(url)
  writeTextFile(npmrcPath(), npmWithProxy(readTextFile(npmrcPath()), url))
  writeTextFile(pipIniPath(), pipWithProxy(readTextFile(pipIniPath()), url))
}

function restoreToolConfig(saved) {
  if (!saved) return
  restoreGitProxy(saved.git)
  writeTextFile(npmrcPath(), npmWithoutProxy(readTextFile(npmrcPath()), saved.npm))
  writeTextFile(pipIniPath(), squashEmptySections(pipWithoutProxy(readTextFile(pipIniPath()), saved.pip)))
}

/* ---------------------------------------------------- per-tool environment */

function isProxyKey(key) {
  return PROXY_ENV_KEYS.some((candidate) => candidate.toLowerCase() === key.toLowerCase())
}

function isManagedKey(key) {
  if (isProxyKey(key)) return true
  if (key === NODE_PROXY_FLAG) return true
  const upper = key.toUpperCase()
  const lower = key.toLowerCase()
  if (upper === 'GIT_CONFIG_PARAMETERS') return true
  if (NPM_ENV_KEYS.includes(lower)) return true
  if (PIP_ENV_KEYS.includes(upper)) return true
  return false
}

/** Snapshot every managed environment entry exactly as it is now. */
function captureProxyEnvironment() {
  const snapshot = new Map()
  for (const key of Object.keys(process.env)) {
    if (isManagedKey(key)) snapshot.set(key, process.env[key])
  }
  return snapshot
}

/** `http.proxy` / `https.proxy` through git's environment config (no file edited). */
function gitProxyParameters(url) {
  const quote = (value) => `'${String(value).replace(/'/g, `'\\''`)}'`
  const existing = trimOrEmpty(process.env.GIT_CONFIG_PARAMETERS)
  const ours = [`${quote('http.proxy')}=${quote(url)}`, `${quote('https.proxy')}=${quote(url)}`]
  return existing ? `${existing} ${ours.join(' ')}` : ours.join(' ')
}

function writeProxyEnvironment(url) {
  for (const key of PROXY_ENV_KEYS) process.env[key] = url
  process.env[NODE_PROXY_FLAG] = '1'
  process.env.GIT_CONFIG_PARAMETERS = gitProxyParameters(url)
  for (const key of NPM_ENV_KEYS) process.env[key] = url
  for (const key of PIP_ENV_KEYS) process.env[key] = url
}

function restoreProxyEnvironment(snapshot) {
  if (!snapshot) return
  for (const key of Object.keys(process.env)) {
    if (isManagedKey(key)) delete process.env[key]
  }
  for (const [key, value] of snapshot) {
    if (value !== undefined) process.env[key] = value
  }
}

if (globalThis[ORIGINAL] === undefined) globalThis[ORIGINAL] = captureProxyEnvironment()

function restoreOriginalEnvironment() {
  restoreProxyEnvironment(globalThis[ORIGINAL])
}

/* ------------------------------------------------------- settings transport */

function jsonResponse(status, payload) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  })
}

function fail(status, error) {
  return jsonResponse(status, { ok: false, error })
}

async function readJsonBody(request, limit = 1 << 16) {
  const text = await request.text()
  if (Buffer.byteLength(text) > limit) {
    throw Object.assign(new Error('request body is too large'), { statusCode: 413 })
  }
  if (!text.trim()) return {}
  try {
    return JSON.parse(text)
  } catch {
    throw Object.assign(new Error('request body is not valid JSON'), { statusCode: 400 })
  }
}

/** Same-origin + explicit client marker, mirroring the Harness' own routes. */
function guardMutation(request) {
  if (request.headers.get(MUTATION_HEADER) !== '1') return 'missing client marker header'
  const origin = request.headers.get('origin')
  if (origin) {
    try {
      const requestHost = request.headers.get('host') ?? new URL(request.url).host
      if (new URL(origin).host !== requestHost) return 'cross-origin mutation request'
    } catch {
      return 'invalid origin'
    }
  }
  return undefined
}

/* ------------------------------------------------------------------ plugin */

export function apply(ctx, rawConfig) {
  const config = rawConfig && typeof rawConfig === 'object' ? rawConfig : {}

  /** Live view exposed to the settings page. */
  const status = { enabled: false, proxyUrl: '', source: '', error: '' }
  // A config reload creates a new instance on top of the old environment; drop
  // whatever the previous instance left before deciding the state again.
  if (globalThis[APPLIED]) {
    restoreOriginalEnvironment()
    delete globalThis[APPLIED]
  }

  /** Address the user typed in the settings page, or the row's configured default. */
  const configuredUrl = () => trimOrEmpty(readState()?.customProxyUrl) || trimOrEmpty(config.proxyUrl)

  const detect = () => resolveProxy(configuredUrl())

  const enable = () => {
    if (status.enabled) return status
    const resolved = detect()
    if (!resolved.url) {
      status.error = 'no-proxy'
      return status
    }
    const existing = readState()
    const restore = existing?.restore ?? captureToolConfig()
    applyToolConfig(resolved.url)
    writeProxyEnvironment(resolved.url)
    writeState({ ...(existing ?? {}), enabled: true, restore })
    globalThis[APPLIED] = true
    status.enabled = true
    status.proxyUrl = resolved.url
    status.source = resolved.source
    status.error = ''
    return status
  }

  const unapply = () => {
    const restore = readState()?.restore
    if (restore) {
      try {
        restoreToolConfig(restore)
      } catch {
        // A broken tool config must not keep the environment switched on.
      }
    }
    restoreOriginalEnvironment()
    delete globalThis[APPLIED]
  }

  const disable = () => {
    unapply()
    writeState({ ...(readState() ?? {}), enabled: false })
    status.enabled = false
    status.proxyUrl = ''
    status.source = ''
    status.error = ''
    return status
  }

  /** Read the full picture the settings page needs. */
  const snapshot = () => {
    const detected = detect()
    return {
      enabled: status.enabled,
      proxyUrl: status.enabled ? status.proxyUrl : detected.url,
      source: status.enabled ? status.source : detected.source,
      configuredUrl: trimOrEmpty(readState()?.customProxyUrl),
      detectedUrl: detected.url,
      detectedSource: detected.source,
      error: status.error,
    }
  }

  /** Store a custom proxy address ('' = keep using the system proxy) and re-apply it. */
  const saveProxyUrl = (raw) => {
    const value = trimOrEmpty(raw)
    const normalized = value ? normalizeProxyUrl(value) : ''
    if (value && !normalized) {
      throw Object.assign(
        new Error('代理地址无效：仅支持 http:// 或 https:// 地址，例如 http://127.0.0.1:7890'),
        { statusCode: 400 },
      )
    }
    const wasEnabled = status.enabled
    if (wasEnabled) {
      unapply()
      status.enabled = false
      status.proxyUrl = ''
      status.source = ''
    }
    const next = { ...(readState() ?? {}), customProxyUrl: normalized }
    // 0.1.x stored the resolved address here; it is not a user preference.
    delete next.proxyUrl
    writeState(next)
    if (wasEnabled) enable()
    return snapshot()
  }

  const state = readState()
  const wantOn = typeof state?.enabled === 'boolean' ? state.enabled : config.enabled === true
  if (wantOn) enable()

  ctx.effect(
    () => () => {
      // Plugin unload (disable / uninstall): never leave proxy values behind.
      restoreOriginalEnvironment()
      delete globalThis[APPLIED]
    },
    'dsh-agent-proxy: child process proxy environment',
  )

  const routes = [
    {
      path: `${API_PREFIX}/state`,
      methods: ['GET', 'HEAD'],
      requestBody: 'buffered',
      async fetch() {
        try {
          return jsonResponse(200, { ok: true, data: snapshot() })
        } catch (error) {
          return fail(500, messageOf(error))
        }
      },
    },
    {
      path: `${API_PREFIX}/toggle`,
      methods: ['POST'],
      requestBody: 'buffered',
      async fetch(request) {
        const rejected = guardMutation(request)
        if (rejected) return fail(403, rejected)
        try {
          const body = await readJsonBody(request)
          if (typeof body.enabled !== 'boolean') {
            return fail(400, 'enabled 必须是布尔值')
          }
          if (body.enabled) {
            enable()
            if (!status.enabled) {
              return fail(409, '未检测到代理地址：请在下方填写代理地址，或先打开代理软件的系统代理')
            }
          } else {
            disable()
          }
          let stored = true
          try {
            const next = readState() ?? {}
            writeState({ ...next, enabled: status.enabled })
          } catch (error) {
            stored = false
            status.error = messageOf(error)
          }
          return jsonResponse(200, { ok: true, data: { ...snapshot(), saved: stored } })
        } catch (error) {
          return fail(error?.statusCode ?? 500, messageOf(error))
        }
      },
    },
    {
      path: `${API_PREFIX}/settings`,
      methods: ['POST'],
      requestBody: 'buffered',
      async fetch(request) {
        const rejected = guardMutation(request)
        if (rejected) return fail(403, rejected)
        try {
          const body = await readJsonBody(request)
          if (typeof body.proxyUrl !== 'string') {
            return fail(400, 'proxyUrl 必须是字符串')
          }
          const data = saveProxyUrl(body.proxyUrl)
          return jsonResponse(200, { ok: true, data: { ...data, saved: true } })
        } catch (error) {
          return fail(error?.statusCode ?? 500, messageOf(error))
        }
      },
    },
  ]

  const mount = (owner) => {
    const connection = typeof owner.get === 'function' ? owner.get('connection') : undefined
    const register = connection?.fetch?.register
    if (typeof register !== 'function') return
    owner.effect(() => {
      const disposers = routes.map((route) =>
        register({
          path: route.path,
          methods: route.methods,
          requestBody: route.requestBody,
          fetch: route.fetch,
        }),
      )
      return () => {
        for (const dispose of disposers) {
          try {
            const pending = dispose()
            if (pending && typeof pending.catch === 'function') pending.catch(() => undefined)
          } catch {
            // already disposed
          }
        }
      }
    }, 'dsh-agent-proxy: settings routes')
  }

  try {
    const mounted = typeof ctx.get === 'function' ? ctx.get('connection') : undefined
    if (mounted?.fetch?.register) mount(ctx)
    else if (typeof ctx.inject === 'function') ctx.inject(['connection'], (scope) => mount(scope))
  } catch {
    // Without a Web carrier the switch state still applies; only the page loses its bridge.
  }
}
