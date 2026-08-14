# @karlx/dsh-bash-rtk

> Route eligible shell commands through [rtk](https://github.com/rtk-ai/rtk) (Rust Token Killer) inside the DeepSeek Harness (`dsh`) bash executor — compress tool output, save tokens, change nothing else.

---

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

> **Requires:** `rtk` ≥ 0.28 on `PATH` (`rtk --version` exits 0). Without it, the plugin is a no-op passthrough.

## Install & enable

The plugin is **disabled by default** — installing it does nothing until you opt in.

```sh
# add the plugin to your dsh profile (path / tarball / github)
dsh plugin --profile web add <path-to-this-dir>

# enable it via an optional overlay — add to your profile's cordis.patch.yml:
#   - id: bash-sandbox
#     disabled: true
#   - id: bash-rtk
#     disabled: false

dsh web   # restart to apply
```

The bundled overlay snippet lives in [`cordis.patch.yml`](cordis.patch.yml). It swaps the stock sandbox executor for `RtkSandboxBashExecutor` (file confinement preserved) and leaves the unconfined `RtkBashExecutor` available for `danger-full-access` setups.

## Whitelisted commands

`git` `gh` `glab` `gt` `cargo` `go` `golangci-lint` `npm` `npx` `pnpm` `docker` `kubectl` `aws` `ruff` `pytest` `mypy` `uv` `dotnet` `jest` `vitest` `prisma` `tsc` `playwright` `curl` `wget` `grep` `rg` `find` `psql` `mvn` `gradlew` `sbt` `pip` `rspec` `rubocop` `rake` `php` `phpunit` `phpstan` `pint` `pest` `next`

Complex commands — pipelines, `&&`/`;`, redirects, `$( )`, env assignments — always run natively regardless of the whitelist.

## Development

```sh
pnpm install && pnpm run check    # typecheck + test + build
```

`devDependencies` use `link:` into a local `deepseek-harness` checkout; tests run inside that workspace (the `@deepseek-ai/dsh-*` packages must resolve).

## License

MIT
