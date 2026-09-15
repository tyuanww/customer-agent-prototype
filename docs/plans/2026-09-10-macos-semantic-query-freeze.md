# 冻结点：`codex/macos-semantic-query`

> 状态：**本轮收尾冻结**。检索主干已合入 `main`（#78）。后续检索债从新分支开提交，不要在 main 上直接改。
> 冻结代码点：`27b8dab`（其后 #78 合入主干）。`questions[]` Doc2Query 入库见 `codex/macos-doc2query-questions`。
> 相对当时 `origin/main` 的 merge-base：`c4f601e`（#75 之后）

## 不要做（防版本紊乱）

- 不要 `stack start`：会再种合成种子，把当前 `rel_6` MENOKIN 发布顶掉。
- 不要把 `~/.customer-agent-synthetic-stack/retrieval-*.json`、`minimax.env` 或飞书话术正文提交进 git。
- 不要改冻结 `apps/api/src/search-decision.ts` / leftover `judgeSearch`。
- 不要合并治理 PR #80，不要宣称 M5 完成，不要去掉合成登录 / MOCK AUTH。
- 不要把 Doc2Query 产出写进 git；索引只留在仓外 `retrieval-index.json`。

## 本机受控栈（仓外）

| 项 | 值 |
|---|---|
| 当前发布 | `rel_6` · `MENOKIN local scripts` · 400 条 · `published` |
| `rel_7` | 合成栈种子，已 `superseded`；曾导致「内容已变化」 |
| 检索索引 | `~/.customer-agent-synthetic-stack/retrieval-index.json` |
| hydrate | `~/.customer-agent-synthetic-stack/retrieval-hydrate.json`（合成登录时按 `content_current` 自动对齐） |
| MiniMax key | `~/.customer-agent-synthetic-stack/minimax.env`（chmod 600） |
| 开发态启动 | `~/.grok/long-running-background-tasks/start_copy_unscoped_dev.sh` |

发布门与 hydrate 的 `releaseId` 必须一致。合成登录会把公告 snapshot 写回仓外 hydrate。不要 `stack start`。

## 已落地（桌面检索）

顾客问句 → MiniMax 查询规划（可关）→ BM25(title/questions) ∥ 仓外 embo-01 正文向量（失败则 BM25 正文）→ RRF 池 24 → MiniMax 重排 id（只发 id+标题）→ hydrate 原文 Top 3。  
智能检索默认 ON；失败 / 超时 fail-open 到 BM25。不生成话术。  
仓外 `questions[]` 由 `pnpm retrieval:questions` 入库。正文向量由 `pnpm retrieval:embeddings` 写入，绑定 `sha256(answerText)` + `embo-01`。hydrate 由合成登录自动对齐当前发布；`pnpm retrieval:hydrate -- --from` 可手工写入，空 snapshot 不覆盖已有文件。

## 下次开发（不要和本冻结点混在一个 WIP 里）

1. 真实 MENOKIN SKU 目录替换澄芽/雾屿
