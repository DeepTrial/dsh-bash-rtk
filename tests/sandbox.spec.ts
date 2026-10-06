import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { SandboxProvider } from '@deepseek-ai/dsh-sandbox'
import type { ConfinedArgv, SandboxMode, SandboxPolicy } from '@deepseek-ai/dsh-sandbox'
import { SandboxPolicyService } from '@deepseek-ai/dsh-sandbox-policy'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
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
    async confine(argv: readonly string[], policy: SandboxPolicy): Promise<ConfinedArgv> {
      calls.push({ argv: [...argv], policy })
      return passthrough(argv)
    }
  }
  const ctx = new Context()
  await ctx.plugin(FakeSandboxProvider)
  // dsh >=0.2 makes SandboxPolicyService inject `sessionProjections`; the
  // registry is dependency-free, so a bare plugin() is enough here.
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(SandboxPolicyService, { ...mode !== undefined ? { mode } : {} })
  await ctx.plugin(LocalSubprocessRuntime)
  ;(ctx.subprocess as LocalSubprocessRuntime).internals = { spillDir }
  await ctx.plugin(RtkSandboxBashExecutor, { graceMs: 200, rtkAvailable: true, ...execConfig })
  const bash = ctx.shell as RtkSandboxBashExecutor
  return { ctx, bash, calls }
}

/** Run one resolved spec to completion: dsh >=0.2 replaced `run()` with `execute()` + `result()`. */
async function run(bash: RtkSandboxBashExecutor, command: string) {
  const execution = await bash.execute(bash.resolve({ command }))
  return await execution.result()
}

describe('RtkSandboxBashExecutor', () => {
  it('registers as ctx.shell', async () => {
    const { bash } = await setup()
    expect(bash).toBeInstanceOf(RtkSandboxBashExecutor)
  })

  it('wraps eligible commands before the sandbox confines them', async () => {
    const { bash, calls } = await setup({ mode: 'read-only' })
    await run(bash, 'git status')
    expect(calls).toEqual([{
      argv: ['bash', '-c', 'rtk git status'],
      policy: { mode: 'read-only', workspaceRoot: resolve(process.cwd()) },
    }])
  })

  it('leaves complex commands unchanged before confinement', async () => {
    const { bash, calls } = await setup({ mode: 'read-only' })
    await run(bash, 'git status | grep x')
    expect(calls[0]?.argv).toEqual(['bash', '-c', 'git status | grep x'])
  })

  it('leaves non-whitelisted commands unchanged before confinement', async () => {
    const { bash, calls } = await setup({ mode: 'read-only' })
    await run(bash, 'ls -la')
    expect(calls[0]?.argv).toEqual(['bash', '-c', 'ls -la'])
  })

  it('stamps sandbox facts on the result', async () => {
    const { bash } = await setup({ mode: 'read-only' })
    const result = await run(bash, 'echo hi')
    expect(result.sandbox).toEqual({ mode: 'read-only', denied: false, enforcement: 'full' })
  })
})
