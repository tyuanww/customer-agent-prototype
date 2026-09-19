# How to 启动 macOS 语义检索开发浮窗

在本机已有 `rel_6` MENOKIN 发布的前提下，拉起查询胶囊，用顾客问句检索原文，而不是重新播种合成栈。

## Prerequisites

- Node.js 24.x 与 pnpm 11.19.0
- 隔离合成栈已经在跑：PG15、身份 `:43101`、API `apps/api/dist/main.js` `:43100`
- 仓外索引存在。hydrate 的 `releaseId` 由胶囊「登录」按当前 `content_current` 对齐（冻结时是 `rel_6`）
- **不要** `node scripts/synthetic-stack/stack.ts start`。它会再种合成种子，把 `rel_6` 顶成 `rel_7`，hydrate 对不上就会「内容已变化，请重新查询」

## Steps

1. 确认 API 是 `apps/api/dist/main.js`，不是 `stack.ts start` 拉起的种子进程。

   ```bash
   curl -sS http://127.0.0.1:43100/health
   ```

   期望 HTTP 200。

2. 确认仓外文件（路径可被环境变量覆盖，不要提交进 git）：

   | 文件 | 作用 |
   | --- | --- |
   | `~/.customer-agent-synthetic-stack/retrieval-index.<origin>.json` | BM25 索引；`questions[]` 由 `pnpm retrieval:questions` 写入。`<origin>` 是 API origin 的 sha256 前 16 位十六进制 |
   | `~/.customer-agent-synthetic-stack/retrieval-embeddings.<origin>.json` | 正文向量；由 `pnpm retrieval:embeddings` 写入 |
   | `~/.customer-agent-synthetic-stack/retrieval-hydrate.<origin>.json` | 原文快照；登录后按当前发布自动对齐。更小的种子 snapshot 不会盖掉更大的已有文件 |
   | `~/.customer-agent-synthetic-stack/minimax.env` | MiniMax key，权限 600 |

   未设 `CUSTOMER_AGENT_DESKTOP_API_ORIGIN` 时仍可用未带后缀的 leftover 文件。产品模式会设 origin，只读带后缀路径。

   若索引里还没有 `questions[]`，先入库顾客问法（只改仓外文件，不 `stack start`，不提交）：

   ```bash
   pnpm retrieval:questions -- --dry-run
   pnpm retrieval:questions
   ```

   MiniMax 只看到标题和快捷问法。缺 key 或某行生成失败则跳过该行。`--rebuild` 会覆盖已有 `questions[]`。

   正文第二路向量（失败则仍用 BM25 正文）：

   ```bash
   pnpm retrieval:embeddings -- --dry-run
   pnpm retrieval:embeddings
   ```

   向量绑定 `sha256(answerText)`，不进 git。切发布后要重算。

   hydrate 在点胶囊「登录」后自动对齐当前发布。只想检查文件、或从 snapshot JSON 手工写入。设了 `CUSTOMER_AGENT_DESKTOP_API_ORIGIN` 时，CLI 默认写带 origin 后缀的文件：

   ```bash
   pnpm retrieval:hydrate -- --dry-run
   pnpm retrieval:hydrate -- --from snapshot.json
   ```

   空 snapshot 不会覆盖已有 hydrate。不要 `stack start`。

3. 用现有开发启动脚本或手动导出 origin 后 `pnpm --filter @customer-agent/desktop dev`。产品态至少需要：

   ```bash
   export CUSTOMER_AGENT_DESKTOP_API_ORIGIN=http://127.0.0.1:43100
   export CUSTOMER_AGENT_DESKTOP_IDENTITY_ORIGIN=http://127.0.0.1:43101
   set -a && . "$HOME/.customer-agent-synthetic-stack/minimax.env" && set +a
   ```

   仓外 hydrate / BM25 文件若已在默认路径（有 origin 时是带后缀文件），开发态会自动挂上，不必再 export `CUSTOMER_AGENT_RETRIEVAL_INDEX` / `CUSTOMER_AGENT_HYDRATE_INDEX`。需要覆盖时再 export。

4. 点胶囊「登录」。成功后按钮变成 `{角色} · 退出`，占位变成「输入或粘贴客户问题，回车查询」，不是红校验。

5. 输入顾客问句并回车。不要选手动平台/品类/SKU；范围由问句 intent 路由（默认全店）。胶囊「智能检索」小开关默认开。

## Verification

- 命中卡片是发布原文，不是模型新写的句子。
- 卡片上没有 `DEMO · 合成数据`。胶囊也没有 `DEMO` / `MOCK AUTH` 徽标。
- 关闭智能检索后再查，结果仍来自本地 BM25，不经过 MiniMax。
- `pnpm retrieval:never-hit` 列出 hydrate 里从未曝光或曝光未复制的话术（不打印正文）。
- hydrate 的 `releaseId` 与公告不一致时出现「内容已变化，请重新查询」。处理：再点胶囊「登录」，让公告 snapshot 回写 hydrate。不要 `stack start`。

## Troubleshooting

| 现象 | 处理 |
| --- | --- |
| 「内容已变化，请重新查询」 | `content_current` 与 hydrate `releaseId` 不一致。再点胶囊「登录」回写 hydrate；不要 `stack start` |
| 查询很慢或 400 | 旧路径会打 leftover `/v1/search`。有 hydrate 时不再走这条路。产品模式确认带后缀 hydrate 文件存在；显式覆盖时才 export `CUSTOMER_AGENT_HYDRATE_INDEX` |
| MiniMax 证书错误 | main 必须用 Electron `net.fetch`，不要让 Node 的 `fetch` 直连 |
| `stack start` 已经跑过 | 种子发布可能已覆盖 `rel_6`。按冻结点把 `rel_7` superseded、`rel_6` published，再点胶囊「登录」回写 hydrate。检索会优先更大的仓外索引，不会用 11 条种子盖掉已有大库 |
