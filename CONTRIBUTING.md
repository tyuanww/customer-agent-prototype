# 如何给本仓做改动

第一次把狐狸头跑起来，跟 [tutorial-first-run](docs/tutorial-first-run.md)。下面是贡献约定：命令、检查、提问。

## 本机

需要 **Node.js 24.x** 与 **pnpm 11.19.0**（见 `packageManager` 与 `.nvmrc`）。

```bash
cd /path/to/customer-agent-prototype
export PATH="$HOME/homebrew/opt/node@24/bin:$HOME/homebrew/bin:$PATH"
hash -r
node -v    # v24.x
pnpm -v    # 11.19.x
pnpm install --frozen-lockfile
pnpm electron:install
pnpm start    # 与 pnpm dev 相同
```

macOS 已装好依赖时，也可双击仓根 [`启动客服Agent.command`](启动客服Agent.command)。成功标志：桌面出现约 88px 透明狐狸头。逐步核验见教程第 3 步。

企业 CA 只适用于**当前这台**被拦截 TLS 的开发机，不是通用前置。禁止关闭 TLS 验证。

## 远端开发、测试与交付

代码从 GitHub 拉到本地工作树或独立 worktree 后再修改。Windows WSL 上的 `/srv/customer-agent/current` 是生产 release 的软链，不是编辑器工作区；不要在里面 `git pull`、切分支或直接改文件。

日常顺序是：本地分支开发 → Node 24 + pnpm 11.19.0 检查 → 合成测试 → WSL 临时测试端口 `43180/43181` → 停测试 unit 并复核生产 `43115/43116` → 只有获得部署授权后，按 Git SHA 创建新 release、安装冻结依赖、构建服务并切换 `current`。生产 API 和口令服务只监听 `127.0.0.1`，测试客户端不能指向生产端口。

具体命令、账号初始化失败排查、Windows 包证据和远端磁盘清理边界见 [远端开发与交付](docs/how-to-remote-development-and-deployment.md)、[运行环境与发布目录参考](docs/reference-runtime-ports-and-release-layout.md) 和 [环境边界说明](docs/explanation-environment-boundaries.md)。

## 命令找不到时

`pnpm` 对未知脚本只报 `ERR_PNPM_NO_SCRIPT` / `Missing script`，不会列出下一步。这时：

```bash
pnpm help:dev    # 黄金路径 + 常见别名
pnpm run         # 仓根全部脚本
```

日常入口是 `pnpm dev`（别名 `pnpm start`）。根脚本没有 serve 或 desktop 这种名字。按「要证明什么」选命令时打开 [如何验证桌面](docs/how-to-verify-desktop.md)。

## 改完怎么证明

| 你改了什么 | 至少跑 |
| --- | --- |
| 文档、链接、命令名 | `pnpm docs:check` 与 `git diff --check` |
| 桌面 TypeScript / 合同形状 | `pnpm typecheck` |
| 桌面局部行为 | 对应 `pnpm --filter @customer-agent/desktop exec vitest run <files>` |
| 跨模块或准备交付 | `pnpm lint`、`pnpm typecheck`、`pnpm test` |

Health stack 与授权边界见 [AGENTS.md](AGENTS.md) 第 6 节。不要把「测试文件存在」写成通过。

## 文档放哪

现行 how-to / 教程 / 参考 / 说明从 [README 文档表](README.md#文档) 进入。历史计划只增不删，索引在 [docs/plans/README.md](docs/plans/README.md)。文档生命周期见 [reference-document-lifecycle.md](docs/reference-document-lifecycle.md)。

## 提问与反馈

- 代码或窗口行为不对：GitHub Issue 模板 **缺陷**
- README / 教程 / CHANGELOG 与代码不一致：模板 **文档**
- 提交 PR 用仓库的 pull request 模板（结论 / 验证 / 未做 / 边界）

不要在 issue 里贴飞书 token、真实客户原文或未脱敏内部链接。
