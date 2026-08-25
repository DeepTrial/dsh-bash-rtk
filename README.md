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

This plugin depends on three `@deepseek-ai/dsh-*` packages that DeepSeek Harness publishes to npm **independently** from the `dsh` aggregate package. Because those sub-packages (and `dsh` itself) ship as **prereleases** (`x.y.z-rc.n`), the peer ranges must carry an explicit prerelease branch per [awesome-dsh-plugin/contributing.md](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/blob/main/contributing.md) — a broad-looking range like `>=0.0.1-rc.1 <0.2.0` would *silently* exclude every `0.1.0-*` / `0.1.1-*` prerelease (node-semver only lets a prerelease satisfy a range if some comparator shares its exact `major.minor.patch` tuple and also carries a prerelease tag).

The actual ranges (see `peerDependencies` in `package.json`) are:

```
"@deepseek-ai/dsh-bash-local":   ">=0.0.1-rc.1 <0.1.0 || >=0.1.0-rc.1 <0.1.1 || >=0.1.1-rc.1 <0.2.0-0"
"@deepseek-ai/dsh-bash-sandbox": ">=0.0.1-rc.1 <0.1.0 || >=0.1.0-rc.1 <0.1.1 || >=0.1.1-rc.1 <0.2.0-0"
"@deepseek-ai/dsh-shell":        ">=0.0.1-rc.1 <0.1.0 || >=0.1.0-rc.1 <0.1.1 || >=0.1.1-rc.1 <0.2.0-0"
```

`cordis` is **not** a peer dependency: it is injected by `dsh` at runtime, so declaring it would break install for anyone on a registry that lacks a matching published `cordis`. All three `@deepseek-ai/dsh-*` peers are marked `optional` in `peerDependenciesMeta`, so the plugin still loads where they are absent (it then behaves as a passthrough).

The plugin's `dsh.plugin.json` declares:

```json
"engines": { "dsh": ">=0.1.0-rc.6 <0.2.0 || >=0.1.1-rc.1 <0.2.0-0" }
```

i.e. it is verified against `dsh` `0.1.1-rc.2`, accepts any `0.1.x` prerelease/build, and deliberately **excludes** `0.2.0+` (a future major that may change the `LocalBashExecutor.resolve()` / `ShellExecSpec` API — a sub-package bump will be required before this plugin can track it).

> **Known version skew:** `dsh` (the aggregate, what `npx @deepseek-ai/dsh` installs) and its `@deepseek-ai/dsh-*` sub-packages are on **separate semver tracks** — the aggregate can be `0.1.1-rc.2` while the published sub-packages are still `0.0.1-rc.1`. The ranges above pin to the *published* sub-package versions so a plain `dsh plugin add` resolves cleanly. Watch the [releases](https://github.com/DeepTrial/dsh-bash-rtk/releases) for a matching update.

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

## API / Configuration

Both executors accept the same base config as their stock counterparts (`LocalBashExecutor` / `SandboxBashExecutor`) plus one optional field:

| Option | Type | Default | Description |
|---|---|---|---|
| `rtkAvailable` | `boolean` | `resolveRtk()` result | Force-enable or force-disable rtk wrapping. Useful for tests or deployments where the binary path is non-standard. |

All other options — `cwd`, `timeoutMs`, `graceMs`, etc. — are inherited unchanged from the upstream executors.

## Which commands are routed

The set of commands eligible for rtk-wrapping is defined by **rtk itself** — see the [rtk command reference](https://github.com/rtk-ai/rtk#supported-ecosystems) / [`README.md`](https://github.com/rtk-ai/rtk/blob/develop/README.md#test-runners) for the authoritative, maintained list. This plugin mirrors that list; when rtk adds a new subcommand, upgrade rtk (not this plugin) to pick it up.

Complex commands — pipelines, `&&`/`;`, redirects, `$( )`, env assignments — always run natively regardless of the whitelist.

## Development

```sh
# 1. clone the plugin and its sibling harness
git clone https://github.com/DeepTrial/dsh-bash-rtk.git
git clone https://github.com/deepseek-ai/deepseek-harness.git

# 2. install harness deps and build the libraries the plugin links against
cd deepseek-harness && pnpm install && pnpm build:lib:host

# 3. install plugin deps and run checks
cd ../dsh-bash-rtk && pnpm install --ignore-scripts
pnpm run check        # typecheck + test + build
pnpm run test         # tests only
pnpm run typecheck    # tsc only
```

`devDependencies` use `link:` into the local `deepseek-harness` checkout; tests run inside that workspace (the `@deepseek-ai/dsh-*` packages must resolve).

## License

MIT
