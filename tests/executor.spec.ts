import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import { RtkBashExecutor } from '../src/index.ts'

async function setup(opts: { rtkAvailable?: boolean } = {}) {
  const ctx = new Context()
  await ctx.plugin(LocalSubprocessRuntime)
  await ctx.plugin(RtkBashExecutor, { rtkAvailable: true, ...opts })
  const bash = ctx.shell as RtkBashExecutor
  return { ctx, bash }
}

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

  it('runs a resolved spec through the dsh >=0.2 execute()/result() contract', async () => {
    const { bash } = await setup()
    const execution = await bash.execute(bash.resolve({ command: 'printf rtk-ok' }))
    const result = await execution.result()
    expect(result.exitCode).toBe(0)
    expect(result.stdout.text).toBe('rtk-ok')
  })
})
