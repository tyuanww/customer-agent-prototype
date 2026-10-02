# 文档、开发体验、架构与仓库安全审计

审计日期：2026-10-02～2026-10-03。范围是当前 `main@4739c39` 的产品实施仓、公开 GitHub 仓库和已写入仓库的开发/运维边界。本轮不打包、不发布、不探测真实客户数据，也不删除用户未跟踪的 `TODO.md`。

## 文档结论

文档入口和生命周期是完整的：README 负责发现，`CONTRIBUTING.md` 负责新贡献者路径，`docs/reference-engineering-workflow.md` 负责阶段与证据复用，`docs/reference-project-architecture.md` 负责模块所有权，`docs/reference-document-lifecycle.md` 负责产品仓与项目记录仓的边界，`docs/plans/README.md` 负责历史计划索引。

本轮做了三项事实同步：

- README 的审计入口指向本页；数据库当前目录从 `0001..0014` 修正为 `0001..0019`，合同 runtime schema 数从 150 修正为 165。
- 架构参考更新到 `v0.3.26 / main@4739c39`、可由该提交在 GitHub Actions 追溯的 CI 记录、ARCH-01～04 和当前 CodeGraph 状态，并记录仍保留的主状态机耦合。
- `docs/plans/README.md` 的审查材料数量从 2 修正为 4。

`document-release` 和 `document-generate` 的覆盖检查没有发现“零文档覆盖”的新公共命令、API 或模块；当前入口页、参考页、how-to、教程和 RFC 已能覆盖现有公开面，因此没有凭空新建一批重复文档。历史计划按仓库生命周期规则只增不删；本轮没有删除文档。`pnpm docs:check` 通过：168 个 Markdown、链接和 workflow 入口均通过。

## 开发者体验审计

Aside 浏览器探针返回 CLI error，未把网页体验伪装成已测试；改用仓库 CLI 和文件证据完成可测试部分。

| 维度 | 评分 | 证据 |
| --- | ---: | --- |
| Getting Started | 8/10 | README、`docs/tutorial-first-run.md`、`pnpm help:dev` |
| API / CLI | 8/10 | 根脚本、命令别名和错误入口清楚 |
| 错误信息 | 8/10 | `ERR_PNPM_NO_SCRIPT` 后可直接运行 `pnpm help:dev` |
| 文档结构 | 8/10 | README 表、贡献入口、reference/how-to/tutorial 互链 |
| 升级路径 | 8/10 | CHANGELOG、未签名包边界和签名参考 |
| 开发环境 | 9/10 | Node 24、pnpm 11.19.0、冻结安装、架构门 |
| 社区协作 | 4/10 | GitHub Issue 模板存在，但没有独立社区运行手册 |
| 反馈指标 | 3/10 | 有检查和审计记录，没有稳定 TTHW / 文档行为指标 |

整体评分为 `7/10`。清洁机器的完整安装到桌面首帧没有计时，因此 TTHW 保持“未测”。本地已验证 `pnpm help:dev`、未知脚本错误路径、`pnpm docs:check`、`pnpm check:architecture` 和空间清理预览。

## CSO 安全审计

CSO 本轮审计已完成。状态为 `finished`，完整度为 `partial`，支持 findings 数为 `0`；运行记录保留在本机审计状态中：

> No supported findings in the assessed scope.

已静态检查 API body limit / 错误归一化、Electron window/sender 安全、CI 权限与 SHA 固定、生产 supervisor/watchdog unit、合同和数据库边界。没有调用真实身份提供商、没有连接生产业务接口、没有安装依赖或运行 Docker 扫描器。

`partial` 的具体原因：

- 当前机器没有 linux/arm64 的合格 OSV、zizmor 等扫描镜像，也没有 CSO 需要的 Docker 隔离；
- helper 的 bounded Git history 读取超过输出上限，因此历史密钥暴露没有完成闭环；
- 没有主动探测 Cloudflare/Tailscale、公网 TLS、真实 Feishu/MiniMax 或办公机；
- `customer-agent-stack.service` 的 hardening 少于 watchdog unit，但本轮没有足够证据把它定为可利用漏洞。

这是一份有范围的静态审计，不是全量安全认证。生产 unit hardening、远端隧道和依赖 advisory 是后续独立安全任务的入口。

## 远程仓库与文件清理

GitHub 仓库为公开仓库，默认分支 `main`，当前没有 open PR。远端分支为 `main`、`gh-pages` 和 `codex/docs-version-sync`；后者与 `main` 已分叉（ahead 1 / behind 4），没有关联 open PR，是唯一明确的远端分支清理候选。`gh-pages` 仍承担页面发布，不删除。由于删除远端分支是不可逆的仓库状态变更，本轮只记录候选，没有执行删除。

远端 tags/releases 仍是 `v0.3.24` 和 `v0.3.25`。源码 `VERSION` 已为 `0.3.26`，但这轮没有打包或创建新 release，所以“GitHub 最新安装包仍显示 0.3.25”是当前预期，不是仓库代码回退。

已检查的 tracked 大文件主要是 canonical 品牌资产、不可变合同快照、生成 migration、历史 QA 截图和锁文件；它们分别承担运行时、provenance 或审计证据，不是可安全删除的临时文件。没有发现被 Git 跟踪的 `node_modules`、`dist`、`release`、`.zip`、安装包、`latest.yml` 或 `app-update.yml`。历史 plans 与 evidence 按生命周期规则保留；本轮没有删除仓库文件。

## 架构与可扩展性

当前架构适合继续开发，原因是每层有不同职责，且 `pnpm check:architecture` 对 303 个源码/配置文件报告 0 个违规：

- Electron / OS / BrowserWindow / IPC sender 由 `apps/desktop/src/main` 拥有；preload 是窄白名单；renderer 不拿 Node、Electron 或数据库权限。
- `apps/desktop/src/shared` 只放跨边界类型、validator、几何和纯函数；`@customer-agent/retrieval-core` 只做 BM25、RRF、余弦、分词和门槛，不读产品数据。
- `packages/contracts` 只编译受锁 OpenAPI 快照；`packages/database` 只拥有 migration control plane；API 的 runtime/admin pool、路由和产品授权留在 `apps/api`。
- ARCH-01～04 已把依赖门、检索算法、API 配置/feature 边界和桌面叶子组件整理出来；主状态机仍集中在 `overlay-controller.ts`、`QueryApp.tsx`、`DashboardApp.tsx`，这是为了保持时序、焦点、handoff 和导航不变量，不是遗漏。

剩余耦合有明确产品语义：桌面检索 adapter 绑定发布租约，API `server.ts` 组合本项目路由，真实数据和第二个项目消费者尚未出现。合同 runtime、Migration control plane、安全纯机制三份 RFC 都保持 `DRAFT · 等待第二个真实消费者`；以后出现第二个真实项目时，先写本地 adapter 和对照测试，再决定是否提取 workspace 包。

CodeGraph 已写好并可用：仓根存在 `.codegraph/`，本机 `codegraph` CLI 为 1.6.0，MCP `codegraph_explore` 本轮成功返回跨模块调用路径和 blast radius。索引属于本机工具状态，不进 Git；改代码前先用 CodeGraph，索引滞后时按 `AGENTS.md` 规则降级到定向源码检查。

## 后续开发方式

后续功能从 GitHub `main` 拉到本地分支或独立 worktree，在本地 Node 24 / pnpm 11.19.0 环境开发；提交前按受影响范围运行文档、架构、lint、typecheck、test 或 build。WSL 的 `/srv/customer-agent/current` 继续只作为生产 release 软链，测试使用独立 `43180/43181`，生产使用 `43115/43116`。只有形成完整、可审阅候选并获得对应 Git/部署授权后，才进入 commit、push、merge、package 或 deploy。

本轮修改集中在 README、架构参考、plans 索引和本审计记录；没有提交、推送、合并、发布或远端删除。
