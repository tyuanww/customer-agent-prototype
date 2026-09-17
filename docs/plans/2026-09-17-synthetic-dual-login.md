# 合成双身份登录收口（飞书 / 账号）

> **状态：** 本切片实施清单。不批准真实飞书凭据、不打开无凭据的 `AUTH_MODE=feishu`、不放宽 loopback、不加契约 `AuthMode` 第三值。
> **日期：** 2026-09-17
> **基线：** `origin/main` @ `dda273c`（PR #94 已合入登录窗）。
> **工作区：** `/Users/hutou/Desktop/wt-synthetic-login` · 分支 `feat/synthetic-dual-login`。不切换 SOP 工作区，不改另外四项。

## 已在 main

胶囊「合成登录」打开独立 `520×420` 原生窗。分段文案是 **飞书 / 账号**（不是内部 / 外包）。飞书在合成栈仍走 loopback `/authorize`；账号走 `POST /password`（`synthetic_agent` / `synthetic-password`）。`feat/desktop-login-window` 与 `origin/main` 内容已对齐，不再从该旧分支开 PR。

## 本 PR（唯一实现切片）

把合成栈上的双路径收成可独立合并的一刀：

1. **账号路径可用且可验：** chooser 提交时进入 busy；失败文案仍只有「账号或密码不正确」/ 暂不可用；`/password` 有单测；wire-double E2E 走账号登录，不依赖真实飞书。
2. **打包 / file:// 登录窗能挂上 React：** chooser 的 `onBeforeRequest` 以前只放行 `index.html`，Vite 的 `assets/*.js|css|png` 被拦成 `ERR_BLOCKED_BY_CLIENT`，窗是空白（dev 的 Vite origin 不受影响）。白名单扩到同一 renderer 目录的 hashed assets，并剥掉 Vite 的 `crossorigin`，避免独立 partition 再踩 CORS。
3. **视觉跟 `DESIGN.md`：** 登录窗记为第 4 个原生窗（非 overlay），复用查询胶囊 token；表单间距跟 4/8/12。不改胶囊几何，胶囊按钮文案保持「合成登录」。
4. **文案锁死飞书 / 账号：** chooser 与测试禁止内部 / 外包。

成功仍以会话交换 + `/v1/auth/me` 为准；关窗 / Esc 是取消。

## 明确不做（另授权）

| 项 | 挡住它的东西 |
| --- | --- |
| 真实飞书官方页端到端 | 凭据 + 独立授权 |
| 打开 `AUTH_MODE=feishu` 且无凭据 | 会把合成 provider 假标成 feishu |
| 放宽产品 HTTP / 打包态 / 服务端 loopback、远端 PG | loopback 红线 + 安全评审 |
| 契约增加 password `AuthMode` / 新 HTTP 登录端点 | `contracts:intake` |
| `shell.openExternal` | 要同时放宽 https 飞书域白名单，落入红线 |
| Windows 打包 / 签名 / 公证、M5 勾选 | 未授权 |
| 售后 SOP、话术上传、迭代提醒、不正确举报 | 另外四项，禁止混进本 PR |

## 验证

- `pnpm --filter @customer-agent/desktop exec vitest run tests/component/LoginApp.test.tsx tests/unit/product-login-window.test.ts tests/unit/query-visual.test.ts`
- `node --test scripts/synthetic-stack/stack.test.ts`
- `pnpm --filter @customer-agent/desktop exec playwright test tests/e2e/product-session.spec.ts`（需先 `pnpm --filter @customer-agent/desktop build`）
- 不跑全量 Playwright / 不碰真实 `.app`

## Git

commit / push / PR 等明确授权。Conventional Commits，英文祈使句。
