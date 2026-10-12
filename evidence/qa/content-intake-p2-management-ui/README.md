# P2 管理候选与人工质量检查

基线 `19eefc4`，分支 `codex/content-intake-p2`。仅显式 loopback FAQ 合成 profile；不接真实资料、飞书凭据、生产 factory、ACL 或 activation。提交、推送、PR、部署是不同动作；本轮仅沿用本地 commit 授权。

## 可验收行为

有权候选分页 → 选择确切候选 → 完整材料与差异 → 服务端冻结抽样 → 人工逐条填写 → 提交质量检查 → 不确定时查询/重试原操作回执。API 每页验权，Main 拥有 key/草稿/操作 ID，Dashboard 主帧窄 preload 不提供 Node、HTTP 路径或通用 IPC。查询席无管理权限时只显示空态。

候选列表每页至多扫描 `limit` 个版本；动态状态由 `readCandidate` 重新推导。状态过滤可能留下空页且有 nextCursor，调用者须继续分页；该列表不承诺跨请求同一时刻快照。恢复游标绑定会话、当前完整权限、来源和状态过滤条件，服务重启或授权变化失效。

## 审核与修复

使用用户指定 OCR delegate 确定文件及规则，宿主逐文件审查；另按 `/review` 执行原生对抗审查。未调用外部模型，历史外审超时/失败不改写成通过。初审及最终复审累计确认五项，均先补失败复现：

1. 跨来源撤权后旧材料仍可显示：改为选中来源单独判权，授权刷新清除已失权选择及缓存。
2. 已保存判断再次编辑后可提交旧值：UI 跟踪未保存编辑，阻止提交、翻页和切换，明确保存后再交付 Main。
3. 失效回读迟到覆盖新会话：失效回读和命令共用 generation，旧响应不能回灌材料。
4. 初检期间可填写扩检并陷入无法提交：Main 和 UI 均要求 phase 对应当前状态，未来阶段只读。
5. 翻页重新取得权限期间旧候选元数据仍可读：列表请求开始即清除旧页和旧游标，当前视图不再输出失权来源的上一页。

原始失败与修后日志留在忽略目录 `.gstack/qa-reports/content-intake-management/`；测试 fixture 只含合成数据。首次 PG 探针中测试准备误用受保护 UPDATE，两次分别被数据库状态约束和 grant 版本约束拒绝；已改为实际确认/审批及版本化撤权，不修改生产约束。

## 验证入口与证据边界

- Desktop 相关单元/组件：Main、IPC、质量状态、未保存编辑与迟到响应回归。
- 实际 PG：`CUSTOMER_AGENT_API_PG15_INTEGRATION=1 pnpm --filter @customer-agent/api exec vitest run tests/content-intake.integration.test.ts`；包含新的分页权限测试及原有全部事务场景。HTTP→Main 子进程通过已有根桥接，进程内凭据不写入日志/参数/文件。
- Mac Electron：`pnpm --filter @customer-agent/desktop exec playwright test tests/e2e/content-intake-management.spec.ts tests/e2e/content-intake-query.spec.ts`。使用两个隔离 loopback wire 服务、独立临时 userData，验证实际 Main/preload/renderer/sandbox；不是实库测试。关闭/退出测试由测试进程选择原生对话框结果，不能替代真人点击体验。
- 根 `pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm build`，以及 `pnpm workspace:check`。最终计数和文件哈希见 [verification.json](verification.json)；全部上述检查 PASS，定向 31 项、PG 126 项、Mac Electron 2 项，最后默认 Desktop 1184 项通过。原始输出保留在上述本地 QA 目录。

本轮不宣称 Windows / WSL、签名安装包、真实 Feishu 或完整 FAQ 管理闭环已验收。工作台尚未接新上传、来源确认、组织审批和发布按钮；没有伪按钮或自动审批。质量通过不是组织审批或发布授权。

## 下一阶段合同差集（供所属仓治理）

| 所需事实/能力 | 冻结合同当前行为 | 建议的最小合同增量 / 验收条件 |
| --- | --- | --- |
| 创建候选所需发布基线 | `IntakeReceive.baseReleaseId` 必须等于现行全局发布指针；sources/authorization 不返回该事实 | 由 intake 的管理上下文读口在 source 的 import 权限下返回 `sourceVersion` 与 nullable `baseReleaseId`；无租约副作用、不泄漏别的来源正文；并发新发布仍由 receive 拒绝 BASE_CHANGED，不能客户端推断最新列表 |
| 声明整理人与实际改稿人 | receive 接收确认过的 principal ID；ProductSession userId 与 principalId 不是同一命名空间 | 同一管理上下文提供服务端认证主体的已确认 principal 映射；另提供有界、分页、可取消的参与人选择合同。显示名/人员范围的可见权限由立项仓明确，输入的目标人不成为执行者；真实员工目录仍需独立授权 |
| 接收前版本/修改目标 | source 映射有 version，候选列表提供候选 key | 复用现有 source/candidate，不增加第二版本源；选择已有候选修订时 Main 使用服务端 key；遗漏行仍不删除 |
| 错误报告保存 | API 返回实际 xlsx 二进制；现有 ProductHttp 只消费 JSON | 产品仓 Main 增加有界二进制读取及原生保存能力，renderer 不获取路径/文件系统；验证实际报告能被 Excel 库重新读取、取消不残留半文件，不需擅改已有 HTTP 合同 |
| 来源、组织审批和发布界面 | 已有确认/review/refresh/publish/receipt HTTP，合成实库流程已通 | Main 所有者组装候选/证据版本与原操作 ID，界面只收人工来源版本、说明与发布标题/摘要；API 每次验权；审批仍在飞书，当前无审批 URL 时不能拼造链接 |

推荐把新的管理上下文及参与人选择定义做成所属立项仓的下一合同候选；冻结须按该仓的准确候选及哈希批准，再版本化 export/intake。现有合同内的来源确认/审批状态/发布界面与错误报告读取可独立继续。这里是差集与验收条件，不是正式合同批准或新 API 已存在的声明。
