import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Context } from 'cordis'
import { SandboxProvider } from '@deepseek-ai/dsh-sandbox'
import type { ConfinedArgv, SandboxMode, SandboxPolicy } from '@deepseek-ai/dsh-sandbox'
import { SandboxPolicyService } from '@deepseek-ai/dsh-sandbox-policy'
import { RtkSandboxBashExecutor } from '../src/index.ts'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'

const spillDir = mkdtempSync(join(tmpdir(), 'dsh-bash-rtk-sandbox-spec-'))

/** A passthrough wrap: the caller's argv unchanged, asserted full. */
const passthrough = (argv: readonly string[]): ConfinedArgv =>
  ({ argv: [...argv], enforcement: 'full', denialSignatures: [], runnerFailureRules: [] })

async function setup(config: { mode?: SandboxMode } = {}) {
  const { mode, ...execConfig } = config
  const calls: { argv: string[]; policy: SandboxPolicy }[] = []
  class FakeSandboxProvider extends SandboxProvider {
    confine(argv: readonly string[], policy: SandboxPolicy): ConfinedArgv {
      calls.push({ argv: [...argv], policy })
      return passthrough(argv)
    }
  }
  const ctx = new Context()
  await ctx.plugin(FakeSandboxProvider)
  await ctx.plugin(SandboxPolicyService, { ...mode !== undefined ? { mode } : {} })
  await ctx.plugin(LocalSubprocessRuntime)
  ;(ctx.subprocess as LocalSubprocessRuntime).internals = { spillDir }
  await ctx.plugin(RtkSandboxBashExecutor, { graceMs: 200, rtkAvailable: true, ...execConfig })
  const bash = ctx.shell as RtkSandboxBashExecutor
  return { ctx, bash, calls }
}

describe('RtkSandboxBashExecutor', () => {
  it('registers as ctx.shell', async () => {
    const { bash } = await setup()
    expect(bash).toBeInstanceOf(RtkSandboxBashExecutor)
  })

  it('wraps eligible commands before the sandbox confines them', async () => {
    const { bash, calls } = await setup({ mode: 'read-only' })
    await bash.run(bash.resolve({ command: 'git status' }))
    expect(calls).toEqual([{
      argv: ['bash', '-c', 'rtk git status'],
      policy: { mode: 'read-only', workspaceRoot: resolve(process.cwd()) },
    }])
  })

  it('leaves complex commands unchanged before confinement', async () => {
    const { bash, calls } = await setup({ mode: 'read-only' })
    await bash.run(bash.resolve({ command: 'git status | grep x' }))
    expect(calls[0]?.argv).toEqual(['bash', '-c', 'git status | grep x'])
  })

  it('leaves non-whitelisted commands unchanged before confinement', async () => {
    const { bash, calls } = await setup({ mode: 'read-only' })
    await bash.run(bash.resolve({ command: 'ls -la' }))
    expect(calls[0]?.argv).toEqual(['bash', '-c', 'ls -la'])
  })

  it('stamps sandbox facts on the result', async () => {
    const { bash } = await setup({ mode: 'read-only' })
    const result = await bash.run(bash.resolve({ command: 'echo hi' }))
    expect(result.sandbox).toEqual({ mode: 'read-only', denied: false, enforcement: 'full' })
  })
})
