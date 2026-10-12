# 正式用途消费者接线：局部合成证据

本目录绑定 schema 1.23 / migration 0033 的产品消费者。真实 service、grants HTTP、注册组织刷新均直接使用正式 `intake_runtime` / `intake_organization`；无 SQL 文本替换、候选 SQL 安装器或生产 HTTP 注册。源哈希、复合验收结果和日志指纹见 `checks.json`。

用途池拥有 LOGIN 连接、每次借用时的 SET ROLE/assert_purpose、空闲错误与关闭；逐用户业务授权仍由原 service 拥有。组织三模块从 experiments 迁入 `src/content-intake/organization`，没有复制 writer。HTTP transport 留实验目录，只有合成测试调用。

以下均在 `apps/api`、Node 24.19.0 / PostgreSQL 15.18 运行，无依赖安装：

- `CUSTOMER_AGENT_API_PG15_INTEGRATION=1 ./node_modules/.bin/vitest run tests/intake-runtime-consumer-pool.test.ts tests/intake-runtime-consumers.integration.test.ts experiments/intake-organization/registered-refresh.integration.test.ts tests/intake-organization.integration.test.ts experiments/intake-organization/transport-consumer.integration.test.ts experiments/intake-organization/transport.test.ts experiments/intake-organization/session-owner.test.ts` → round2 日志。除 registered SQL 错误码旧断言外均通过；该项以下定向最终结果替代。
- `CUSTOMER_AGENT_API_PG15_INTEGRATION=1 ./node_modules/.bin/vitest run tests/intake-runtime-consumers.integration.test.ts tests/intake-runtime-candidate.integration.test.ts tests/intake-grants-http.integration.test.ts experiments/intake-organization/registered-refresh.integration.test.ts tests/intake-transaction-runtime.test.ts` → formal-runtime-final。消费者随后增加 idle 断连回归，以 round2 为准。guard 1、grants HTTP 3、finalizer 4 通过。
- `CUSTOMER_AGENT_API_PG15_INTEGRATION=1 ./node_modules/.bin/vitest run experiments/intake-organization/registered-refresh.integration.test.ts` → registered-final，9 项通过；第 10 项 fixture 调整后由下一条补齐。
- `CUSTOMER_AGENT_API_PG15_INTEGRATION=1 ./node_modules/.bin/vitest run experiments/intake-organization/registered-refresh.integration.test.ts -t 'rejects cross-scope'` → registered-sql-final，1 项通过、9 项按筛选未运行；不写成重跑全组通过。
- `CUSTOMER_AGENT_API_PG15_INTEGRATION=1 ./node_modules/.bin/vitest run tests/content-intake.integration.test.ts -t 'usage: linearizes|usage: Main consumes|usage: caps issuance'` → session-formal-regression，4 项通过、148 项按筛选未运行。
- API `tsc --noEmit`、`tsc -p tsconfig.build.json` 和改动文件局部 ESLint 通过。

首轮 formal-runtime-b 保留旧 verifier 阻塞的原始失败记录。它同批的历史 scope 4 / assembly 8 / boundary 8 与 observer 19 通过。三个历史 probe 测试显式使用不可变前 32 迁移，不能作为正式角色接入证据；正式 0033 消费者的后续通过结果已分别绑定。

四域 HTTP、Mac Electron 与最终全仓验证由主 Agent 汇总。此处不宣称生产装配、真实飞书、真实店铺或完整外部审查通过。
