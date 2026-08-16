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

## 安装与启用

插件**默认禁用** —— 安装后不会生效，需手动开启。

```sh
# 1) 从本地 checkout 安装
dsh plugin --profile web add "<path-to-this-dir>"

# 2) 或直接用最新 GitHub release tarball 安装（无需本地 clone）
dsh plugin --profile web add \
  "https://github.com/DeepTrial/dsh-bash-rtk/releases/latest/download/dsh-bash-rtk.tar.gz"

# 通过可选 overlay 启用 —— 在你的 profile 的 cordis.patch.yml 中添加：
#   - id: bash-sandbox
#     disabled: true
#   - id: bash-rtk
#     disabled: false

dsh web   # 重启以生效
```

内置的 overlay 片段位于 [`cordis.patch.yml`](cordis.patch.yml)。它会用 `RtkSandboxBashExecutor`（保留文件隔离）替换原生的沙箱执行器，并保留非隔离的 `RtkBashExecutor` 供 `danger-full-access` 场景使用。

## API / 配置

两个执行器均接受与其原生对应物（`LocalBashExecutor` / `SandboxBashExecutor`）相同的基础配置，外加一个可选字段：

| 选项 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `rtkAvailable` | `boolean` | `resolveRtk()` 结果 | 强制启用或禁用 rtk 包装。适用于测试或二进制路径非标准的部署环境。 |

其余选项 —— `cwd`、`timeoutMs`、`graceMs` 等 —— 均原样继承自上游执行器。

## 哪些命令会被路由

符合 rtk 包装条件的命令集合由 **rtk 本身**定义 —— 权威且持续维护的列表见 [rtk 命令参考](https://github.com/rtk-ai/rtk#supported-ecosystems) / [`README.md`](https://github.com/rtk-ai/rtk/blob/develop/README.md#test-runners)。本插件镜像该列表；当 rtk 新增子命令时，升级 rtk（而非本插件）即可生效。

复杂命令 —— 管道、`&&`/`;`、重定向、`$( )`、环境变量赋值 —— 无论白名单如何，始终以原生方式运行。

## 开发

```sh
# 1. 克隆插件及其依赖的 harness
git clone https://github.com/DeepTrial/dsh-bash-rtk.git
git clone https://github.com/deepseek-ai/deepseek-harness.git

# 2. 安装 harness 依赖并构建插件所链接的库
cd deepseek-harness && pnpm install && pnpm build:lib:host

# 3. 安装插件依赖并运行检查
cd ../dsh-bash-rtk && pnpm install --ignore-scripts
pnpm run check        # 类型检查 + 测试 + 构建
pnpm run test         # 仅测试
pnpm run typecheck    # 仅 tsc
```

`devDependencies` 通过 `link:` 指向本地 `deepseek-harness` 源码仓；测试需在该 workspace 内运行（`@deepseek-ai/dsh-*` 包必须可解析）。

## 许可证

MIT
