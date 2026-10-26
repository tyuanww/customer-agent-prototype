# 概览重做设计

本文对应任务卡 D5（`docs/plans/2026-10-24-saas-refactor-task-cards.md` 第 6 节）。只描述现状、目标展示和与 C3 口径的对应关系。不写数据库迁移，也不改 Dashboard 代码。

依赖 C3 的分析层口径见 `docs/plans/2026-10-25-analytics-schema.md`。实现阶段另开卡。旧 profile 页面已经不在概览这条路径上。本说明不删除 `dashboard:wording-list`，也不删除 Query 与 Fox 的产品公告。

## 目标

概览顶栏和列表只反映真实聚合或明确的空态文案。生产路径不再挂载编译期固定样例数字。话术迭代闭环保留现有模块边界，包括 `dashboard:wording-list`、Query 与 Fox 的产品公告读写。本设计不删除上述 IPC 或公告能力。

顶栏质量指标与 C3 提议的三个比率对齐。列表区继续承担「不准反馈、无命中问题、待办、修订、效果对比」的操作闭环。

## 当前概览由谁渲染

FAQ 合成 profile 下，导航 id `overview` 挂载 `IntakeOverview`（`apps/desktop/src/renderer/features/dashboard/intake-destinations.tsx`）。实现文件是 `apps/desktop/src/renderer/features/dashboard/IntakeOverview.tsx`。测试契约在 `apps/desktop/tests/component/intake-overview.test.tsx`。

## 当前界面展示什么

### 时间范围

页头有「数据范围」和 `DatePicker.RangePicker`，默认近 7 天，预设近 7 天与近 30 天（`recentWindow` 与 `rowsInWindow`，均在 `IntakeOverview.tsx`）。该范围只过滤使用记录相关块，不过滤「不准次数」磁贴。

### 四个磁贴

| 磁贴 | 数据来源 | 计算方式 |
| --- | --- | --- |
| 查询次数 | `window.dashboardUsageLog.list` 分页读入的全部行，再按所选日期过滤 | `countOverviewUsage` 返回的 `queries`，等于窗口内行数（`IntakeOverview.tsx`） |
| 没查到 | 同上 | 窗口内 `result === 'miss'` 的行数 |
| 被复制 | 同上 | 窗口内 `result === 'copied'` 的行数。副文案「只表示复制了」 |
| 不准次数 | `window.dashboardIteration.list` | `inaccuracyTableRows` 按话术聚合的 `sampleCount` 之和。副文案说明只含已开待办记下的样本，且不随日期变化（`INACCURACY_SCOPE` 常量） |

使用记录在 Main 侧未挂载时，磁贴不填数字，状态区写「坐席查询后会出现」（`USAGE_LATER`）。读失败时写「没读到。」并可重试。就绪后在磁贴下方展示 `USAGE_SCOPE`，说明查询次数、没查到和被复制只含当前登录者最近读到的查询，不是全店。

`countOverviewUsage` 把窗口内每一行都计入查询次数，包括 `miss`、`viewed` 和 `copied`。只有 `copied` 计入「被复制」。只有 `miss` 计入「没查到」。这与 `apps/desktop/src/shared/usage-log-csv.ts` 里 `aggregateUsage` 的分组方式不同。后者把非 `miss` 行算作 use。概览页没有调用 `aggregateUsage`，也没有展示命中率或「较上期」类文案（测试在 `intake-overview.test.tsx` 中断言不存在）。

### 待办

`dashboardIteration.list` 返回的任务里，只展示 `open` 与 `in_progress`。表格列包括状态、事项、原因选择与操作。事项标题来自 `iterationMatterLabel` 或「话术不准：{scriptId}」。关单时 `dashboardWording.list` 提供目录快照，供 `decideIterationClose` 判断内容缺口是否已有新发布（`catalogFromWording`、`closeTask`）。

### 不准的话术

同一任务列表经 `aggregateInaccuracyTodoCounts` 按 `scriptId` 排名。脚注使用 `INACCURACY_TODO_COPY.footnoteLive`，阈值来自 `apps/desktop/src/shared/inaccuracy-report.ts`（24 小时内 `INACCURACY_TASK_THRESHOLD_24H` 为 3，7 天内 `INACCURACY_TASK_THRESHOLD_7D` 为 10）。

### 没查到的问题

对窗口内使用记录调用 `rankMissRows`（`usage-log-csv.ts`）。按问题文案聚合未命中次数，`question === null` 时显示「已脱敏」。运营可点「补充话术」，坐席角色禁用（`dashboardDesk.current` 判 `seat`）。

### 改过之后有没有变好

挂载 `dashboardIteration.outcomes` 时读取 `INACCURACY_OUTCOME_COPY` 定义的列表。每条展示处理前后各 7 天的样本计数比较（`outcomeSentence`，`inaccuracy-outcome.ts`）。未挂载或尚无已处理待办时用 `later` 或 `empty` 文案，不用固定数字。

## 固定样例数字是否还在生产路径

在 `IntakeOverview.tsx` 的生产渲染路径里，我没有找到任何硬编码统计数字或图表。磁贴数字来自 IPC 返回行的真实计数，或在未就绪时不渲染 `<b>` 数值。

`apps/desktop/tests/fixtures/v9-overview-model.ts` 仍生成合成 headline、趋势和「能开发票吗」等 miss 排名，但仅被组件测试引用，用于断言这些字符串不会出现在概览 DOM（例如 `v9Headline(7).use` 与「能开发票吗」）。该 fixture 不在 `apps/desktop/src` 下被 import。

`apps/desktop/tests/fixtures/dashboard-manifest.ts` 的 `DASHBOARD_MANIFEST` 已无 `overview` 属性。单元测试 `dashboard-manifest.test.ts` 要求 manifest 序列化结果不含「8.4%」「较上期」等旧概览样例字符串。仓库里也没有 `apps/desktop/src/renderer/data/dashboard-manifest.ts`。

因此 D5 卡片里「删除 manifest 固定样例或隔离预览」在概览生产路径上已基本满足。剩余合成数据在测试 fixture 与 manifest 其它模块（如 wording 的 `dataClass: 'synthetic'`），不进入概览磁贴。

若实现阶段要彻底满足验收，应继续用测试保证 renderer 不 import `v9-overview-model`，且任何预览专用样例仅能通过测试或独立预览入口加载。

## C3 三个比率如何接替现有数字

C3 口径（`docs/plans/2026-10-25-analytics-schema.md`）提议只读视图 `analytics.question_v1`，在同一时间窗内给出三个比率。

| C3 比率 | 分子 | 分母 | 与当前概览的关系 |
| --- | --- | --- | --- |
| 命中率 | `query_events` 中 `hit_status = hit` 的行数 | 同窗 `query_events` 行数 | 概览未展示比率。窗口内「查询次数」减「没查到」在本地语义上接近命中行数，但本地一行对应使用日志一条记录，且范围是当前登录者读到的查询，不是业主全店 `query_events` |
| 无命中率 | `hit_status = no_hit` 的行数 | 同窗 `query_events` 行数 | 「没查到」磁贴是同窗 miss 行计数，可视为无命中次数的本地投影。C3 比率是分母归一化后的值，且分母是服务端事件行，不是按问题文案去重后的 `rankMissRows` |
| 不准反馈率 | `ops_loop.inaccuracy_reports` 行数 | 同窗 `query_events` 行数 | 「不准次数」磁贴是待办开单阈值聚合后的样本计数总和，分子语义是「记下的样本」，不是同窗全部 inaccuracy 报告行，也不除以查询数 |

无查询时，C3 提议视图把比率留空而不是写 0。概览在读成功但窗口内零行时，磁贴显示数字 0（测试 `shows the digit 0 when the signed-in reads are empty`）。重做后顶栏比率应遵循 C3 空窗语义，列表区仍可用 0 表示「没有行可排」。

「被复制」没有对应 C3 三比率之一。`vw_owner_agent_daily.copy_rate` 是复制除以提问，属于按人按日视图，与 `analytics.question_v1` 不是同一指标。重做时可保留为补充计数，或移到明细导出，不在三比率磁贴里硬凑。

### 建议的顶栏替换（实现时）

1. 用同一时间窗拉取 `analytics.question_v1`（或等价 Main 只读 API），展示命中率、无命中率、不准反馈率三个字段。日期选择器与 C3 窗对齐。
2. 下线或降级「查询次数 / 没查到 / 被复制 / 不准次数」作为 headline 质量 KPI 的角色。若运营仍需要绝对次数，可放在次要行或折叠说明，并标明数据范围（业主全店 vs 当前实现的使用日志范围）。
3. 「没查到的问题」表仍可从使用日志或未来的 `vw_owner_unmatched_questions` 类只读面驱动，与无命中率分子相关，但排序粒度（按问题文案）与事件行计数不必相同。
4. 「不准的话术」与待办继续走 `dashboardIteration`，与 inaccuracy 报告开单阈值配合。不准反馈率顶栏反映全窗报告密度，不等同于表内 `sampleCount`。
5. 「改过之后有没有变好」继续用 `outcomes` 做处理前后 7 天对比，作为闭环的效果层，不替换三比率。

### 范围差异必须在 UI 写清

当前 `USAGE_SCOPE` 明确不是全店。C3 比率基于 `query_events` 与业主只读视图，默认是租户或店铺级聚合。重做后若顶栏改读 analytics，侧栏或页头须改写数据范围文案，避免把全店比率误读成个人工作台统计。实现卡须单独定授权主体与过滤维度，本文不展开。

## 与 D5 验收的对应

| D5 验收项 | 设计态度 |
| --- | --- |
| 生产路径无固定样例数字 | 现状已靠 IPC 聚合与测试排除 v9 headline。实现时新增 analytics 读取不得回退 manifest 样例 |
| 话术迭代闭环 | 保留待办、不准表、miss 表、outcomes 与 wording 关单校验 |
| 接口不写「未接入」 | 空态继续用「坐席查询后会出现」「现在没有待办。」等现有 copy（`IntakeOverview.tsx`、`inaccuracy-outcome.ts`） |

## 不在本文范围

- 数据库迁移、`analytics` schema 落地、新建登录角色（C3 实现卡）。
- 删除 `dashboard:wording-list`、Query/Fox 产品公告 IPC。
- 使用记录 CSV 导出、话术库模块、公告模块（D4 范围）。
- 检索评测或服务端检索（E 组）。

## 实现前须读的文件

- `apps/desktop/src/renderer/features/dashboard/IntakeOverview.tsx`
- `apps/desktop/src/shared/usage-log-csv.ts`
- `apps/desktop/src/shared/inaccuracy-todo.ts`
- `apps/desktop/src/shared/inaccuracy-outcome.ts`
- `apps/desktop/src/shared/inaccuracy-report.ts`
- `apps/desktop/tests/component/intake-overview.test.tsx`
- `docs/plans/2026-10-25-analytics-schema.md`
