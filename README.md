# dsh-bash-rtk

[![CI](https://github.com/DeepTrial/dsh-bash-rtk/actions/workflows/ci.yml/badge.svg)](https://github.com/DeepTrial/dsh-bash-rtk/actions/workflows/ci.yml)
[![GitHub Release](https://img.shields.io/github/v/release/DeepTrial/dsh-bash-rtk)](https://github.com/DeepTrial/dsh-bash-rtk/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://github.com/DeepTrial/dsh-bash-rtk/blob/main/LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue?logo=typescript)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D20.0.0-339933?logo=nodedotjs)](https://nodejs.org/)

> Route eligible shell commands through [rtk](https://github.com/rtk-ai/rtk) (Rust Token Killer) inside the DeepSeek Harness (`dsh`) bash executor — compress tool output, save tokens, change nothing else.

[中文版](README.zh.md)

---

## Table of Contents

- [Quick Example](#quick-example)
- [Requirements](#requirements)
- [Why](#why)
- [How it works](#how-it-works)
- [Install & enable](#install--enable)
- [API / Configuration](#api--configuration)
- [Which commands are routed](#which-commands-are-routed)
- [Development](#development)
- [License](#license)

---

## Quick Example

The plugin rewrites commands at the `resolve()` boundary — before anything runs:

| Input (`command`) | Resolved output | Reason |
|---|---|---|
| `git status` | `rtk git status` | Simple + whitelisted |
| `cargo build --release` | `rtk cargo build --release` | Simple + whitelisted |
| `git status \| grep x` | `git status \| grep x` | Complex shell — **passthrough** |
| `ls -la` | `ls -la` | Not whitelisted — **passthrough** |
| `git status` (rtk absent) | `git status` | Binary missing — **identity fallback** |

Everything else — workdir, timeout, env, exit code, sandbox confinement — is inherited unchanged.

## Requirements

- **Node.js:** >= 20.0.0
- **rtk:** `rtk --version` must exit 0 on PATH (install separately, e.g. `cargo install rtk`)

## Why

LLM agents burn tokens on verbose tool output (`git log`, `cargo build`, `pytest` trails…). `rtk` already knows how to shrink those for 30–90%. This plugin bolts that filtering onto `dsh`'s bash executor so every eligible command is auto-routed through `rtk` — **with zero semantic change** to what actually runs.

## How it works

```
model → dsh bash tool → RtkBashExecutor.resolve()
                              │
              ┌───────────────┴────────────────┐
         eligible?                         not eligible
     (simple + whitelisted)           (complex / unknown)
              │                                │
      rtk <subcommand> …              command runs unchanged
   (rtk compresses output)            (byte-for-byte passthrough)
```

Three independent guards decide (see [`src/wrap.ts`](src/wrap.ts)):

1. **Complexity** — any shell metacharacter (`| & ; < > \` $`) disqualifies the command. Wrapping those would silently alter what runs, so they pass through untouched.
2. **Whitelist** — only known dev tools that `rtk` actually implements are eligible (map in `wrap.ts`).
3. **Availability** — if the `rtk` binary is absent on `PATH`, the transform is the **identity**: the deployment behaves exactly like the stock local executor.

### Versioning note

The plugin **does not bundle or pin rtk**. At `dsh` startup it probes `rtk --version` on `PATH` (see `resolveRtk()` in [`src/index.ts`](src/index.ts)). Therefore:

- When **rtk ships a new release**, any user who upgrades `rtk` on their machine automatically gets the new behavior — no plugin update required.
- The plugin version (this repo) and the rtk version are **independent**; keep them separate. This README states the *minimum* rtk version tested against, not a lockstep number.

> **Requires:** `rtk` on `PATH` (`rtk --version` exits 0). The plugin does **not** install or manage rtk — **you must install and update rtk yourself** (e.g. `cargo install rtk` or download a release binary). When rtk is absent the plugin is a silent no-op passthrough.

### Compatibility & version alignment

The plugin is verified against `dsh` **0.2.1-alpha.1** and keeps the `0.1.x` line working.

`dsh` gates the installation of every plugin: `@deepseek-ai/dsh-app-boot` reads the plugin's
`peerDependencies` and checks each `@deepseek-ai/dsh` / `@deepseek-ai/dsh-*` entry against the
**running `dsh` version** with `semver.satisfies(runtime, range, { includePrerelease: true })`.
A range whose branches cannot admit `0.2.1-alpha.1` — e.g. the `0.1.1` release's
`… || >=0.1.1-rc.1 <0.2.0-0` — fails that check, and the plugin manager refuses the install with
`is incompatible with dsh 0.2.1-alpha.1` (unless a manual `dsh plugin allow-version` exact-version
exemption is granted). The marketplace applies the same prerelease-aware reading of `engines.dsh`
and the host peers.

The ranges shipped now (see `peerDependencies` in `package.json`) add an explicit `0.2.x` branch:

```
"@deepseek-ai/dsh-bash-local":   ">=0.0.1-rc.1 <0.1.0 || >=0.1.0-rc.1 <0.1.1 || >=0.1.1-rc.1 <0.2.0-0 || >=0.2.0-0 <0.3.0-0"
"@deepseek-ai/dsh-bash-sandbox": ">=0.0.1-rc.1 <0.1.0 || >=0.1.0-rc.1 <0.1.1 || >=0.1.1-rc.1 <0.2.0-0 || >=0.2.0-0 <0.3.0-0"
"@deepseek-ai/dsh-shell":        ">=0.0.1-rc.1 <0.1.0 || >=0.1.0-rc.1 <0.1.1 || >=0.1.1-rc.1 <0.2.0-0 || >=0.2.0-0 <0.3.0-0"
```

The prerelease-branch rule still applies: a broad `>=0.0.1-rc.1 <0.3.0` would *silently* exclude
every `0.1.0-*` / `0.1.1-*` / `0.2.0-*` prerelease under node-semver's default rules (a prerelease
only satisfies a range when some comparator shares its exact `major.minor.patch` tuple *and* also
carries a prerelease tag). Because `dsh`'s gate — and the marketplace — evaluate ranges with
`includePrerelease: true`, those explicit `<0.x.0-0` upper bounds are exactly what admit a running
prerelease such as `0.2.1-alpha.1`.

`package.json` also declares the host requirement where discovery tools read it:

```json
"engines": { "node": ">=20.0.0", "dsh": ">=0.1.0-rc.6 <0.2.0 || >=0.2.0-0 <0.3.0-0" }
```

(`dsh.plugin.json` mirrors the same range for older readers; `dsh` itself reads `package.json`.)

All three `@deepseek-ai/dsh-*` peers stay `optional` in `peerDependenciesMeta`, so the plugin still
installs where they are absent (it then behaves as a passthrough). `@deepseek-ai/cordis` is **not** a
peer dependency — `dsh` injects it at runtime; it is only a dev dependency for typechecking.

**What the 0.2 port changed.** The execution seam is unchanged — the plugin still only overrides
`resolve()`, and the 0.2 `ShellExecSpec` merely gains a `sandboxPolicy` field that is spread through
untouched. The compile-time fixes are the module specifier (`cordis` → `@deepseek-ai/cordis`; the
unscoped alias no longer exists) and the executor surface the tests use (`run()`/`start()` were
replaced by `execute()` plus `result()`; `SandboxProvider.confine()` is now async and returns
`Promise<ConfinedArgv>`; `SandboxPolicyService` now requires `ctx.sessionProjections`).

> **Known version skew:** `dsh` (the aggregate, what `npx @deepseek-ai/dsh` installs) and its
> `@deepseek-ai/dsh-*` sub-packages are on **separate semver tracks** — the aggregate can be
> `0.1.1-rc.2` while the published sub-packages are still `0.0.1-rc.1`. The ranges above pin to the
> *published* sub-package versions but are checked by `dsh` against its **own** version, so every
> supported release line needs its own explicit branch. Watch the
> [releases](https://github.com/DeepTrial/dsh-bash-rtk/releases) for a matching update.

## Install & enable

The plugin is **disabled by default** — installing it does nothing until you opt in.

```sh
# 1) from a local checkout
dsh plugin --profile web add "<path-to-this-dir>"

# 2) or directly from the latest GitHub release tarball (no local clone needed)
dsh plugin --profile web add \
  "https://github.com/DeepTrial/dsh-bash-rtk/releases/latest/download/dsh-bash-rtk-latest.tgz"

# enable it via an optional overlay — add to your profile's cordis.patch.yml:
#   - id: bash-sandbox
#     disabled: true
#   - id: bash-rtk
#     disabled: false

dsh web   # restart to apply
```

The bundled overlay snippet lives in [`cordis.patch.yml`](cordis.patch.yml). It swaps the stock sandbox executor for `RtkSandboxBashExecutor` (file confinement preserved) and leaves the unconfined `RtkBashExecutor` available for `danger-full-access` setups.

### Inspect savings: the `/rtk` command

The bundle also inserts a `bash-rtk-command` row, enabled by default. Typing `/rtk` in chat prints the current session workspace's rtk usage ledger (the raw `rtk gain` report); arguments are rejected. Ledger source order: `RTK_DB_PATH` from the environment → `<session workspace>/.rtk/history.db` when it exists → rtk's default HOME ledger.

## API / Configuration

Both executors accept the same base config as their stock counterparts (`LocalBashExecutor` / `SandboxBashExecutor`) plus these optional fields:

| Option | Type | Default | Description |
|---|---|---|---|
| `rtkAvailable` | `boolean` | `resolveRtk()` result | Force-enable or force-disable rtk wrapping. Useful for tests or deployments where the binary path is non-standard. |
| `rtkTracking` | `boolean` | `true` | Write rtk's usage ledger inside the session workspace (injects `RTK_DB_PATH`). `false` leaves the environment alone. |
| `rtkDbPath` | `string` | `<session workspace>/.rtk/history.db` | Ledger file; a relative path resolves against the session workspace, an absolute one is used as-is. When set explicitly it also applies under `danger-full-access`. |

All other options — `cwd`, `timeoutMs`, `graceMs`, etc. — are inherited unchanged from the upstream executors.

**Sandbox sessions.** rtk records usage in `~/.local/share/rtk/history.db`, but a `workspace-write` sandbox may only write the session workspace, so the plugin redirects the ledger to `<session workspace>/.rtk/history.db` by default — otherwise `rtk gain` stays empty. `read-only` (cannot write) and `danger-full-access` (HOME is writable already) are left alone, and an operator-provided `RTK_DB_PATH` is never overridden. Example:

```yaml
- id: bash-rtk
  disabled: false
  config:
    timeoutMs: 60000
    rtkTracking: true
    # rtkDbPath: .rtk/history.db   # the default; relative to the session workspace
```

The ledger is per workspace; add `.rtk/` to each project's `.gitignore`.

## Which commands are routed

The set of commands eligible for rtk-wrapping is defined by **rtk itself** — see the [rtk command reference](https://github.com/rtk-ai/rtk#supported-ecosystems) / [`README.md`](https://github.com/rtk-ai/rtk/blob/develop/README.md#test-runners) for the authoritative, maintained list. This plugin mirrors that list; when rtk adds a new subcommand, upgrade rtk (not this plugin) to pick it up.

Complex commands — pipelines, `&&`/`;`, redirects, `$( )`, env assignments — always run natively regardless of the whitelist.

## Development

```sh
# 1. clone the plugin
git clone https://github.com/DeepTrial/dsh-bash-rtk.git

# 2. install the released harness packages the plugin builds against
cd dsh-bash-rtk && pnpm install --ignore-scripts

# 3. run checks
pnpm run check        # typecheck + test + build
pnpm run test         # tests only
pnpm run typecheck    # tsc only
```

`devDependencies` pin the published `@deepseek-ai/dsh-*` / `@deepseek-ai/cordis` releases the plugin
builds and tests against (currently the `0.2.1-alpha.1` line); no sibling `deepseek-harness` checkout
is required.

## License

MIT
