import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { apply } from '../src/command.ts'

interface Registered {
  name: string
  description: string
  recordInput?: boolean
  handler: (invocation: unknown) => unknown
}

function register(): Registered {
  const definitions: Registered[] = []
  apply({
    commands: {
      register(definition) {
        definitions.push(definition as unknown as Registered)
        return () => {}
      },
    },
  })
  return definitions[0]!
}

function invocation(cwd: string | undefined, rawInput = ''): unknown {
  return { rawInput, agent: { session: { header: cwd === undefined ? {} : { cwd } } } }
}

const hasRtk = spawnSync('rtk', ['--version'], { stdio: 'ignore' }).status === 0

// A DSH shell may already carry RTK_DB_PATH; the command's own resolution is
// what this suite asserts, so hide the ambient value.
const ambientDbPath = process.env.RTK_DB_PATH
beforeEach(() => {
  delete process.env.RTK_DB_PATH
})
afterEach(() => {
  if (ambientDbPath === undefined) delete process.env.RTK_DB_PATH
  else process.env.RTK_DB_PATH = ambientDbPath
})

describe('/rtk command', () => {
  it('registers /rtk without recording input', () => {
    const definition = register()
    expect(definition.name).toBe('rtk')
    expect(definition.recordInput).toBe(false)
  })

  it('rejects arguments', async () => {
    const result = await register().handler(invocation('/tmp', '--all'))
    expect(result).toEqual({ kind: 'error', text: 'Usage: /rtk (no arguments)' })
  })

  it.skipIf(!hasRtk)('reports the workspace ledger', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'rtk-command-'))
    mkdirSync(join(cwd, '.rtk'))
    const ledger = join(cwd, '.rtk', 'history.db')
    spawnSync('rtk', ['ls', '-al'], { cwd, env: { ...process.env, RTK_DB_PATH: ledger } })

    const result = (await register().handler(invocation(cwd))) as { kind: string; text: string }
    expect(result.kind).toBe('success')
    expect(result.text).toContain('RTK Token Savings')
  })
})
