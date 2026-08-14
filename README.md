# dsh-bash-rtk

DeepSeek Harness 的 bash 执行器插件：把符合条件的 bash 命令交给 [rtk](https://github.com/rtk-ai/rtk)（Rust Token Killer）执行，压缩工具输出、省 token。

- **透明**：继承官方 bash 执行器，只在 `resolve` 边界改写命令字符串。workdir / timeout / env / exit code / 后台任务 / 文件沙箱语义全部不变。
- **保守**：含管道、`&&`、`;`、重定向、`$( )` 的复杂命令原样执行，不破坏 shell 语义；只有白名单里的简单命令才走 rtk。
- **安全降级**：`rtk` 不在 PATH 时整个插件退化为恒等透传，命令照常执行。
- **两个变体**：`RtkBashExecutor`（无沙箱）和 `RtkSandboxBashExecutor`（保留文件隔离，默认）。

## 安装

```sh
dsh plugin --profile web add <path-to-this-dir>   # 或 tarball / github
```

插件默认 **disabled**，装完不生效。

## 启用（可选 overlay）

在你的 profile 的 `cordis.patch.yml` 里加：

```yaml
- id: bash-sandbox
  disabled: true
- id: bash-rtk
  disabled: false
```

重启 `dsh web` 生效。要求 `rtk` 二进制在 PATH 上（`rtk --version` 可运行）。

## 白名单命令

git、gh、glab、gt、cargo、go、golangci-lint、npm、npx、pnpm、docker、kubectl、aws、ruff、pytest、mypy、uv、dotnet、jest、vitest、prisma、tsc、playwright、curl、wget、grep、rg、find、psql、mvn、gradlew、sbt、pip、rspec、rubocop、rake、php、phpunit、phpstan、pint、pest、next。

## 开发

```sh
pnpm install && pnpm run check    # typecheck + test + build
```

`devDependencies` 用 `link:` 指向本地 `deepseek-harness` 源码仓（`../deepseek-harness/...`），测试需要 workspace 内的 `@deepseek-ai/dsh-*` 包。
