# 内容管理权限配置：工程差异记录

基线 cff9fa9；版本保持 0.3.26。本记录复用既有获批资料导入计划 §0.52–0.53 与当前任务明确授权。按 plan-eng-review 的架构、代码质量、测试、性能维度核对本次增量；没有重新启动 autoplan，没有重审旧角色上限，也不把本文标为新的完整外部 review 通过。完整 /review 仍为 INCOMPLETE。

## 范围与边界选择

选定现有内容管理内“资料 / 权限配置”局部切换。与独立权限侧栏大模块相比，不复制导航、主题或产品会话，不增加业务模块。首片仅 business 权限预览、保存、可管理列表和撤销；delegation、接管和初始 root allocation 不增加 UI。

API 唯一合同为已消费 OpenAPI 1.20.0：GET/POST `/v1/intake/grants`、POST `/v1/intake/grants/preview`、PATCH `/v1/intake/grants/{grantId}`。既有 create/change 事务复用，补全严格无写入的 preview 与当前权限绑定的分页列表。共享批次验证在 authority 内拥有；recipientRoleAllows、allocationKinds、parentAuthority 业务含义不改。0030、冻结 schema、版本与生产工厂不改。

来源范围复用 authorization.mayAllocate；人员复用 principals 的 grant-recipient 目录。Main 保存主体/范围/事实版本/操作号与精确未知请求；renderer 只能使用不透明选择句柄及动作、时间、原因。独立 grants HTTP 插件借入同 service；management-http/host 注册由主 Agent 回收。

## 数据流与失败路径

内容管理权限面板 → 独立 dashboardPermissions 白名单 → 每窗口 Main 状态机 → 原 ProductSession → grants HTTP → 原 service/事务/PG。

- 查询只列当前可管理范围。SQL 先以当前母权限与发现范围收窄扫描；游标不携带无权 grant ID。分页重新检查会话、事实和完整可分配范围；游标防篡改，空页/重复游标有界。
- 预览无 grants/history/receipts/generation 写入，不用回滚模拟只读。预览 ID 仅标识未保存拟议记录，不能拿来撤销；正式保存重新校验和分配正式 ID。
- 人员事实变化、母资格到期、越范围、同人/角色越限、伪造字段：按原消费者拒绝，整批原子。
- Main 单一未决写入；重复点击拒绝。超时/取消/异常响应保留精确原请求，仅允许原请求恢复，不另造操作编号。
- 会话变化、窗口销毁、手动停止使迟到响应失效。人员更早的截止驱动预览/可选人员失效，不借用较长的调用者截止。
- 历史人员没有当前展示名时不猜人名或暴露隐藏主体标识；按授权记录编号、范围、动作、原授权原因及时间明确核对后可撤销。
- 预览写“尚未保存”。保存回执明确是原操作记录，当前状态须刷新；复制仍仅为已复制。

## 验证计划与证据归属

实际 loopback HTTP + 一次性 PG15 + 非超级业务账号：目录姓名选择、预览零持久写、创建/重放/可管理分页、停用人员撤销、150 条无权范围记录不影响分页/泄漏游标、母权限变化使游标失效、预览后失效拒绝、伪造请求与整批原子失败。

Main/IPC/component：句柄替代身份 ID、预览未保存、未知提交原请求恢复、超早人员截止、取消与迟到响应、登录代际失效、未知姓名可辨认记录撤销；非 Dashboard/子 frame/多余字段在调用会话前拒绝；实际点击预览/保存/撤销。

复用旧角色审查，不再次运行旧 15/15 审核。受影响既有管理组件、access、upload、rollback、IPC 定向回归。跨 A+B+C 实际安装候选与 Electron 消费由主 Agent 集成后执行；当前不能把独立层通过写成正式装配或真实业务验收通过。

## 性能与设计复核

发现复用已有完整分页，不另建身份/来源缓存。grants 服务端每页最多扫描 limit+1、limit≤100；每页权限过滤前已限定可见范围，最终共享 parentAuthority 再验，最多每个候选行固定几次受限查询，事务保留原 5s 总截止。Main 最多 50 页、8 MiB，单页 256 KiB，拒绝截断后继续操作。服务器当前列表是逐页重验菜单，不宣称跨 HTTP 原子快照。

本次不新增店铺名合同、真实人员名册、配置读取、预检工具、SOP、同步或生产装配。
