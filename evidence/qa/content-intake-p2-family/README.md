# P2 显式同题覆盖：合成验收

基线 `bad169cf7bbc33424400b2fa6b44d596235a5de9`，分支 `codex/content-intake-family`，日期 2026-10-08。输入全部为合成 XLSX、身份、组织事实与审批；数据库为临时 PG15。本轮实现、修复与合成验证已完成；最终命令、输入哈希与审查覆盖见 [验证记录](verification.json) 和 [审查记录](review.json)。

## 行为与所有者

- 工作簿 K 列严格使用 `sourceId/businessEntryId`；内部解析上下文显式区分品牌来源和店铺来源，店铺 ID 恰好为 `brand` 也不能获得品牌权限。空单元格清除关联，缺少某行仍继承。
- 0028 的完整目录守卫拥有根存在、同 tenant/app/brand/domain、品牌通用且无父关联、商品/场景/半开时间交集及品牌不可覆盖规则。正常发布和纠正回退共享同事务触发器；应用角色权限未开放，旧发布遇 family 拒绝。
- usage 先过滤授权/当前店铺/时间/选择，再算显式家族覆盖，最后分页。多选商品与场景存在未覆盖组合时保留通用稿；所有适用组合都被店铺稿覆盖才隐藏。标题相似不合并，其他店铺稿不进入当前店铺结果。
- Main 消费探针使用实际 ProductSession、HTTP、ContentIntakeUsage、ContentIntakeQuery；验证普通坐席逐字读取/复制及换店/退出后的旧句柄失效。剪贴板使用测试回调，不声称本轮运行真实 Electron IPC 或系统剪贴板。

## 审查发现与修复

1. 多选时按家族直接去重会丢掉未覆盖的通用答案，甚至隐藏不相交商品上的品牌强制稿：改为选中商品×场景组合完整覆盖判断，并测试部分、联合完整与二维交叉缺口。
2. 来源字符串 `brand` 与同名合法店铺 ID 冲突：使用必填内部 `scopeKind`，缺失拒绝；服务端只从登记 shopId 是否为 null 推导，不由工作簿赋权。
3. 单个家族 4,999 份不冲突店铺稿的成对检查超过事务预算：使用时间分量和稀疏维度候选对，补密集家族及朴素规则对照验证。
4. 多选联合覆盖的查询被PG低估为一行，产生大范围嵌套扫描和重复聚合：改为标记需求/覆盖的集合聚合，并明确只计算一次隐藏键；三种接近5000条、100×100选择查询与独立语义oracle复测。
5. 使用资格直接传播 SQLSTATE 会变成内部未知错误：精确映射目录的 `ZA003/SOURCE_MISMATCH` 为明确禁止使用，其他异常仍走原诊断。
6. 无关联目录仍参与家族根匹配，5,000 条产生 2,500 万次无效比较：先隔离有关联项并物化品牌根；单次守卫降到 12.2 ms，完整 50 页消费测试降到 6.87 秒，资格签发和逐页守卫均保留。
7. 过期/相邻时间和跨域来源测试最初因夹具前提错误失败：修正开始时间、活动结束时间和 source/mapping 同事务登记后，才将真正进入发布门的结果记为证据。

使用 `open-code-review-delegate` 的文件选择与规则解析，由宿主审查全部可审项，另有原生独立审查。没有调用外部模型；历史外部超时与结果校验失败仍是缺失覆盖。

## 实际验证

| 验证面 | 最终结果与证据 |
| --- | --- |
| 根目录检查 | `pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm build` 全部通过；日志分别为 [lint](lint.log)、[typecheck](typecheck.log)、[test](test.log)、[build](build.log) |
| 数据库 | `pnpm --filter @customer-agent/database test:all`：27 单测、1 包消费、33 PG15 集成通过；[日志](database.log)。旧 0001–0027 迁移及对应元数据保持原字节 |
| 最终受影响 API PG 集成 | `CUSTOMER_AGENT_PG15_BIN=/Users/hutou/homebrew/opt/postgresql@15/bin CUSTOMER_AGENT_API_PG15_INTEGRATION=1 pnpm --filter @customer-agent/api exec vitest run tests/content-intake.integration.test.ts -t 'family:|usage:'`：40/40 通过，136 筛除；[日志](usage.log)、[682 项输入哈希](pg-inputs.json)、[测试后输入一致性](pg-verification.json) |
| 实际 SQL 与独立语义对照 | `node scripts/probe-intake-family-sql.mjs --output .gstack/family-sql-final.json`：114/114 通过；[可重新消费的 JSON 结果](sql-probe.json) |
| 独立审查 | 宿主 OCR 全文件覆盖，独立原生审查交叉核对 SQL 和调用方；无遗留阻断问题；见 [审查记录](review.json) |

最终 SQL 探针：5,000 条无关联守卫 12.2 ms；单根 4,999 个不相交商品覆盖稿守卫 35.3 ms；100×100 商品/场景多选下三种约 5,000 条查询为 352.1/416.4/632.5 ms。查询探针不含完整资格、审批、义词表及历史存量链路；完整 5,000 条、50 页消费的 6.87 秒来自 PG 集成测试，包含夹具准备与发布。结果是本机测量，不是生产 SLA。

保留失败证据：[完整 PG 运行](integration-before-performance-fix.log)为 192/193，失败是最大目录 50 页超时。修复后只重跑全部受影响的 40 项，并复用不受影响证据，**没有将其写成一次完整 193/193 通过**。更早一次运行中发生构建产物混用，已弃作最终证据。默认 `pnpm test` 的 opt-in PG 跳过项也不算通过。[优化前](guard-explain-before.json)与[优化后](guard-explain-after.json)保留执行计划测量。

## 并行成果与剩余

[运行接入准备](../../../docs/how-to-develop-content-intake.md#运行接入准备与并行边界)列出了组织事实刷新、原生审批翻译、生产 factory、专用 ACL 与初始目录认领的输入和拒启条件。这部分是可执行的接入准备，尚未装配真实环境。

容量核查确认：上传和审核包先落盘再登记，失败报告尚无统一字节额度所有者；旧 retention 不处理 P2 对象及其不可变引用，不能直接删表/删文件代替生命周期。下一切片应统一预留、落盘、采用/释放、提交未知保护与清理核对；未确认保留期的对象不能自行删除。当前目录及局部历史性能验证不代表完整十倍历史候选/审批/回执/对象存量验收，也不代表双源 CAS 重审成本已测量。

未验证真实飞书、生产权限/模式、真实数据、Windows 普通账号、拖动、整机离线、签名包和部署。未 push、创建 PR、merge 或 deploy。

## 提交后复审（2026-10-08）

按用户要求对 `c308396` 使用 `open-code-review-delegate` 再次审查。21/21 可审文件完成、0 跳过，另补查默认排除的测试/生成物/文档与日志；未发现新的可确认缺陷，本次无运行时代码修复。682 项集成输入、27 项变更输入及 12 项证据哈希一致，0001–0027 迁移字节和元数据不变，按证据复用规则沿用上表结果，不宣称重新运行。本次仅提交复审记录，见 [逐文件覆盖与核查结果](rereview-20261008.json)。本次由宿主完成，没有新增子 agent 或调用外部模型。
