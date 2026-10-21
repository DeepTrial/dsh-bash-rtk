/**
 * `dsh-bash-rtk` stats half: `GET /rtk/stats` backs the composer-dock pill.
 * It reads the same ledger the executors write (`rtk gain`), so the browser
 * never touches the filesystem. Web-only — the row is disabled outside the
 * web profile because it depends on `ctx.webServer`.
 */
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { join } from 'node:path'

export const name = 'dsh-bash-rtk-stats'
export const inject = ['webServer', 'sessions']

/** The host services this module uses (structural, keeps the package dependency-free). */
interface StatsContext {
  webServer: {
    register(route: {
      kind: 'exact'
      path: string
      handler: (req: IncomingMessage, res: ServerResponse) => void
    }): () => void
  }
  sessions: { get(id: string): { readonly header: { readonly cwd?: string } } | undefined }
}

/** Cache window for the pill's poll, in milliseconds. */
const CACHE_MS = 10_000

/**
 * The ledger the executors write for a workspace. Undefined means "leave
 * rtk's default alone": `RTK_DB_PATH` wins, then the workspace ledger, then
 * rtk's own HOME path.
 */
function ledgerPath(cwd: string | undefined): string | undefined {
  const configured = process.env.RTK_DB_PATH
  if (configured !== undefined && configured !== '') return configured
  if (cwd === undefined) return undefined
  const candidate = join(cwd, '.rtk', 'history.db')
  return existsSync(candidate) ? candidate : undefined
}

/** Run `rtk gain` against a workspace ledger; `detail` asks for the text report. */
export function readGain(cwd: string | undefined, detail: boolean): Record<string, unknown> {
  const ledger = ledgerPath(cwd)
  const result = spawnSync('rtk', detail ? ['gain'] : ['gain', '--format', 'json'], {
    encoding: 'utf8',
    timeout: 5_000,
    env: ledger === undefined ? process.env : { ...process.env, RTK_DB_PATH: ledger },
  })
  if (result.error !== undefined) return { ok: false, error: result.error.message }
  const output = result.stdout ?? ''
  if (result.status !== 0) {
    return { ok: false, error: (result.stderr ?? '').trim() || `rtk gain exited with ${String(result.status)}` }
  }
  if (detail) return { ok: true, text: output.trimEnd() }
  try {
    const parsed = JSON.parse(output) as { summary?: unknown }
    if (parsed.summary === undefined || parsed.summary === null) return { ok: false, error: 'rtk gain returned no summary' }
    return { ok: true, summary: parsed.summary }
  } catch {
    return { ok: false, error: 'rtk gain returned invalid JSON' }
  }
}

/** Write one JSON response. */
function respond(res: ServerResponse, body: Record<string, unknown>): void {
  res.statusCode = 200
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(JSON.stringify(body))
}

/** Register the read-only stats route. */
export function apply(ctx: StatsContext): void {
  const cache = new Map<string, { at: number; body: Record<string, unknown> }>()
  ctx.webServer.register({
    kind: 'exact',
    path: '/rtk/stats',
    handler: (req, res) => {
      if (req.method !== 'GET') {
        res.statusCode = 405
        res.end()
        return
      }
      const url = new URL(req.url ?? '/', 'http://127.0.0.1')
      const sessionId = url.searchParams.get('sessionId')
      const cwd = sessionId === null ? undefined : ctx.sessions.get(sessionId)?.header.cwd
      const detail = url.searchParams.get('detail') !== null
      const key = `${cwd ?? ''}:${String(detail)}`
      const now = Date.now()
      const cached = cache.get(key)
      if (cached !== undefined && now - cached.at < CACHE_MS) {
        respond(res, cached.body)
        return
      }
      const body = readGain(cwd, detail)
      cache.set(key, { at: now, body })
      respond(res, body)
    },
  })
}
