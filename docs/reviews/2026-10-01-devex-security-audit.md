# 开发体验与远端安全审计

审计日期：2026-10-01。范围包括当前 GitHub 仓库、Mac 开发入口、Windows WSL 远端端口和发布目录。首轮诊断为只读；在用户明确授权后，按下文范围完成了远端发布目录清理，并复核生产服务。

## 开发体验审计

Aside readiness probe 未返回可用状态，因此网页检查使用 gstack 自带 headless browser；本地命令和仓库文件按实际执行记录。GitHub README 页面返回 `200`，文档目录可见，浏览器控制台没有错误。原始截图保存在本次本地审计临时目录，不提交到仓库。

| 维度 | 分数 | 证据 | 方法 |
| --- | ---: | --- | --- |
| Getting Started | 7/10 | README、`docs/tutorial-first-run.md`、`pnpm help:dev` | 网页实测 + 本地实测 |
| API / CLI / SDK | 8/10 | `pnpm help:dev` 清楚说明 `dev/start`、验证命令和错误入口 | 本地实测 |
| 错误信息 | 7/10 | `ERR_PNPM_NO_SCRIPT` 可复现；README 给出 `pnpm help:dev` 修复路径 | 本地实测 |
| 文档结构 | 8/10 | README 文档表、GitHub 页面链接和新增四份入口文档 | 网页实测 + 文件检查 |
| 升级路径 | 8/10 | `CHANGELOG.md`、`reference-packaging-and-signing.md`、未签名包边界 | 文件检查 |
| 开发环境 | 8/10 | Node 24 / pnpm 11.19.0、`.nvmrc`、CI 的 Node 24 和冻结安装 | 文件检查 |
| 社区与协作 | 4/10 | 公共 GitHub 仓库、Issue 模板；没有专门的 Discussions / 社区运行手册 | 网页实测 + 文件检查 |
| DX 反馈指标 | 3/10 | 有缺陷/文档模板和测试，但没有 TTHW 或文档行为指标 | 文件检查 |

整体评分：`6.6/10`，四舍五入为 `7/10`。

TTHW 本轮没有在清洁机器上完成“安装依赖 → 安装 Electron → 启动桌面”的完整计时，因此不伪造分钟数。已经实测的开发者路径是：版本检查、`pnpm help:dev`、未知脚本错误、空间统计和清理预览均可完成；真实桌面首跑仍以 [第一次运行](../tutorial-first-run.md) 的人机证据为准。

最有效的 DX 改进已在本轮沉淀：将 Node 24 设为硬前置、把远端端口合同写成单独参考、把“从远端拉取后在哪里写代码”写成 How-to，并明确 `ERR_PNPM_NO_SCRIPT` 的定位方式。后续可以再补一条无凭据的 `pnpm doctor`，把 Node/pnpm/工作树/端口前置检查合并成一条命令。

按建议清理了本地旧安装包、macOS 解包目录和可重建构建输出，保留 0.3.25 安装包、`node_modules` 和 `.codegraph`；工作区从约 `2.91 GiB` 降至 `1.15 GiB`。源码、文档和 Git 状态未被清理动作改动。

## 安全审计

CSO 使用离线、默认静态范围完成，状态是 **partial**。结果是 **No supported findings in the assessed scope**，没有把扫描器的 PII / env-like 匹配直接当成漏洞。审计没有连接真实身份提供商、没有调用生产业务接口、没有执行 Docker 或依赖安装，也没有读取真实客户数据。

已检查的安全边界：

- `apps/api/src/app.ts`：Fastify body limit、`/health` / `/ready`、未就绪时的 503 和稳定错误合同。
- `apps/api/src/auth-routes.ts`、`apps/api/src/product-auth-routes.ts`：请求字段白名单、bearer 形状、登录回调参数长度和速率窗。
- `apps/api/src/request-boundary.ts`：搜索文本 1–500 code point 边界和确定性脱敏。
- `apps/desktop/src/main/window-security.ts`、`sender-guard.ts`：禁止权限、窗口打开、导航、webview 和不可信 IPC sender。
- `.github/workflows/ci.yml`：GitHub Actions 使用提交 SHA 固定版本，默认 contents 权限为 read，发布 workflow 的写权限只在发布页 job 中声明。
- `scripts/ops/customer-agent-stack-watchdog.service`（监控 unit）：`NoNewPrivileges`、`ProtectSystem`、`ProtectHome`、受限读写路径和非 root 运行身份；这不等于生产 `customer-agent-stack.service` 已启用同样的 hardening。

覆盖缺口：Git 历史因 helper 输出限制未完成；离线模式没有 OSV 依赖 advisory；模型/MCP、外部 OAuth、真实部署配置和公网攻击面没有执行验证。这些缺口意味着本报告不能作为全量安全认证，也不能替代部署环境的独立评审。

## 远端端口与发布仓库诊断

远端主机是 Windows 上的 WSL2。只读检查观察到：

- `customer-agent-stack.service` active；生产 API `43115` 和口令身份 `43116` 只监听 `127.0.0.1`。
- `customer-agent-test-stack.service` inactive；测试端口 `43180/43181` 未监听。
- `/srv/customer-agent/current` 指向生产 SHA `87bc4de`，工作树仍有一个既有的 `apps/desktop/assets/app-icon.png` 本地修改，不能覆盖。
- 生产 `/ready` 返回 `200`，数据库、schema、auth、storage、content 均为 `ok`。
- 清理前 `/srv/customer-agent/releases` 有 9 个目录、约 `1.4G`。6 个无运行引用的旧完整 release 和当前 release 的 Windows `win-unpacked` 属于重复的可回滚依赖 / 生成物，优先级高于清理源码。
- 按用户一次性授权删除了 6 个旧 release（`0232538c22e95bc0f2a12fc4a6b27dff2ce284e5`、`06ac00f4289c5b8a1aad34ad4f2c064758e0fa28`、`c57afbbd486014ca1106c8f8a824af88f78894da`、`dae47f2f9382a3020bd417003baa45c88c718161`、`feb169e2aad6dc26e8995302bdc2231b3a58afed`、`feb169e4f5d9b8f63e11f47cced0e7e0d3c7f234`），并删除当前生产 release 下可重建的 `release/local-unsigned/windows/win-unpacked`；因此该 release 不再是包含 Windows 产物的完整快照，不能把它当作 Windows 安装包回滚目标。保留生产 `87bc4de`、仍有终端引用的 `6aa309c`、测试工作树 `b0866f2`、正式 Windows 安装包、数据库、对象、备份和配置；`b0866f2` 不是生产 release，不计入生产回滚窗口。清理后 `/srv/customer-agent/releases` 为 `800,190,464` bytes，较清理前回收约 `696,827,904` bytes（约 `664.5 MiB`）。
- 已复核 `customer-agent-stack.service` 仍为 active，生产 `43115/43116` 仍只监听 loopback，`/ready` 连续返回 `200` 且 `database/schema/auth/storage/content` 均为 `ok`。停止的 `/srv/customer-agent/test-stack` 保留，未删除测试数据或凭据。
- `/srv/customer-agent/stack` 下的 `api.env`、`feishu.env`、`password-accounts.json`、`profile.json` 和 `content.env` 均已收紧为 `0600`；生产服务仍可读且 readiness 正常。systemd unit 当前未启用 `NoNewPrivileges`、`ProtectSystem`、`ProtectHome` 和 `PrivateTmp`，这是后续独立加固项，不能在未验证兼容性前直接修改。
- 宿主 nginx 在 `80` 监听；本次检查没有看到 `443` listener，也没有看到 customer-agent API 被 nginx 直接代理。HTTPS 是否在隧道边缘终止，仍以 Cloudflare 隧道配置和外部探针为准，不能仅凭本机 `ss` 下结论。

清理边界仍然有效：不要删除 `/srv/customer-agent/stack/data`、`objects`、`logs` 或私有 env；后续 release 应按回滚窗口保留，确认无进程引用并完成 readiness 回归后再清理。当前测试栈仍是独立的后续清理候选，不影响生产服务。

上面的删除记录只描述已经完成的一次性操作，不构成未来自动删除授权。后续清理必须逐目录确认完整 40 位 SHA、当前软链引用、最近一次验收证据和备份状态；“有终端引用”本身不是回滚资格。

## 结论与后续入口

后续可以“从远端拉下来再写代码”，但应理解为拉到本地 Git 工作树或独立 worktree。不要在远端生产 `current` 里直接改代码，也不要把生产端口当测试端口。完整步骤见 [How to 从远端仓库开发、测试并交付](../how-to-remote-development-and-deployment.md)。
