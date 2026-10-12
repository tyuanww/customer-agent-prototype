# A/B/C 第二轮补齐与集成

2026-10-08；版本 0.3.26。承接产品 `ddd1b4e`、治理 `45f5c0d`。本轮仅合成 fixture、回环 HTTP、一次性 PG15，继续原有事项，没有真实数据、凭据、生产装配、push、PR 或部署。

## 实际交付

- **A：可信组织输入候选。** `a67d40a` 接收为产品 `971c9e8`。同应用 open_id 登记采用不可变版本与 CAS，关联映射版本、目录摘要和观察截止；沿用原 writer 同事务完成事实、代际、provenance 与撤销。过期绑定可撤销再登记，未知提交重放只确认历史。每个租户/app 共用令牌签发代次、取消/关闭和限流窗口；目录每次扫描最多五页，超限或配额不足拒绝。候选表不进入 migration，真实认证仍关闭。详见 [A 证据](../../intake-organization/registered-input/README.md)。
- **B：实际业务消费者。** `912659a` 接收为产品 `26bc5a5`。原 service 在候选用途池下消费 multipart 字节，完成上传→解析→来源/质量→确认发布→另一认证主体非空分页/查询资格，以及回退、授权/撤销、旧审批失效。只有会话锁经过源码指纹固定的实验适配，业务逻辑不复制。详见 [B 证据](../../intake-runtime-consumers/README.md)。
- **产品内部修复。** service 新增可选 terminalPool，仅供失败收尾和 report 容量，默认原池。capacity 遇 COMMIT 响应未知时不再 ROLLBACK，保留占用并丢弃连接。生产 transaction、HTTP、factory、32 个迁移、冻结合同和角色上限均不改。
- **C：店铺目录治理草稿。** 仍为 OpenAPI 1.21.0/schema.v1.23 DRAFT。补受控 registrar/steward 登记和 CAS 轮换、不可改审计、私有 key 轮换/撤销、实际会话与最终截止。登记者和维护人均须当前唯一 director/manager 且有显式范围，岗位不会自动授权。`734bbc2` 接收为治理 `e833f9a`。最终 208/208 PG、5/5 合同测试、41/41 步完整 test:release 与文档快检通过；缺名错误映射修复已包含在最终稳定输入中。14 个输入及 13 份索引日志指纹核对一致，原始日志已复制到治理集成的忽略 output 目录；没有冻结/export/intake。

## 本机回收复核

- A 修正过期但仍 enabled 的绑定无法撤销/换绑、同 token 字符串新旧签发混淆及迟到 401 干扰替换供应；新增同范围 FK、finite/非空约束与注册最终时钟回滚。
- B 用真实消费者定位权限缺项；修复容量 COMMIT 未知后仍发送 ROLLBACK。用途角色不取得身份安全列、根 allocation 或直接发布写权。
- C 防止相同原始 key 换版本后继续接受旧游标，补真实会话/最终 deadline 与 NULL 拒绝；名称维护人也限定为显式登记的当前总监/经理。最终补 SHOP_DISPLAY_MISSING 的受控错误映射，保持草稿的缺名含义。

以上为本轮源码和真实合成测试的本机复核，不冒充完整外部 `/review` 或旧角色审核的扩大覆盖。

## 验证及证据复用

A 最终 52 项单元/HTTP、24 项实际 PG 通过；B 13 项新专项（10 PG + 3 单测）通过，最后期限测试补充断言后单跑通过。B 默认池 8 项受影响旧测试通过：首跑 7 过、1 项因 CLI 相对路径要求 apps/api 而失败；只在正确 cwd 重跑该项并通过，失败日志保留。这些局部日志/输入指纹与集成树逐字核对。

主集成的 23 项新增用例（A registered 10、B consumer 10、adapter 3）全部通过；lint、typecheck、test、build 通过。常规 test 的 API 308 和桌面 7 个环境门控用例跳过，不计为 PG/GUI 通过。桌面、原生剪贴板、真实 HTTP server 和设备未在本轮重跑。B 消费真实 multipart 字节但没有启动 HTTP server；复制验证是 query 资格。旧角色 15/15 不重做，完整外部 `/review` 仍 INCOMPLETE。

证据命令、原始日志 SHA、尾部摘要、输入哈希及治理检查见 [checks.json](checks.json)。A 两份日志仅去除多余 EOF 空行，原 SHA 与忽略目录原件保留；内容结果不变。B deadline 补证的时间范围明确，主集成 23 项另覆盖最终输入。

## 剩余条件

1. A 的可信登记所有者/权限、附属表/provenance 合同、五页容量与真实上游新鲜度、真实认证和跨进程配额仍须正式治理。A 的 usage 单独验证仍用 harness 管理池；B 的受限 usage 证据另列，两者不冒充同一生产装配。
2. B 的用途 ACL、窄锁和正式 factory 需在所属仓版本化、冻结/export/intake 后接入；候选信任服务绑定 actor，不提供逐用户任意 SQL 隔离。缺认领时原依赖检查继续 checked-not-activated / ready:false / legacyAdopted:false。
3. C 的协议/权限方案及精确版本尚未批准，批准后才 export/intake 和接入产品名称显示；真实 registrar/维护人名单、店铺名称和 secret 只作为真实运行所需输入，不把它们混为继续审阅合成合同的前置。普通客服不会因登记标签获得配置权。
4. 真实店铺、来源、授权与旧目录认领清单、保留期和现场设备验收沿用原 TODO；没有虚构名单，也不据合成结果删除历史或开放真实资料。

文档检查和差异检查通过；工作区根规则通过，体积预算未通过（约 32.8 MiB / 32 MiB，超约 845 KiB）。不删除合同/证据或提高阈值来换取通过。当前 TODO、计划与架构/开发交接在原事项内同步。
