/**
 * rtk (Rust Token Killer) bash executor plugin for the DeepSeek Harness.
 * Two providers wrap the stock bash executors and rewrite the shell source at
 * the `resolve` boundary, so workdir/timeout/env/exit-code/background-job and
 * (for the sandbox variant) confinement semantics are all inherited unchanged.
 * A command that is not eligible for wrapping (complex shell, non-whitelisted
 * tool, or a missing `rtk` binary) passes through byte-for-byte.
 *
 * @module @karlx/dsh-bash-rtk
 */

import { spawnSync } from 'node:child_process'
import { Context } from 'cordis'
import { LocalBashExecutor } from '@deepseek-ai/dsh-bash-local'
import type { Config as LocalConfig } from '@deepseek-ai/dsh-bash-local'
import { SandboxBashExecutor } from '@deepseek-ai/dsh-bash-sandbox'
import type { Config as SandboxConfig } from '@deepseek-ai/dsh-bash-sandbox'
import type { ShellExecRequest, ShellExecSpec } from '@deepseek-ai/dsh-shell'
import { wrapWithRtk } from './wrap.ts'

export { wrapWithRtk } from './wrap.ts'
export type { Config } from '@deepseek-ai/dsh-bash-local'

/** Probe for the `rtk` binary on PATH; absence degrades to the identity transform. */
function resolveRtk(): boolean {
  try {
    const result = spawnSync('rtk', ['--version'], { stdio: 'ignore' })
    return result.status === 0
  } catch {
    /* v8 ignore next -- spawnSync throws only on a broken runtime, not a missing binary */
    return false
  }
}

/**
 * rtk-wrapping LOCAL bash executor (no file sandbox). Registers as `ctx.shell`
 * in place of `dsh-bash-local`; use where confinement is not required (e.g.
 * `danger-full-access` deployments).
 */
export class RtkBashExecutor extends LocalBashExecutor {
  private readonly rtkAvailable: boolean

  constructor(ctx: Context, config: LocalConfig) {
    super(ctx, config)
    this.rtkAvailable = resolveRtk()
  }

  override resolve(request: ShellExecRequest): ShellExecSpec {
    const spec = super.resolve(request)
    return { ...spec, command: wrapWithRtk(spec.command, this.rtkAvailable) }
  }
}

/**
 * rtk-wrapping SANDBOX bash executor (preserves file confinement). Registers
 * as `ctx.shell` in place of `dsh-bash-sandbox`; the wrap happens before
 * `run`/`start` read `spec.command`, so both the `danger-full-access` and the
 * confined paths run the already-wrapped source.
 */
export class RtkSandboxBashExecutor extends SandboxBashExecutor {
  static override inject = ['subprocess', 'sandbox', 'sandboxPolicy']

  private readonly rtkAvailable: boolean

  constructor(ctx: Context, config: SandboxConfig) {
    super(ctx, config)
    this.rtkAvailable = resolveRtk()
  }

  override resolve(request: ShellExecRequest): ShellExecSpec {
    const spec = super.resolve(request)
    return { ...spec, command: wrapWithRtk(spec.command, this.rtkAvailable) }
  }
}

export default RtkSandboxBashExecutor
