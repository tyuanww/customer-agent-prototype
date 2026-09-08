# 合成搜索判定实验

状态：`SYNTHETIC` / `EXPERIMENT_NOT_RUNTIME`。当前修复范围见[否定语义计划](../../../../docs/plans/2026-09-08-search-negation-repair.md)，历史工具交付见[原计划](../../../../docs/plans/2026-09-08-search-decision-lab.md)。合成结果不代表真实业务验收、007 或 T6。

`apps/api/src/search-decision.ts` 是产品与实验共用的判定所有者；`search-relations.ts` 拥有有界正文事实与否定语义。实验中的来源注解与需求判定未进入正式 API。诊断副本仅重定位相对 import，不再修改判定逻辑，产品与副本的纯判定必须完全一致。基线记录父提交与实际源码 SHA-256，源码漂移时失败关闭。

## 命令

仓库根、Node 24：

```bash
pnpm test:search-decision
pnpm test:search-decision:acceptance
pnpm test:search-decision:proof
pnpm test:search-decision:round1
```

- `test:search-decision`：工具、75 条接口题、事实/正文边界、独立合成否定回归、产品一致性、故障注入及生成模块类型检查。
- `acceptance`：运行完整冻结 23 题；任一业务预期不符都非零退出。本版本目标包括 N10/N19，不再排除它们。
- `proof`：另建临时目录运行真实 acceptance CLI，要求退出 0，并读取同次新报告核验 23 题全集、通过/失败集合、分母和实际产品源码哈希。缺失、陈旧、截断、错误版本或任何失败均拒绝证明。
- `round1`：回归原首轮范围；不是当前完整验收。旧 `known-fail` 命令以 2 退出并提示迁移到 `proof`，不会把成功验收包装成已知失败。

## 冻结与证据

原 `cases-n.json` 的 query/pool/expected 与 round1 诊断原字节保留。修复前冻结的 `diagnostics-round2.json` 只记录 N10/N19 新诊断；额外的 `negation-regression.json` 是已见合成回归，不是业务 holdout。历史 #44 的 21/23 和已知失败证明仍可在该 Git 版本复现，不追溯改分。

默认输出在 `apps/api/experiments/search-decision/.generated/reports/`：`run.json` 汇总、`cases.jsonl` 逐题、`n-acceptance.json` 完整 N 集合与产品版本绑定。重复运行覆盖同名报告；设置 `SEARCH_DECISION_LAB_REPORT_DIR` 可选择独立目录。proof 总在新的系统临时目录 `search-decision-lab-proof-*` 读取自己的子进程报告。

`baseline.json` 冻结来源、题集、诊断和源码哈希。`SEARCH_DECISION_LAB_FIXTURE_ROOT` 仅接受同哈希副本。`SEARCH_DECISION_LAB_TEST_UNFROZEN=1` 只供内部故障注入，不可作验收；所有普通 CLI 清除此开关，proof 子进程还清除 fixture 路径覆盖。源码更新必须明确更新基线并重新验证；报告记录 base commit 与实际源码哈希，父提交不冒充候选源码版本。

`pnpm typecheck` 物化并实际检查 `.generated/search-decision.ts`。生成报告及副本不进入 Git；实验及合成夹具不进入 API dist 或正式候选包。共用的纯判定源码按产品模块正常构建。公开 API 仍返回 hit/no_hit 与完整原文，没有来源注解或诊断字段。
