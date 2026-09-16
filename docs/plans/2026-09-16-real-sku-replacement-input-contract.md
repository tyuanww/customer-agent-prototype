# 真实 MENOKIN SKU 替换：输入契约与回退预案

> **状态：准备件（PREPARATION ONLY）。本文不授权任何实施。**
> 本文为「用真实 MENOKIN SKU 替换澄芽/雾屿」这一步预先固定输入格式、校验规则与回退方式。
> 它不放行数据导入、不跑 retrieval 三步、不改 `SYNTHETIC_CATALOG`、不触碰合成栈发布。
> 没有用户批准的仓外受控输入之前，本文的每一节都只是待用清单。

相关：[桌面语义检索](../reference-desktop-retrieval.md) · [执行清单](2026-09-06-execution-goal.md) · [macOS M5 人工核验](../how-to-verify-macos-m5.md)

## 0. 为什么要先写这个

`pnpm retrieval:questions` → `retrieval:embeddings` → `retrieval:hydrate` 三步本身已经能跑（#80–#82 已合入）。缺的不是工具，是**输入**和**出事之后怎么退回**。

当前仓外索引（`~/.customer-agent-synthetic-stack/retrieval-index.json`）400 条全是合成内容，`source` 为 `local-feishu-import`。把真实 SKU 灌进去会同时改动三个仓外文件和一次发布快照。若不知道改前是什么状态，就没有回退路径。本文先把这两件事定死。

## 1. 输入格式（待用户批准的仓外受控输入）

**只允许这三类字段。** 任何其它字段一律拒收：

| 字段 | 必填 | 约束 | 例 |
| --- | --- | --- | --- |
| `sku_id` | 是 | `^[A-Za-z0-9_-]{1,128}$`，与现有合成 id **不冲突** | `sku_mn_xxxxxx` |
| `sku_label` | 是 | 商品对外称呼，≤ 64 字符 | （真实款名） |
| `answer_text` | 是 | 该 SKU 的话术正文，纯文本 | （真实话术） |

**明确禁止入库的字段**（依据 `AGENTS.md` §2：不得把原文、订单、图片、批次、员工、快递或竞品评价写入仓库或未获批运行链路）：

- 真实订单号、买家信息、快递单号
- 员工姓名、工号、内部联系方式
- 真实客户原话（问句也不行；`retrieval:questions` 只发标题和快捷问法给 MiniMax）
- 内部链接、凭证、token
- 批次、生产日期、竞品评价原文

这些字段**不出现在输入里，就不会有落盘的机会**。如果拿到的输入里混了这些，第一步就是拒绝，不是清洗。

**输入载体**：仓外文件（不进 git）。`retrieval:questions` / `retrieval:embeddings` 已经强制 `assertOffRepoIndexPath`，写进工作树会失败；契约输入沿用同一约定。

## 2. 真正的接口点：`SYNTHETIC_CATALOG`（不是只改索引）

这是最容易漏的一步。`apps/desktop/src/shared/query-route.ts` 的 `productMention()` **只认 `SYNTHETIC_CATALOG` 里的 label**：

```ts
for (const { product } of products) {
  if (includesLabel(query, product.label)) {
    return { intent: 'product', match: 'sku', productContextType: 'sku', productContextRef: product.id };
  }
}
```

也就是说，**只替换仓外索引里的答案正文，问句里提到的新款名仍然不会被路由到 SKU**——`routeQuery` 会落到 `storewide`，SKU 话术永远进不了 Top 3。

因此替换是**两处同步**：

1. `apps/desktop/src/shared/synthetic-catalog.ts` 的 `SYNTHETIC_CATALOG`（仓内，id 与 label）
2. 仓外 `retrieval-index.json` / `-embeddings.json` / `-hydrate.json`（仓外）

`SYNTHETIC_CATALOG` 被两处消费：`scripts/synthetic-stack/stack.ts`（`catalogReferences()` 打印目录引用）与 `scripts/synthetic-stack/stack.test.ts`（断言每条非 storewide 种子的 `product_scope_refs` 都能被目录标注），以及 desktop main（`product-catalog.ts` 投影给 renderer）。改它会连带影响直接断言澄芽/雾屿的测试：`tests/unit/synthetic-catalog.test.ts`、`tests/unit/query-route.test.ts`、`tests/unit/search-service.test.ts`、`tests/component/QueryApp.test.tsx`、`tests/component/DashboardApp.test.tsx`、`tests/fixtures/synthetic-development-baseline.ts`，以及 `tests/e2e/` 下的 `synthetic-stack.spec.ts` / `smoke.spec.ts`。**这是一次仓内代码改动，不是纯数据操作**，需要独立的代码授权，不能和"跑三步脚本"混为一谈。

## 3. 执行顺序（授权后）

必须**先备份，再动数据**：

```
0) 备份仓外三件套 + 记录当前发布
   cp retrieval-index.json{,.bak}   （-embeddings / -hydrate 同）
   记录 content_current 的 release_id（当前 rel_17）
1) 校验输入（§4）
2) 改 SYNTHETIC_CATALOG（仓内，独立 PR）
3) pnpm retrieval:questions    → 只改 questions[]，MiniMax 只见标题+快捷问法
4) pnpm retrieval:embeddings   → 向量绑定 sha256(answerText)
5) 合成登录触发 snapshot 回写，或 pnpm retrieval:hydrate -- --from <snapshot.json>
6) 人眼在开发态验证新款名路由到 SKU 话术
```

第 5 步的 hydrate 必须进**发布快照**才有意义：`retrieval:hydrate` 手工写入要求先有 `--from <snapshot.json>`，而 snapshot 来自合成登录分页。空 snapshot 不覆盖——该行为在 `apps/desktop/src/main/hydrate-catalog.ts` 的 `syncHydrateCatalog()` 中实现（`skipped: true, reason: 'empty'`）；`scripts/sync-retrieval-hydrate.ts` 只是它的 CLI 调用方。

## 4. 校验（在跑第 3 步之前）

三条硬校验，任一不过就停：

| 校验 | 方法 | 不过则 |
| --- | --- | --- |
| id 合法且不冲突 | `^[A-Za-z0-9_-]{1,128}$`，且不在现有 `SYNTHETIC_CATALOG` id 集合内 | 拒绝该条，报告冲突 id |
| 无禁入字段 | 扫描输入文件的 key 集合，出现任何 §1 禁止字段即拒 | **整批拒绝**，不做局部清洗 |
| 备份在位 | 三个 `.bak` 存在且非空 | 拒绝开工 |

校验以脚本执行（只读，不写仓外索引）；脚本本身属实现件，需与 §2 的代码改动同批授权。

## 5. 回退预案

**回退目标：回到 `rel_17`（MENOKIN 快照，400 条）的可用状态。**

| 层 | 回退动作 | 备注 |
| --- | --- | --- |
| 仓外索引 | 三个 `.bak` 覆盖回去 | 最快，秒级 |
| 发布 | 用合成 Owner 在 loopback 上 `POST /v1/content/rollback` 回目标发布 | 2026-09-16 STALE 已验证该入口可用 |
| 仓内代码 | revert §2 的 PR | 走正常 PR 流程 |
| 应用侧 hydrate | 合成登录重新对齐，或 `retrieval:hydrate --from` 旧快照 | — |

**注意 STALE 的既有行为**（M5 清单第 5 节 + 已知事实 4）：回退后若重新搜索，hydrate 会对齐新版本而 BM25 可能仍是旧 id，表现为无命中。这不是回退失败。要验证 STALE，必须点**旧卡片的复制**。

## 6. 与其它并行任务的关系

- **不要和 M5 复核同时进行。** M5 第 7 节的「复制=剪贴板」「全店发货」证据是在当前内容状态下人眼看到的；替换会顶掉澄芽/雾屿话术，谁都说不清观察的是哪个版本。替换前先记录当前发布号，替换期间冻结 M5 观察。
- **不要 `stack start`。** 会重新播种并顶掉 MENOKIN。
- **不碰 `anomaly source-suspend`**（不可逆）。

## 7. 解除条件

本文从「准备件」变为「可实施」需要用户**同时**给出：

1. 已批准的仓外受控 SKU 输入（符合 §1 格式）
2. 对 §2 仓内代码改动（`SYNTHETIC_CATALOG`）的明确授权
3. 对执行 §3 三步脚本的明确授权

缺任一项则不实施。当前（2026-09-16）用户明确表示输入**暂时拿不到**，因此本文保持准备件状态。
