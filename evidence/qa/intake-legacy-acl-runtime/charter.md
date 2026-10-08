# schema1.25 旧目录校验权限合成回归

- 授权：批准治理 231cba56 的三个精确对象，继续冻结、完整导出/接收、追加迁移与旧目录发布/回退；仅本地 commit。
- 基线：产品 f6f8cf35；现有 schema1.24/34 段。正式来源须为治理冻结提交，不在夹具临时补权。
- 接口/所有者：治理拥有 ACL 合同与完整 v4 包；根 intake 拥有来源/批准/哈希/完整成员验证；database 拥有追加迁移、账本与精确后验；API 复用业务用途池。
- 方案：沿旧完整 CSV 安装清单追加外层闭包，复用同一内部验证器；相比只运输一个 SQL 补丁，它保留所有安装依赖；相比重放完整 DDL，它保留旧账本与角色身份。新 migration 只执行获批的八个 helper EXECUTE。
- 隔离：临时 Git 根、Pg15Harness 独立本机集群及合成身份；不读环境数据库、真实资料或凭据，不启生产 HTTP/ACL。不变桌面交互/角色上限不重审。
- 必需契约：完整 16 件真实出口可接收且同源；缺件/篡改/降级拒绝；34→35 旧账本与SQL相等；新增ACL恰好8项；缺函数整体回滚；后验拒绝撤销/泄漏/grant option；受限业务身份完成旧8行发布→下一发布→纠正回退；失效来源/授权/旧审批拒绝且无副作用。
- 命令：生产者实际 export/verify，消费者 ingest/verify/codegen/generate；database generator/planner 与 PG15；API受影响 legacy publish/rollback 和 runtime consumers；根 lint/typecheck/test/build/docs/workspace。
- 证据复用：批准SQL与旧依赖不变，治理原17 PG复用。先前角色15/15、Mac CSV/XLSX/Electron安装副本证据保留其原输入范围；本次不重打包、不冒充新包验收。完整外部/review保持INCOMPLETE。
- 退出：上述当前输入必需检查通过，既有预算失败如实披露；两个工作区本地提交并干净，原Desktop目录的TODO和未跟踪计划保持不变。
