# dsh-bash-rtk

[![CI](https://github.com/DeepTrial/dsh-bash-rtk/actions/workflows/ci.yml/badge.svg)](https://github.com/DeepTrial/dsh-bash-rtk/actions/workflows/ci.yml)
[![GitHub Release](https://img.shields.io/github/v/release/DeepTrial/dsh-bash-rtk)](https://github.com/DeepTrial/dsh-bash-rtk/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://github.com/DeepTrial/dsh-bash-rtk/blob/main/LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue?logo=typescript)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D20.0.0-339933?logo=nodedotjs)](https://nodejs.org/)

> 在 DeepSeek Harness（`dsh`）的 bash 执行器里，把符合条件的 shell 命令路由给 [rtk](https://github.com/rtk-ai/rtk)（Rust Token Killer）执行 —— 压缩工具输出、省 token、其余一概不变。

[English version](README.md)

---

## 目录

- [快速示例](#快速示例)
- [环境要求](#环境要求)
- [为什么需要它](#为什么需要它)
- [工作原理](#工作原理)
- [安装与启用](#安装与启用)
- [API / 配置](#api--配置)
- [哪些命令会被路由](#哪些命令会被路由)
- [开发](#开发)
- [许可证](#许可证)

---

## 快速示例

插件在 `resolve()` 边界重写命令 —— 在实际执行之前：

| 输入 (`command`) | 解析后的输出 | 原因 |
|---|---|---|
| `git status` | `rtk git status` | 简单命令 + 在白名单内 |
| `cargo build --release` | `rtk cargo build --release` | 简单命令 + 在白名单内 |
| `git status \| grep x` | `git status \| grep x` | 复杂 shell —— **直接透传** |
| `ls -la` | `ls -la` | 不在白名单 —— **直接透传** |
| `git status`（无 rtk） | `git status` | 二进制缺失 —— **恒等回退** |

其余一切 —— 工作目录、超时、环境变量、退出码、沙箱隔离 —— 均原样继承。

## 环境要求

- **Node.js:** >= 20.0.0
- **rtk:** `rtk --version` 在 PATH 上退出码为 0（需单独安装，例如 `cargo install rtk`）

## 为什么需要它

LLM agent 在冗长的工具输出上浪费大量 token（`git log`、`cargo build`、`pytest` 输出……）。`rtk` 已知道如何把这些输出压缩 30–90%。本插件把这套过滤接到 `dsh` 的 bash 执行器上，让每个符合条件的命令自动走 `rtk` —— **且对实际运行内容零语义改动**。

## 工作原理

```
model → dsh bash 工具 → RtkBashExecutor.resolve()
                              │
              ┌───────────────┴────────────────┐
         符合条件？                        不符合条件
   （简单命令 + 在白名单内）          （复杂 / 未知命令）
              │                                │
      rtk <子命令> …                  命令原样执行
   （rtk 压缩输出）              （逐字节透传）
```

三道独立关卡决定路由（见 [`src/wrap.ts`](src/wrap.ts)）：

1. **复杂度** — 任何 shell 元字符（`| & ; < > \` $`）都会取消资格。包装这些会改变实际运行内容，故直接透传。
2. **白名单** — 仅 `rtk` 实际实现的已知开发工具才符合资格（`wrap.ts` 中的映射表）。
3. **可用性** — 若 `PATH` 上找不到 `rtk` 二进制，变换退化为**恒等**：部署行为与原始本地执行器完全一致。

### 版本说明

本插件**不捆绑、不锁定 rtk 版本**。`dsh` 启动时会探测 `PATH` 上的 `rtk --version`（见 [`src/index.ts`](src/index.ts) 的 `resolveRtk()`）。因此：

- **rtk 发布新版本时**，任何在本地升级了 `rtk` 的用户会自动获得新行为 —— 无需更新本插件。
- 本插件版本（本仓库）与 rtk 版本**相互独立**，请勿混为一谈。本说明给出的是测试所基于的*最低* rtk 版本，而非锁步版本号。

> **要求：** `rtk` 在 `PATH` 上（`rtk --version` 退出码为 0）。插件**不会**安装或管理 rtk —— **你必须自行安装并更新 rtk**（例如 `cargo install rtk` 或下载发布二进制）。当 rtk 缺失时，插件静默退化为透传。

## 兼容性与版本对齐

本插件以 `dsh` **0.2.1-alpha.1** 为验证基准，同时继续支持 `0.1.x` 线。

`dsh` 会对每个插件的安装做兼容性门禁：`@deepseek-ai/dsh-app-boot` 读取插件的 `peerDependencies`，对其中每个 `@deepseek-ai/dsh` / `@deepseek-ai/dsh-*` 条目按**当前运行中的 `dsh` 版本**执行 `semver.satisfies(runtime, range, { includePrerelease: true })`。若某个范围的所有分支都无法纳入 `0.2.1-alpha.1`（例如 `0.1.1` 版本的 `… || >=0.1.1-rc.1 <0.2.0-0`），该检查即失败，插件管理器会以 `is incompatible with dsh 0.2.1-alpha.1` 拒绝安装（除非手动通过 `dsh plugin allow-version` 授予精确版本豁免）。插件市场（marketplace）对 `engines.dsh` 与宿主 peer 采用同样的"预发布感知"判定。

现在随包发布的范围（见 `package.json` 的 `peerDependencies`）增加了显式的 `0.2.x` 分支：

```
"@deepseek-ai/dsh-bash-local":   ">=0.0.1-rc.1 <0.1.0 || >=0.1.0-rc.1 <0.1.1 || >=0.1.1-rc.1 <0.2.0-0 || >=0.2.0-0 <0.3.0-0"
"@deepseek-ai/dsh-bash-sandbox": ">=0.0.1-rc.1 <0.1.0 || >=0.1.0-rc.1 <0.1.1 || >=0.1.1-rc.1 <0.2.0-0 || >=0.2.0-0 <0.3.0-0"
"@deepseek-ai/dsh-shell":        ">=0.0.1-rc.1 <0.1.0 || >=0.1.0-rc.1 <0.1.1 || >=0.1.1-rc.1 <0.2.0-0 || >=0.2.0-0 <0.3.0-0"
```

预发布分支规则依然成立：像 `>=0.0.1-rc.1 <0.3.0` 这样"看起来很宽"的范围，在 node-semver 默认规则下会*静默*排除所有 `0.1.0-*` / `0.1.1-*` / `0.2.0-*` 预发布（只有当某比较符与候选版本同 `major.minor.patch` 元组、且自身也带预发布标签时才放行）。由于 `dsh` 的门禁与市场都以 `includePrerelease: true` 求值，上面那些显式的 `<0.x.0-0` 上界正是让 `0.2.1-alpha.1` 这类运行中的预发布版本被接受的原因。

`package.json` 同时把宿主要求声明在发现工具读取的位置：

```json
"engines": { "node": ">=20.0.0", "dsh": ">=0.1.0-rc.6 <0.2.0 || >=0.2.0-0 <0.3.0-0" }
```

（`dsh.plugin.json` 为旧版读取器镜像同一范围；`dsh` 自身读取的是 `package.json`。）

三个 `@deepseek-ai/dsh-*` peer 仍在 `peerDependenciesMeta` 中标记为 `optional`，因此它们缺失时插件仍可安装（此时退化为透传）。`@deepseek-ai/cordis` **不是** peer 依赖——它由 `dsh` 在运行时注入，这里只作为类型检查用的 dev 依赖。

**0.2 移植具体改了什么。** 执行接缝没变——插件仍然只覆写 `resolve()`，0.2 的 `ShellExecSpec` 只是多了一个 `sandboxPolicy` 字段，展开后原样透传。真正需要改的是编译期：模块说明符 `cordis` → `@deepseek-ai/cordis`（无作用域的旧别名已不存在），以及测试使用的执行器接口（`run()`/`start()` 被 `execute()` + `result()` 取代；`SandboxProvider.confine()` 变为 async 并返回 `Promise<ConfinedArgv>`；`SandboxPolicyService` 现在需要 `ctx.sessionProjections`）。

> **已知的版本错位：** `dsh`（聚合包，即 `npx @deepseek-ai/dsh` 安装的）与其 `@deepseek-ai/dsh-*` 子包处于**独立的 semver 轨道**——聚合包可能是 `0.1.1-rc.2`，而发布的子包仍是 `0.0.1-rc.1`。上述范围锁定到*已发布*的子包版本，但 `dsh` 是用**它自己的版本**去校验这些范围的，因此每条受支持的发布线都需要一个显式分支。跟进匹配更新请关注 [releases](https://github.com/DeepTrial/dsh-bash-rtk/releases)。

## 安装与启用

插件**默认禁用** —— 安装后不会生效，需手动开启。

```sh
# 1) 从本地 checkout 安装
dsh plugin --profile web add "<path-to-this-dir>"

# 2) 或直接用最新 GitHub release tarball 安装（无需本地 clone）
dsh plugin --profile web add \
  "https://github.com/DeepTrial/dsh-bash-rtk/releases/latest/download/dsh-bash-rtk-latest.tgz"

# 通过可选 overlay 启用 —— 在你的 profile 的 cordis.patch.yml 中添加：
#   - id: bash-sandbox
#     disabled: true
#   - id: bash-rtk
#     disabled: false

dsh web   # 重启以生效
```

内置的 overlay 片段位于 [`cordis.patch.yml`](cordis.patch.yml)。它会用 `RtkSandboxBashExecutor`（保留文件隔离）替换原生的沙箱执行器，并保留非隔离的 `RtkBashExecutor` 供 `danger-full-access` 场景使用。

### 查看收益：`/rtk` 命令

bundle 还会插入一个默认启用的 `bash-rtk-command` 行。在聊天中输入 `/rtk` 会打印当前会话工作区的 rtk 用量账本（`rtk gain` 的原始输出），带参数会被拒绝。账本来源优先级：环境变量 `RTK_DB_PATH` → `<会话工作区>/.rtk/history.db`（存在时）→ rtk 默认的 HOME 账本。

## API / 配置

两个执行器均接受与其原生对应物（`LocalBashExecutor` / `SandboxBashExecutor`）相同的基础配置，外加以下可选字段：

| 选项 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `rtkAvailable` | `boolean` | `resolveRtk()` 结果 | 强制启用或禁用 rtk 包装。适用于测试或二进制路径非标准的部署环境。 |
| `rtkTracking` | `boolean` | `true` | 是否把 rtk 的用量账本落到会话工作区（注入 `RTK_DB_PATH`）。`false` = 不注入。 |
| `rtkDbPath` | `string` | `<会话工作区>/.rtk/history.db` | 账本文件位置；相对路径按会话工作区解析，也可给绝对路径。显式设置时在 `danger-full-access` 下同样生效。 |

其余选项 —— `cwd`、`timeoutMs`、`graceMs` 等 —— 均原样继承自上游执行器。

**沙箱会话语义。** rtk 默认把用量记在 `~/.local/share/rtk/history.db`，而 `workspace-write` 沙箱只允许写会话工作区，因此插件默认把账本改写到 `<会话工作区>/.rtk/history.db`——这样 `rtk gain` 才有数据。`read-only`（写不了）与 `danger-full-access`（本就能写 HOME）不注入；外部已设置 `RTK_DB_PATH` 时插件不覆盖。示例：

```yaml
- id: bash-rtk
  disabled: false
  config:
    timeoutMs: 60000
    rtkTracking: true
    # rtkDbPath: .rtk/history.db   # 默认值；相对路径按会话工作区解析
```

账本按会话工作区分开，跨工作区不汇总；建议把 `.rtk/` 加进各项目的 `.gitignore`。

## 哪些命令会被路由

符合 rtk 包装条件的命令集合由 **rtk 本身**定义 —— 权威且持续维护的列表见 [rtk 命令参考](https://github.com/rtk-ai/rtk#supported-ecosystems) / [`README.md`](https://github.com/rtk-ai/rtk/blob/develop/README.md#test-runners)。本插件镜像该列表；当 rtk 新增子命令时，升级 rtk（而非本插件）即可生效。

复杂命令 —— 管道、`&&`/`;`、重定向、`$( )`、环境变量赋值 —— 无论白名单如何，始终以原生方式运行。

## 开发

```sh
# 1. 克隆插件
git clone https://github.com/DeepTrial/dsh-bash-rtk.git

# 2. 安装插件构建所依赖的已发布 harness 包
cd dsh-bash-rtk && pnpm install --ignore-scripts

# 3. 运行检查
pnpm run check        # 类型检查 + 测试 + 构建
pnpm run test         # 仅测试
pnpm run typecheck    # 仅 tsc
```

`devDependencies` 固定到插件构建与测试所依赖的已发布 `@deepseek-ai/dsh-*` / `@deepseek-ai/cordis`
版本（当前为 `0.2.1-alpha.1` 线），不再需要同级的 `deepseek-harness` 源码仓。

## 许可证

MIT
