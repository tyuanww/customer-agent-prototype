# 合成搜索判定实验

状态：`SYNTHETIC` / `EXPERIMENT_NOT_RUNTIME`。不是正式能力、业务验收、007 或 T6。

工具批准范围见[实施计划](../../../../docs/plans/2026-09-08-search-decision-lab.md)。

产品 `apps/api/src/search-decision.ts` 仍是判定所有者。本目录用固定 SHA-256 + 最小补丁在 `.generated/` 生成诊断副本；产品文件漂移则失败关闭，不会默默对照变化的 main。不进入 `dist` 或正式候选包。

N10（没/未）与 N19（negationMismatch）保持已知失败。通过本工具不等于否定语义完成。

## 命令

在仓库根、Node 24：

```bash
pnpm test:search-decision
pnpm test:search-decision:round1
pnpm test:search-decision:acceptance
pnpm test:search-decision:known-fail
```

- `test:search-decision`：工具自身、接口题、事实诊断、正文陈述边界、S16 限定产品差异、变异门禁、已知失败 CLI 证明、生成判定模块类型检查。成功为 0。
- `test:search-decision:acceptance`：完整 N 验收。N10/N19 必须导致非零。结果写该次运行的 `n-acceptance.json`。
- `test:search-decision:known-fail`：真实 acceptance 子进程须以预期失败码退出，并核对同一次运行的 JSON：冻结 23 题全集、分母与通过/失败集合一致，失败集合恰为 N10/N19。启动失败、报告缺失/陈旧/截断或意外失败都不能当作证明通过。
- `test:search-decision:round1`：首轮关闭范围，不含 N10/N19，成功为 0。

`pnpm typecheck` 会先物化 `.generated/search-decision.ts` 再对其做 tsc；不必手工生成。不要用日志关键词代替 JSON 集合。

默认报告目录为仓库内 `apps/api/experiments/search-decision/.generated/reports/`：普通工具测试生成 `run.json`（汇总）和 `cases.jsonl`（逐题）；完整 N 验收生成 `n-acceptance.json`（题目全集、通过/失败集合、原因与分母）。重复运行会覆盖同名报告；可用 `SEARCH_DECISION_LAB_REPORT_DIR` 指定独立输出目录。已知失败证明始终另建系统临时目录 `search-decision-lab-known-fail-*`，只读取其真实 acceptance 子进程新生成的 `n-acceptance.json`，不复用上述默认报告。

正常验收锁定 `baseline.json` 中的 fixture 哈希和 23 题 N 全集；`SEARCH_DECISION_LAB_FIXTURE_ROOT` 只能指向满足该哈希的副本。`SEARCH_DECISION_LAB_TEST_UNFROZEN=1` 仅供内部变异测试，不能作为验收证据；acceptance / round1 / known-fail CLI 均清除此开关，known-fail 子进程还清除 fixture 路径覆盖，强制使用仓内冻结全集。所有输入继续仅限合成 fixture。

## 边界选择

比较过两种做法：独立复制整份判定模块，或固定产品基线加最小补丁生成诊断副本。采用后者，避免产品第二真源。关系抽取与陈述门在 `relation-polar.ts`；诊断接线只存在于生成副本。
