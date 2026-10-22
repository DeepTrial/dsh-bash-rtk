/**
 * `dsh-bash-rtk` command half: the `/rtk` slash command that prints the
 * workspace's rtk savings ledger. It is mounted as its own row so the shell
 * executors stay pure; the report is `rtk gain`'s own text.
 */
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

export const name = 'dsh-bash-rtk-command'
/** Commands service mounted by `@deepseek-ai/dsh-commands`. */
export const inject = ['commands']

/** The invocation fields this command reads (structural, no runtime dependency). */
interface CommandInvocation {
  readonly rawInput: string
  readonly agent: { readonly session: { readonly header: { readonly cwd?: string } } }
}

type CommandResult = { kind: 'success'; text?: string } | { kind: 'error'; text: string }

interface CommandRegistry {
  register(definition: {
    name: string
    description: string
    recordInput?: boolean
    handler: (invocation: CommandInvocation) => CommandResult | Promise<CommandResult>
  }): () => void
}

/**
 * The ledger the executors write for this session. Undefined means "leave
 * rtk's default alone": an operator-set `RTK_DB_PATH` wins, then the
 * workspace ledger, then rtk's own HOME path.
 */
function ledgerPath(cwd: string | undefined): string | undefined {
  const configured = process.env.RTK_DB_PATH
  if (configured !== undefined && configured !== '') return configured
  if (cwd === undefined) return undefined
  const candidate = join(cwd, '.rtk', 'history.db')
  return existsSync(candidate) ? candidate : undefined
}

/** Run `rtk gain` against this session's ledger and return its report verbatim. */
function gain(cwd: string | undefined): CommandResult {
  const ledger = ledgerPath(cwd)
  const result = spawnSync('rtk', ['gain'], {
    encoding: 'utf8',
    env: ledger === undefined ? process.env : { ...process.env, RTK_DB_PATH: ledger },
  })
  if (result.error !== undefined) return { kind: 'error', text: `rtk gain failed: ${result.error.message}` }
  const output = (result.stdout ?? '').trimEnd()
  if (result.status !== 0) {
    return {
      kind: 'error',
      text: (result.stderr ?? '').trim() || output || `rtk gain exited with ${String(result.status)}`,
    }
  }
  return { kind: 'success', text: output }
}

/** Register `/rtk`; this module takes no config. */
export function apply(ctx: { commands: CommandRegistry }): void {
  ctx.commands.register({
    name: 'rtk',
    description: 'Show rtk token savings for this workspace',
    recordInput: false,
    handler: (invocation) => {
      if (invocation.rawInput.trim() !== '') return { kind: 'error', text: 'Usage: /rtk (no arguments)' }
      return gain(invocation.agent.session.header.cwd)
    },
  })
}
