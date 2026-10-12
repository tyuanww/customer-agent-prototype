# P2 FAQ 纠正回退合成验收

基线 `e28b1d49a85381f3cb35ac20254b097b6a3f2674` 后本轮差异。环境：macOS 26.5.2 arm64、Node 24.19.0、pnpm 11.19.0、PostgreSQL 15.18。全部资料、人员、店铺和审批为合成输入；没有真实飞书调用或生产运行接入。授权及方案见[计划 §0.43](../../../docs/plans/2026-10-03-content-intake-requirements.md#043-faq-纠正回退实施2026-10-08)。

## 交付行为

工作台输入当前版本及上一发布版本，先看实际影响，再发起独立复核并确认回退。原候选审批不能复用；提交重新检查全部范围、基线、来源、审批和有效期。回退原子生成新的 release、公告和永久回执，复制仍然可用的目标谱系，不直接把当前指针改回旧 ID。部分权限仅展示有权来源并引导完整纠正稿上传，不能执行局部伪装的全目录回退。

API `rollback.ts` 拥有不可变计划、审核包和 provider 创建恢复；数据库 `0027` 拥有锁序、CAS、提交票据及新发布。Main 独占计划、摘要和原操作，renderer 只提交用户意图。后续发布和坐席查询继续受回退审批有效期／撤销约束，旧发布入口不能丢弃这条依赖。原 `0001–0026` 未改写；仅既有不可登录 definer 获新谱系表 SELECT 以执行旧入口拒绝检查，应用角色仍无访问权。

UI 沿用 DashboardWorkspace、现有字体／间距／圆角及光暗 token。最终截图等待主题过渡完成：[浅色](rollback-light.png)、[深色](rollback-dark.png)、[另一坐席查询](rollback-ordinary-seat.png)。仅验证 Mac 开发态，不代替 Windows GUI 或原生人工交互。

## 实际验证

命令、最终被测源码和日志／截图 SHA-256 见 [verification.json](verification.json)。

| 验证面 | 实际结果 |
| --- | --- |
| 根 `pnpm lint` / `pnpm typecheck` / `pnpm test` / `pnpm build` | PASS；最后修复另做相关定向检查与最终完整 build/E2E |
| 根默认测试 | API 476 PASS、250 条需独立环境跳过；Desktop 1295 PASS、6 条需独立 HTTP 环境跳过。没有把跳过计入通过 |
| API 实际 PG15 | 完整 intake 文件 158/158 PASS（243.29s）；新增授权截止后回退专项 14/14 PASS；最后 HTTP 边界补验 1/1 PASS。当前159例的证据分次取得，不称为最终159例一次全跑 |
| 数据库控制面 | 实际 PG15 25/25 PASS；unit 27/27、编译包消费者1 PASS。涵盖旧26段前缀仅追加27、历史升级、精确ACL／函数／对象核验与并发安装 |
| 最后 Main／IPC／组件定向 | 5文件62/62 PASS；追加文案断言后 component 3/3 PASS |
| `pnpm test:intake:desktop` | build PASS；两个真实 Electron→HTTP→PG15 用例 PASS（26.1s）：保留旧上传／修订／取消流程；新回退 `rel_2 → rel_3 → 新 rel_4`，普通坐席查询原文逐条匹配 |
| docs／workspace／diff | PASS；最终证据落盘后再次检查引用及source budget |

API 回退覆盖：独立贡献人回避、错误影响摘要／附件、创建响应未知原 UUID 恢复、COMMIT 响应丢失原键重放、同键不同正文拒绝、撤权与并发发布、取消已发布目标不生效、过期目标、原始／继承审批撤销、继承审批期限、授权在预览提交前到期不留下计划。双来源／双店差集使用明确标记的合成复合目录 fixture；正常单来源发布不能被说成双来源原子发布。

数据库和最后桌面定向测试的原始 stdout 仅在本会话工具输出中，没有另存日志或伪造哈希：数据库 PG session50583/chunk2126ce，unit/package session5836/chunkd19550；桌面定向 session93132/chunkf2b4d4、组件 session60816/chunk5d17ad。根默认测试及 API/Electron 原始日志随本目录保存。测试资源仅有自有临时 PG、对象与 Electron profile，E2E finally 清理并检查目录移除。

## 审查与修复

按用户指定 `open-code-review-delegate` 执行 OCR 文件选择和规则解析，由宿主逐文件检查；另做独立宿主对抗审查，按 `/review` SQL安全、竞态、合同、失败恢复检查表复核。测试／fixture 对独立审查员仅提供覆盖摘要，主审读取测试和实际结果；生成物以 authored overlay、确定性生成及实际消费者验证复核。逐文件清单见 [review.json](review.json)。

已修复并复核关闭：

1. 正常候选审批刷新 generation 被误当撤销标记，阻断合法历史目录；改为核验明确撤销事实、来源确认和当前有效性。
2. 回退回执多出冻结合同不允许的字段；收敛为既有严格 schema。
3. 影响预览及包冻结未登记 rollback grant 最早截止；复用现有 authorize 登记到最终 COMMIT，实测到期整笔回滚。
4. 审批创建未知后并发发布改变基线，原键重试永久阻塞管理；仅在服务端明确 BASE_CHANGED/MATERIAL_CHANGED 时终结本地失效计划，提示外部审批可能已创建但不能发布。网络、未知提交和权限不足仍保留原操作。
5. 后续原生发布／坐席读取继承回退审批；旧发布入口拒绝绕过继承。光暗截图首版未等主题过渡，最终用实际颜色断言后重新采集。

独立零修改复核确认两项正式 finding 关闭，无剩余已确认缺陷。未调用外部模型，本轮不声称完整外部或双模型 `/review` 通过；历史外部超时、输出校验失败保持未完成覆盖。

## 尚未完成

P2 仍剩显式同题家族、跨来源冲突／品牌不可覆盖／店铺优先与通用回落，以及对象预留／retention／十倍存量和运行交接。真实组织事实、原生飞书审批 transport、应用 ACL／生产 factory／旧目录认领按对应批准环境接入。SOP/media 属 P3；杭州普通账号、可靠拖动、整机断网等待现场条件。本轮未制作新安装包、未做 WSL／Windows 新版本验证，也未push、PR、合并或部署。
