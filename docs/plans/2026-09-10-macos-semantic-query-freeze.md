# 冻结点：`codex/macos-semantic-query`

> 状态：**本轮收尾冻结**。后续开发从本提交起开新提交，不要在 main 上直接改检索。
> 冻结代码点：`27b8dab`。其后允许文档钉扎与检索债修复，不以 main 为准。
> 相对 `origin/main` 的 merge-base：`c4f601e`（#75 之后）

## 不要做（防版本紊乱）

- 不要 `stack start`：会再种合成种子，把当前 `rel_6` MENOKIN 发布顶掉。
- 不要把 `~/.customer-agent-synthetic-stack/retrieval-*.json`、`minimax.env` 或飞书话术正文提交进 git。
- 不要改冻结 `apps/api/src/search-decision.ts` / leftover `judgeSearch`。
- 不要合并治理 PR #80，不要宣称 M5 完成，不要去掉合成登录 / MOCK AUTH。
- 本分支先不 merge 进 main；需要续做时在本分支继续，或从本 HEAD 拉新 worktree。

## 本机受控栈（仓外）

| 项 | 值 |
|---|---|
| 当前发布 | `rel_6` · `MENOKIN local scripts` · 400 条 · `published` |
| `rel_7` | 合成栈种子，已 `superseded`；曾导致「内容已变化」 |
| 检索索引 | `~/.customer-agent-synthetic-stack/retrieval-index.json` |
| hydrate | `~/.customer-agent-synthetic-stack/retrieval-hydrate.json`（releaseId 必须是当前发布） |
| MiniMax key | `~/.customer-agent-synthetic-stack/minimax.env`（chmod 600） |
| 开发态启动 | `~/.grok/long-running-background-tasks/start_copy_unscoped_dev.sh` |

发布门与 hydrate 的 `releaseId` 必须一致。切发布后要重导 hydrate，并让浮窗退出后重新合成登录。

## 已落地（桌面检索）

顾客问句 → MiniMax 查询规划（可关）→ BM25+RRF 池 24 → MiniMax 重排 id（只发 id+标题，不发正文）→ hydrate 原文 Top 3。  
智能检索默认 ON；失败 / 超时 fail-open 到 BM25。不生成话术。

## 下次开发（不要和本冻结点混在一个 WIP 里）

1. 入库 `questions[]`（Doc2Query，仓外索引）
2. 第二路 BM25(正文) 换成 embedding
3. 真实 MENOKIN SKU 目录替换澄芽/雾屿
4. hydrate 的 `releaseId` 与 `content_current` 对齐的自动刷新
