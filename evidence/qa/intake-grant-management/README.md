# 内容管理内业务权限配置 · 合成增量

基线 cff9fa9，分支 codex/intake-grant-management，版本保持 0.3.26。

此切片复用已消费 OpenAPI 1.20 的主体目录、authorization、grants 列表/预览/保存/撤销合同，提供 Content 管理内“资料 / 权限配置”局部切换。姓名来自当前可见主体目录，范围来自当前分配资格，renderer 仅持短期选择句柄。总监/经理资格判断复用原 authority；角色上限、0030、正式 schema 未变。预览严格只读，保存重验，撤销保留历史。当前姓名不可用的历史授权按可管理记录编号、范围、时间、原原因识别并确认撤销，不暴露隐藏员工信息。

## 已执行

环境：macOS arm64、Node v24.19.0、pnpm 11.19.0、PG15（隔离合成数据库）。复用依赖符号链接，没有安装依赖。精确命令、退出码和日志 SHA-256 见 checks.json；源输入指纹见 source-sha256.json。

- 实际 loopback HTTP + 非超级用户用途池 + PG15：3/3 PASS。覆盖目录姓名→只读预览→保存/幂等重放→列表→已停用对象撤销；150 条跨范围不可见行不进入分页扫描或游标；资格变化游标失效；伪造字段/越范围/预览后停用/半批非法拒绝且无部分写入。
- 桌面单元/组件：8 文件、80/80 PASS。新增 Main 的未知提交原请求恢复、取消/迟到/会话更换、人员更早到期、隐藏姓名撤销，以及 IPC sender/main-frame/无会话边界；真实控制器接组件预览/保存/撤销。复用受影响上传/回退/访问与管理 IPC 检查，不重做旧角色审核。
- 修改文件 eslint、API 和桌面 tsc --noEmit、桌面 electron-vite build：PASS。
- git diff --check：PASS。

## 等待主集成验证

独立 grants-http plugin 需要在既有 management-http 的唯一 service 创建后注册：`app.register(contentIntakeGrantRoutes, { auth, service, report })`。此分支不改并行任务拥有的 host/management-http，不另造 service 或生产装配。

真实 Electron 用例 `content-intake-permissions-real-stack.spec.ts` 已编写并通过类型/lint；尚未执行，不记 PASS。它要求并行 B 的 `purpose-candidate` host、已有 director 身份与 `revokeSyntheticQuery()` 控制；主集成接唯一 plugin 后执行。流程是总监选择具名合成坐席→预览/取消不生效→保存后另一坐席新查询资格成功→撤销后新资格拒绝。该实跑不等价于单独验证 manager 身份、真实员工/店铺或生产装配。命令：`CUSTOMER_AGENT_INTAKE_SYNTHETIC_E2E=1 ./node_modules/.bin/playwright test tests/e2e/content-intake-permissions-real-stack.spec.ts`（apps/desktop）。

完整 lint/typecheck/test/build 的跨 A+B 集成回归、用途候选正式冻结/接入、真实业务名单和最终真实业务验收仍由主任务推进。共享计划/TODO/架构及新 preload 白名单由主 Agent 统一同步。完整外部 /review 保持 INCOMPLETE；无 push、PR、合并、部署或真实数据读取。
