import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { apply } from '../src/stats.ts'

interface Route {
  kind: string
  path: string
  handler: (req: IncomingMessage, res: ServerResponse) => void
}

function setup(sessions: Record<string, string> = {}): Route {
  const routes: Route[] = []
  apply({
    webServer: {
      register(route) {
        routes.push(route as unknown as Route)
        return () => {}
      },
    },
    sessions: {
      get(id) {
        const cwd = sessions[id]
        return cwd === undefined ? undefined : { header: { cwd } }
      },
    },
  })
  return routes[0]!
}

function call(route: Route, url: string, method = 'GET') {
  const out = { statusCode: 200, headers: {} as Record<string, string>, body: '' }
  const res = {
    statusCode: 200,
    setHeader(name: string, value: string) {
      out.headers[name] = value
    },
    end(chunk?: string) {
      out.statusCode = (this as { statusCode: number }).statusCode
      if (chunk !== undefined) out.body = chunk
    },
  }
  route.handler({ method, url } as unknown as IncomingMessage, res as unknown as ServerResponse)
  return out
}

const hasRtk = spawnSync('rtk', ['--version'], { stdio: 'ignore' }).status === 0

// A DSH shell may already carry RTK_DB_PATH; this route resolves its own path.
const ambientDbPath = process.env.RTK_DB_PATH
beforeEach(() => {
  delete process.env.RTK_DB_PATH
})
afterEach(() => {
  if (ambientDbPath === undefined) delete process.env.RTK_DB_PATH
  else process.env.RTK_DB_PATH = ambientDbPath
})

describe('/rtk/stats route', () => {
  it('registers an exact /rtk/stats route', () => {
    const route = setup()
    expect(route.kind).toBe('exact')
    expect(route.path).toBe('/rtk/stats')
  })

  it('rejects non-GET requests', () => {
    const result = call(setup(), '/rtk/stats', 'POST')
    expect(result.statusCode).toBe(405)
    expect(result.body).toBe('')
  })

  it.skipIf(!hasRtk)('reports the session workspace ledger and its detail', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'rtk-stats-'))
    mkdirSync(join(cwd, '.rtk'))
    spawnSync('rtk', ['ls', '-al'], {
      cwd,
      env: { ...process.env, RTK_DB_PATH: join(cwd, '.rtk', 'history.db') },
    })
    const route = setup({ s1: cwd })

    const summary = JSON.parse(call(route, '/rtk/stats?sessionId=s1').body) as {
      ok: boolean
      summary: { total_commands: number }
    }
    expect(summary.ok).toBe(true)
    expect(summary.summary.total_commands).toBeGreaterThan(0)

    const detail = JSON.parse(call(route, '/rtk/stats?sessionId=s1&detail=1').body) as {
      ok: boolean
      text: string
    }
    expect(detail.ok).toBe(true)
    expect(detail.text).toContain('RTK Token Savings')
  })
})
