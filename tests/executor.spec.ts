import { describe, expect, it } from 'vitest'
import { Context } from 'cordis'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import { RtkBashExecutor } from '../src/index.ts'

async function setup() {
  const ctx = new Context()
  await ctx.plugin(LocalSubprocessRuntime)
  await ctx.plugin(RtkBashExecutor, {})
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
})
