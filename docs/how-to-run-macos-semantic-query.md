# How to 启动 macOS 语义检索开发浮窗

在本机已有 `rel_6` MENOKIN 发布的前提下，拉起查询胶囊，用顾客问句检索原文，而不是重新播种合成栈。

## Prerequisites

- Node.js 24.x 与 pnpm 11.19.0
- 隔离合成栈已经在跑：PG15、身份 `:43101`、API `apps/api/dist/main.js` `:43100`
- 仓外索引存在且 `releaseId` 与 `content_current` 同为当前发布（冻结时是 `rel_6`）
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
   | `~/.customer-agent-synthetic-stack/retrieval-index.json` | BM25 索引 |
   | `~/.customer-agent-synthetic-stack/retrieval-hydrate.json` | 原文快照，`releaseId` 必须是当前发布 |
   | `~/.customer-agent-synthetic-stack/minimax.env` | MiniMax key，权限 600 |

3. 用现有开发启动脚本或手动导出 origin 后 `pnpm --filter @customer-agent/desktop dev`。需要：

   ```bash
   export CUSTOMER_AGENT_DESKTOP_API_ORIGIN=http://127.0.0.1:43100
   export CUSTOMER_AGENT_DESKTOP_IDENTITY_ORIGIN=http://127.0.0.1:43101
   export CUSTOMER_AGENT_RETRIEVAL_INDEX="$HOME/.customer-agent-synthetic-stack/retrieval-index.json"
   export CUSTOMER_AGENT_HYDRATE_INDEX="$HOME/.customer-agent-synthetic-stack/retrieval-hydrate.json"
   set -a && . "$HOME/.customer-agent-synthetic-stack/minimax.env" && set +a
   ```

4. 合成登录。成功提示是「可以直接查询；需要时再筛选平台和商品」，不是红校验。

5. 输入顾客问句并回车。默认「全部平台 / 全部商品」。胶囊「智能检索」默认 ON。

## Verification

- 命中卡片是发布原文，不是模型新写的句子。
- 卡片上没有 `DEMO · 合成数据`。胶囊仍有 `DEMO` / `MOCK AUTH`。
- 关闭智能检索后再查，结果仍来自本地 BM25，不经过 MiniMax。
- hydrate 的 `releaseId` 与公告不一致时出现「内容已变化，请重新查询」。处理：把当前发布改回 hydrate 对应的 release，或重导 hydrate，然后退出并重新合成登录。不要 `stack start`。

## Troubleshooting

| 现象 | 处理 |
| --- | --- |
| 「内容已变化，请重新查询」 | `content_current` 与 hydrate `releaseId` 不一致。先查 PG 当前发布，再重导 hydrate 或把发布改回去 |
| 查询很慢或 400 | 旧路径会打 leftover `/v1/search`。有 hydrate 时本分支不再走这条路；确认 `CUSTOMER_AGENT_HYDRATE_INDEX` 已导出 |
| MiniMax 证书错误 | main 必须用 Electron `net.fetch`，不要让 Node 的 `fetch` 直连 |
| `stack start` 已经跑过 | 种子发布可能已覆盖 `rel_6`。按冻结点把 `rel_7` superseded、`rel_6` published，并重导 hydrate |
