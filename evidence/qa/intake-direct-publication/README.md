# 确认直发合成接入验证 · 2026-10-08

用户批准精确候选后，治理仓 `6f318d448929d1a87c5dc9e725ea4f90c48a4b97` 冻结并导出 OpenAPI 1.20.0/schema.v1.22；产品从 `dc45d742f0d6184c0850fb928b25fdfea149801c` 接收并实现。版本保持 0.3.26。消费 ID 为 `cs-ai-c11-openapi-1.20.0-schema-1.22-6f318d448929`，状态 VERIFIED_NOT_ACTIVATED，Ddev/runtime 均为 false。

## 实际行为与所有者

- 治理仓拥有冻结合同、批准和版本导出门；产品消费锁及生成器拥有精确版本/路径/字节验证。新 pair 禁止混搭和降级；前三十段迁移的字节与来源元数据不变。
- API 只产生 direct-v1 新候选，接收 confirmed=true 并拒绝旧审批载荷。四个审批写接口返回 MODE_CONFLICT，历史 GET 保留；没有审批 provider I/O 或伪造通过。
- 数据库 0031 接收冻结增量，0032 拥有直发/回退事务。当前组织事实、授权、会话、来源、质量、范围、CAS、家族与容量门仍在，最后 COMMIT 复核最早截止。
- Main 持有冻结请求与原操作，发布/回退走原生确认，默认取消；renderer 只发意图。取消不提交，退出/撤权后的迟到确认无效。旧审批格式未知操作只查询原回执，不改写成直发。
- direct-v1 不创建审批记录；历史 approval-v1 的原始材料、回执、审批期限和撤销约束保留，混合目录不能借新直发复活旧资料。
- 角色代码没有再次修改：两岗配置、四岗有 grant/范围才能操作，普通客服与历史赋能师新操作只有查询。来源确认与人工质量判断保留，取消的是组织审批。

## 验证与证据复用

环境为 Darwin arm64、Node 24.19.0、pnpm 11.19.0、PostgreSQL 15.18；仅新建临时 Unix socket PG 和 loopback 服务，输入均为合成 XLSX/身份/来源。没有读取真实客户、人员或凭据。

- 治理 `npm --prefix sites run test:release` 完整 38 步退出 0，定向直发导出测试 7/7。冻结证据随治理提交保存；旧 audit 超时与重试记录保留。
- 产品 `pnpm test` 退出 0；contracts 24、retrieval 9、intake parser 56、database unit 27、API unit 507、desktop 1308 均通过，另有包入口和脚本检查。环境门控制的 PG/外部宿主测试存在跳过，不能算通过；本次受影响 PG 与 Electron 在专项另跑。
- 实际 API/PG intake+material 首轮 165/168 通过；3 项暴露时间截止问题。修复后定向 11/11 通过，包含全部 3 项失败及新增内容截止；随后单独加强内容截止证明 1/1 通过。当前共 152 项 intake+17 项 material，复用未受影响项，不宣称最终重跑了全部 169 项。
- 最终数据库 PG 35/35 通过，含三十行旧账本升级、空库、并发、漂移、ACL 拒绝；未放宽 verifier。函数指纹为 `225:4d6d47123400c992b392024f24c0058fa74f517a6392318ed5cec809fc0f8bfc`。
- CLI 实际 HTTP/PG 与进程清理 5/5 通过；桌面定向 124/124、Electron 管理 wire 1/1 通过。上传及回退实际 Electron/HTTP/PG15 2/2 通过，最终 SQL 修复后同一两条闭环再次 2/2 通过（21.6 秒）。
- lint、typecheck、build、合同校验与生成一致性通过。文档引用检查通过；工作区根策略通过，但新增冻结快照后源码体积超过既定 32 MiB 预算，工作区检查失败。没有删除旧合同/证据或改大阈值，详情见 checks.json。

可复现入口：`pnpm test`、`pnpm --filter @customer-agent/api test:intake:transactions`、`pnpm --filter @customer-agent/database test:integration`、`pnpm test:intake:synthetic`、`pnpm test:intake:desktop`。PG 命令配置 `CUSTOMER_AGENT_PG15_BIN`；构建依赖按入口脚本执行。

实际 GUI 消费了坏 XLSX、下载并用 ExcelJS 回读错误报告、整批修订、来源确认、人工质量检查、取消/确认发布；另一普通客服查询并经系统剪贴板复制多行原文。数据库 reviewBindings=0、approvalFacts=0。回退先发布两版，取消不新增版本；确认后创建新 release，另一客服复制历史原文。原生文件路径与弹窗响应受控，不等于真人按钮或设备验收。

## 本轮发现与修复

1. 质量 GET 投影 ready，但持久状态仍 awaiting-evidence。0032 在所有门通过后，于同一事务合法推进 ready→publishing，没有放宽状态机。
2. 去掉审批期限后，使用读取需要显式检查当前来源模式/映射、已发布材料及来源确认。新增失效回归，不能由新资格复活旧映射。
3. 整本目录可以保存过期/未来条目供读端筛选。发布期限只纳入受理时尚未来的有效截止；过去截止不阻断保留历史。新增证明在 SQL 已完成写入后跨截止，最终 COMMIT 整体回滚。
4. 两处错误提示原先将来源模式冲突、关键稿人工检查都归到旧审批；已改为准确的恢复说明，IPC 单测与定向 lint 验证。
5. 合同变更后的旧 dist 和旧测试迁移数量/显式历史夹具已修正；Electron wire 等待真实 Query 激活完成，不改产品窗口行为迁就测试。

## 审查与限制

本机核心复核及并行模块复核覆盖新 API/SQL、Main 恢复、合同 intake/生成/旧账本来源；迁移检查逐字节验证前 30 段。用户提供的角色审核 15/15 原结论复用，没有重做角色审核。外部工具先前 180 秒超时没有结论，本次不无界重试；完整 `/review` 仍 **INCOMPLETE**，不宣称本次所有新文件外部审查通过。

原生产 app/server/factory 与应用 ACL 未开放；组织观察仍为 experiments 离线实现。真实组织认证/刷新、用途受限权限及运行装配、真实店铺来源与旧目录认领、正式名称/保留期及设备业务验收仍按原事项等待。无 push、PR、合并、部署或真实数据接入。

原产品目录的 TODOS 修改和未跟踪计划保留。`inputs.json` 绑定本次产品文件；`checks.json` 记录结果和复用范围；`logs.json` 索引 `logs.json.gz` 中的完整原始文本、字节和 SHA-256。该压缩包是 UTF-8 JSON，可用 Python gzip/json 原样回读，不以截断摘要替代原始日志。
