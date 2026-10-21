/**
 * rtk (Rust Token Killer) bash executor plugin for the DeepSeek Harness.
 * Two providers wrap the stock bash executors and rewrite the shell source at
 * the `resolve` boundary, so workdir/timeout/env/exit-code/background-job and
 * (for the sandbox variant) confinement semantics are all inherited unchanged.
 * A command that is not eligible for wrapping (complex shell, non-whitelisted
 * tool, or a missing `rtk` binary) passes through byte-for-byte.
 *
 * @module @deeptrial/dsh-bash-rtk
 */

import { spawnSync } from 'node:child_process'
import { isAbsolute, join, resolve } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { LocalBashExecutor } from '@deepseek-ai/dsh-bash-local'
import type { Config as LocalConfig } from '@deepseek-ai/dsh-bash-local'
import { SandboxBashExecutor } from '@deepseek-ai/dsh-bash-sandbox'
import type { Config as SandboxConfig } from '@deepseek-ai/dsh-bash-sandbox'
import type { ShellExecRequest, ShellExecSpec } from '@deepseek-ai/dsh-shell'
import { wrapWithRtk } from './wrap.ts'

export { wrapWithRtk } from './wrap.ts'

/** Extend the upstream config so cordis plugin() accepts the rtk options. */
declare module '@deepseek-ai/dsh-bash-local' {
  interface Config {
    rtkAvailable?: boolean
    /** Record rtk usage (default true). False leaves `RTK_DB_PATH` alone. */
    rtkTracking?: boolean
    /** Ledger file; a relative path resolves against the session workspace. */
    rtkDbPath?: string
  }
}

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

/** Resolved ledger options. */
interface HistoryConfig {
  tracking: boolean
  dbPath?: string
}

/** Read and validate the two history options once, at plugin construction. */
function historyConfig(config: LocalConfig): HistoryConfig {
  const dbPath = config.rtkDbPath
  if (dbPath === undefined) return { tracking: config.rtkTracking ?? true }
  const trimmed = typeof dbPath === 'string' ? dbPath.trim() : ''
  if (trimmed === '') throw new Error('dsh-bash-rtk: rtkDbPath must be a non-empty string')
  return { tracking: config.rtkTracking ?? true, dbPath: trimmed }
}

/**
 * The `RTK_DB_PATH` one execution should carry, or undefined to leave rtk's
 * default alone. A `workspace-write` command can only write the session
 * workspace while rtk's default ledger lives in HOME, so the confined case
 * keeps it inside the workspace; unconfined modes can write HOME as before.
 */
function historyDbPath(spec: ShellExecSpec, history: HistoryConfig): string | undefined {
  if (!history.tracking) return undefined
  const root = spec.sandboxPolicy?.workspaceRoot ?? spec.workdir
  if (history.dbPath !== undefined) {
    return isAbsolute(history.dbPath) ? history.dbPath : resolve(root, history.dbPath)
  }
  if (process.env.RTK_DB_PATH !== undefined) return undefined
  if (spec.sandboxPolicy?.mode !== 'workspace-write') return undefined
  return join(root, '.rtk', 'history.db')
}

/** Attach the ledger path to a spec's environment without touching its command. */
function withHistory(spec: ShellExecSpec, history: HistoryConfig): ShellExecSpec {
  const dbPath = historyDbPath(spec, history)
  return dbPath === undefined ? spec : { ...spec, env: { ...spec.env, RTK_DB_PATH: dbPath } }
}

/**
 * rtk-wrapping LOCAL bash executor (no file sandbox). Registers as `ctx.shell`
 * in place of `dsh-bash-local`; use where confinement is not required (e.g.
 * `danger-full-access` deployments).
 */
export class RtkBashExecutor extends LocalBashExecutor {
  private readonly rtkAvailable: boolean
  private readonly history: HistoryConfig

  constructor(ctx: Context, config: LocalConfig) {
    super(ctx, config)
    this.rtkAvailable = config.rtkAvailable ?? resolveRtk()
    this.history = historyConfig(config)
  }

  override resolve(request: ShellExecRequest): ShellExecSpec {
    const spec = super.resolve(request)
    return withHistory({ ...spec, command: wrapWithRtk(spec.command, this.rtkAvailable) }, this.history)
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
  private readonly history: HistoryConfig

  constructor(ctx: Context, config: SandboxConfig) {
    super(ctx, config)
    this.rtkAvailable = config.rtkAvailable ?? resolveRtk()
    this.history = historyConfig(config)
  }

  override resolve(request: ShellExecRequest): ShellExecSpec {
    const spec = super.resolve(request)
    return withHistory({ ...spec, command: wrapWithRtk(spec.command, this.rtkAvailable) }, this.history)
  }
}

export default RtkSandboxBashExecutor
