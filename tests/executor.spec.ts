import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import { RtkBashExecutor } from '../src/index.ts'

// A DSH shell may already carry RTK_DB_PATH (the plugin injects it); these
// tests assert the plugin's own decision, so hide the ambient value.
const ambientDbPath = process.env.RTK_DB_PATH
beforeEach(() => {
  delete process.env.RTK_DB_PATH
})
afterEach(() => {
  if (ambientDbPath === undefined) delete process.env.RTK_DB_PATH
  else process.env.RTK_DB_PATH = ambientDbPath
})

async function setup(
  opts: { rtkAvailable?: boolean; rtkTracking?: boolean; rtkDbPath?: string } = {},
) {
  const ctx = new Context()
  await ctx.plugin(LocalSubprocessRuntime)
  await ctx.plugin(RtkBashExecutor, { rtkAvailable: true, ...opts })
  const bash = ctx.shell as RtkBashExecutor
  return { ctx, bash }
}

const confined = { mode: 'workspace-write', workspaceRoot: '/workspace' } as const

describe('RtkBashExecutor', () => {
  it('registers as ctx.shell', async () => {
    const { bash } = await setup()
    expect(bash).toBeInstanceOf(RtkBashExecutor)
  })

  it('wraps eligible simple commands in resolve()', async () => {
    const { bash } = await setup()
    const spec = bash.resolve({ command: 'git status' })
    expect(spec.command).toBe('rtk git status')
  })

  it('leaves complex commands unchanged in resolve()', async () => {
    const { bash } = await setup()
    const spec = bash.resolve({ command: 'git status | grep x' })
    expect(spec.command).toBe('git status | grep x')
  })

  it('leaves non-whitelisted commands unchanged in resolve()', async () => {
    const { bash } = await setup()
    const spec = bash.resolve({ command: 'ls -la' })
    expect(spec.command).toBe('ls -la')
  })

  it('falls back to identity when rtkAvailable is false', async () => {
    const { bash } = await setup({ rtkAvailable: false })
    const spec = bash.resolve({ command: 'git status' })
    expect(spec.command).toBe('git status')
  })

  it('keeps the rtk ledger inside the session workspace when confined', async () => {
    const { bash } = await setup()
    const spec = bash.resolve({ command: 'git status', sandboxPolicy: confined })
    expect(spec.command).toBe('rtk git status')
    expect(spec.env).toEqual({ RTK_DB_PATH: '/workspace/.rtk/history.db' })
  })

  it('leaves the ledger alone when rtkTracking is false', async () => {
    const { bash } = await setup({ rtkTracking: false })
    const spec = bash.resolve({ command: 'git status', sandboxPolicy: confined })
    expect(spec.env).toBeUndefined()
  })

  it('honours an explicit rtkDbPath, resolving it against the session workspace', async () => {
    const { bash } = await setup({ rtkDbPath: '.state/rtk.db' })
    const spec = bash.resolve({ command: 'git status', sandboxPolicy: confined })
    expect(spec.env).toEqual({ RTK_DB_PATH: '/workspace/.state/rtk.db' })
  })

  it('does not redirect the ledger outside workspace-write mode', async () => {
    const { bash } = await setup()
    const spec = bash.resolve({
      command: 'git status',
      sandboxPolicy: { mode: 'danger-full-access', workspaceRoot: '/workspace' },
    })
    expect(spec.env).toBeUndefined()
  })

  it('keeps an operator-provided RTK_DB_PATH', async () => {
    const previous = process.env.RTK_DB_PATH
    process.env.RTK_DB_PATH = '/operator/rtk.db'
    try {
      const { bash } = await setup()
      const spec = bash.resolve({ command: 'git status', sandboxPolicy: confined })
      expect(spec.env).toBeUndefined()
    } finally {
      if (previous === undefined) delete process.env.RTK_DB_PATH
      else process.env.RTK_DB_PATH = previous
    }
  })

  it('rejects an empty rtkDbPath at construction', async () => {
    await expect(setup({ rtkDbPath: '  ' })).rejects.toThrow('rtkDbPath')
  })

  it('uses an absolute rtkDbPath in any sandbox mode', async () => {
    const { bash } = await setup({ rtkDbPath: '/var/rtk.db' })
    const spec = bash.resolve({
      command: 'git status',
      sandboxPolicy: { mode: 'danger-full-access', workspaceRoot: '/workspace' },
    })
    expect(spec.env).toEqual({ RTK_DB_PATH: '/var/rtk.db' })
  })

  it('runs a resolved spec through the dsh >=0.2 execute()/result() contract', async () => {
    const { bash } = await setup()
    const execution = await bash.execute(bash.resolve({ command: 'printf rtk-ok' }))
    const result = await execution.result()
    expect(result.exitCode).toBe(0)
    expect(result.stdout.text).toBe('rtk-ok')
  })
})
