# CI 修复增量审核与就绪修订实验（2026-10-12）

## 范围与结论

产品 `codex/intake-organization`，精确 `8e95ce5..2405494`，21 文件、206 行新增／53 行删除；版本0.3.26。本机核心、Testing、Maintainability、Security、Performance、API Contract、Simplification、Red Team 及 native adversarial 未发现当前增量可行动缺陷。Data Migration 与 Design 未触发（本次无迁移正文、renderer或视觉改动）；不是整分支审查通过。

新增 Query 握手先注册接收器再通知 Main；Main 检查可信 Query 主帧，按当前打开意图重建 handoff，旧编号及计时器失效，晚到订阅不撤销关闭。测试专项完整阅读变更测试；安全／native对抗对fixture只做摘要，不能代替测试正文覆盖。门禁扫描 listed41/eligible33/inspected33/unread0；预算变更直接复用用户明确批准18.5/16/10.5，总45不变。0035仍先单独验证八项不可转授EXECUTE，再追加后继；未通过删断言、放宽超时或接受PG16掩盖失败。

## 外部结论与逐项核对

外部 runner为 `gstack-claude-code --access none`。初始结构审查和对抗调用各180秒超时。30秒最小诊断返回 `ROUTE_OK`，CLI `modelUsage` 报 `claude-opus-5[1M]`，未独立验证服务端模型身份。再拆成桌面8文件／CI测试9文件（4份Markdown由主审核对）：CI测试返回结论；桌面仍180秒超时。本轮停止重试，不能据此认定仅因上下文超限。

CI测试外审报P2：块体beforeAll未return启动Promise。**反驳**：`packages/database/src/testkit/pg15-harness.ts:64` 明确 `start(): void`，内部 `run` 调用 `execFileSync`，`pg_ctl -w start` 等待服务后再用psql查版本；不是Promise。`packages/database/tests/menokin-source-registration.integration.test.ts` 在beforeAll同步启动不丢等待；既有显式启用PG15记录1项通过，禁用记录正确跳过。无需无意义增加return。本外审的可行动缺陷计数为0；桌面外部覆盖仍缺，Markdown不计入外部代码覆盖。

完整 `/review` 与 `externalCompleteReview` 保持 **INCOMPLETE**；本机结论不补齐超时外审，旧整分支门禁限制继续保留。未改既有review.json完成标记。

## 精确复用的验证

仓外交付回执中全部受测输入与日志SHA-256重新核对，无失配；复用Query实际Electron红1／绿3、IPC/preload28、白名单9、float108、预算49、锁进程9、组织transport28及PG启用/禁用证据，不机械重跑。

`2405494` 远端[CI](https://github.com/tyuanww/customer-agent-prototype/actions/runs/38164180991)：Linux canonical、Windows/Linux打包冒烟、Verification scope通过；数据库75通过，旧API110通过／2个就绪断言失败，后续backend E2E及G1A独立步骤跳过。hosted smoke不是办公设备验收。

## 已完成的下一步：数据库修订假设验证

权威输入为已消费 `cs-ai-c11-openapi-1.24.0-schema-1.28-379b793811ed`。冻结DDL的public/ops_loop注释止于1.17/1.18；0034新增五个格式函数未撤销PostgreSQL默认PUBLIC EXECUTE，后续冻结增量未补齐。本结论定位兼容阻塞，不声称可利用提权。

隔离PG15加载真实40段迁移后，未改API探针，用仓外SQL候选验证：

1. 原状态not_ready；仅撤五函数PUBLIC授权、为现有business/worker/NOLOGIN函数属主保留纯格式谓词的EXECUTE后，ACL检查变true，但旧版本注释仍拒绝。
2. 同时修正版本标记后，原严格探针返回schema=ok；三个内部角色仍能执行格式谓词，旧app_runtime登录仍42501。
3. 重新授予PUBLIC EXECUTE、给登录账号直接EXECUTE、直接SELECT内容表均被同一探针拒绝；撤销漂移后恢复。

另从2405494制作仓外隔离副本，只在两份原测试的真实迁移之后执行候选SQL；API业务源码及原断言未改。原两条失败测试实际得到 **2 passed / 31 skipped，exit0**。这些是候选实验，不是正式迁移验收，不改写当前PR的CI失败。

候选目前只针对1.28环境验证根因，未分配正式后继版本/迁移号，未冻结、export或intake；应用前还需由治理仓生成后继合同，明确版本批准，补受限writer上传/解析及迁移安装回归，再正式交接。不能直接改0001–0040、冻结DDL或放宽API探针。

## 证据与限制

原始外审响应、逐项核对、SQL与两个实验脚本/日志保存在仓外 `客服Agent-SOP图片闭环-20261011/ci-delta-review-20261012/`；机器回执 `review-receipt.json` 记录输入和证据摘要。目录未随Git交付；本报告不把本机路径当成远端可访问证据。没有新增真实数据、生产激活、部署、最终Mac安装包或办公Windows人工验收。治理原有9项修改保持原样。

## 后继候选补齐（2026-10-12）

本段承接上述诊断，不改写其当时状态。治理仓新增 `build_customer_agent_readiness_successor.mjs` 与 `readiness-successor-candidate`：沿用 OpenAPI 1.24.0 原字节，拟 schema 1.29／0041／`content-intake-readiness-successor-v1`。生成器固定1.28前序和40段迁移回执锁，参考schema保留前序原字节，仅追加五函数PUBLIC撤权、三种既有内部角色的纯格式谓词EXECUTE及版本标记。未改产品迁移、业务源码、正式合同锁或API探针。

新增生成器5项通过；真实隔离PG15父测试及11子项共12项通过，验证前序缺失/篡改、角色异常、整笔回滚、函数正文及安全属性不变、权限/版本门和三类ACL漂移。当前1.28解释器仍拒绝1.29，未把未来版本当作已接收；同一严格SQL使用拟1.29版本参数返回完整关闭的策略标记。

仓外隔离副本在真实40段迁移之后安装相同升级SQL；受限账号HTTP/PG15套件9项通过：四域CSV发布及另一客服读取、XLSX上传解析、幂等、worker错误报告/修正重传和越权/格式拒绝。测试沿用非超级用户用途池，未替换数据库返回值或业务函数。首次命令因临时路径规范化问题未收集测试；改为副本规范工作目录后9项通过，原失败日志保留。此证据不是正式迁移或最终CI。

命令、输入摘要、安装SQL、补丁及日志保存在仓外 `readiness-successor-20261012`。新候选仍DRAFT，未经冻结/export/intake，完整审查保持INCOMPLETE；需精确候选批准后沿正式版本交接，不能修改历史0001–0040或用新版本注释单独放行当前消费者。

接收体积预检：当前workspace为43.3/45 MiB、合同组15.7/16 MiB，检查通过；完整候选再复制会令合同组约17.3 MiB。候选已补固定前序+差量的组合说明及字节还原测试，五件候选4KiB块投影不足64KiB。该方案仍需正式export/intake消费者实现与最终预算验收；没有修改预算或历史文件，不把预测当作安装结果。

## 就绪后继正式接收（2026-10-12）

用户批准固定前序＋差量的精确候选：OpenAPI 1.24.0、schema 1.29、迁移 0041、profile `content-intake-readiness-successor-v1`。治理仓已提交 `75e1889efee91322dab1dfa28aadc53fd718682b`，`test:release` 与 export check 均退出 0；导出目录为 `cs-ai-c11-openapi-1.24.0-schema-1.29-75e1889efee9`，状态 `EXPORTED_NOT_INTAKE`。

产品由同一导出包完成 intake：合同锁记录治理源 SHA，0041、生成 manifest/provenance 与固定前序组合已落工作树，状态 `VERIFIED_NOT_ACTIVATED`，`ddev_authorized=false`、`runtime_activated=false`。PG15 迁移和运行时测试 75/75 通过，产品 intake 定向测试 11/11 通过；先前 DRAFT 候选的 5/12/9 项记录保留为历史候选证据，不改写为正式交接结果。此次接收仍未接生产 runner、HTTP、真实飞书或客户资料，也未完成 Windows／办公设备人工验收。
