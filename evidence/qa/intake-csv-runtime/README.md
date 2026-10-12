# CSV 正式合同消费与合成接线

基线为产品 `54f428ca8296aba9a75d2205439b3063cfef8c9b`。版本保持 0.3.26；运行环境为当前 Mac arm64、Node 24.19.0、pnpm 11.19.0、PostgreSQL 15.18。仅合成输入、本地实现和提交；没有真实客户/员工正文、凭据、生产配置或部署。

## 批准、快照与所有者

用户批准治理 `5335107` 五项精确摘要的冻结、完整 export、产品 intake 与 CSV 合成接线。冻结来源 `adbc7b1ce251816fc02957a0042742ae2d053f9a`，导出回执提交 `91a7940465c8621404b50b67f97181923015b2b5`。产品已实际接收 14 件 v3 包 `cs-ai-c11-openapi-1.22.0-schema-1.24-adbc7b1ce251`，manifest SHA-256 为 `0bb26dccad0c3007435cff0666a5033f4ee439504c70fe47eead66f8e9a6d977`；OpenAPI 1.22.0、schema.v1.24，仍为 `VERIFIED_NOT_ACTIVATED`、runtime/Ddev=false。

| 冻结文件 | SHA-256 |
| --- | --- |
| OpenAPI 1.22.0 | `3f741eb980aba1cd9a2a273b25771b50299e1aef3acbc6a1579b57541ed43a94` |
| schema.v1.24 | `c4ceffa961728423b755b00d551b9ab67fbf33ffe1dd87d8e671f6d151f744c5` |
| CSV protocol | `ff83a005795f6a5bdd6597329d93c5fdc132267613886b701193bdf8583b62ca` |
| CSV storage | `f88db715af84ff0a4dc056ab3a37fdaf71cdd0ae439a78b2d565952a1b93b535` |
| CSV installation | `e7bee22391c96c498d96e20e868cbf90429405ac3793eeb02bbc93e817939a28` |

共享包唯一拥有 CSV 字节解析，`faq-rules.ts` 继续统一两格式业务规则；既有隔离 runner 按受信来源模板分派。API 的 `input-format.ts` 拥有来源登记与 MIME/模板/规则/映射/结构组合，Main 仅选择、有限读取及原字节上传，不另建解析器。CSV 固定依赖 csv-parse 7.0.3 从开发依赖提升为运行依赖，没有版本升级；BOM 和原换行参与原件摘要。

0034 只追加冻结 CSV 格式约束。前 33 段 SQL 及其来源原字节不变；真实 PG 33→34 对象清单差异为新增 5 个 INVOKER 函数、4 个 INSERT trigger、2 个输入格式约束替换。PUBLIC 的 5 项默认函数 EXECUTE 不授予 schema/table 权限；既有用途 ACL、角色上限、函数属主和生产工厂没有改动。精确清单见 [数据库差异](db-manifest-delta.json)。

## 实际验证

命令、输入指纹、日志摘要和最终结果由 [checks.json](checks.json) 记录；安装副本过程和具体产物见 [Mac 安装包验证](package-verification.md)，本机独立审查范围见 [review.json](review.json)。所有 PG 测试使用一次性 Unix socket 集群及合成身份，不使用业务数据库。

| 验证面 | 实际结果 |
| --- | --- |
| 共享 CSV/XLSX 解析与隔离 runner | 97/97 PASS；含真实 CSV 原字节与生成报告回读 |
| 迁移生成/规划/实库 verifier | 57/57 PASS；最初两处测试期望/测试 SQL 参数名不匹配已修复 |
| 数据库完整 PG15 升级、失败回滚、旧前缀 | 40/40 PASS；旧前缀期待数组补上 0034，未改旧迁移 |
| API 最终专项 | 57/57 PASS：CSV HTTP 8、用途池 13、材料 18、multipart 11、事务 7 |
| Main/native/界面局部测试 | 120/120 PASS；局部 lint、typecheck PASS |
| 当前 Mac CSV 实际 Electron→HTTP→受限 PG15 | 1/1 PASS；坏文件、完整 XLSX 报告、修订、来源/质量、取消零请求、确认发布、另一坐席查询/系统剪贴板、撤权/越店拒绝 |
| 当前 Mac XLSX 同一真实合成栈回归 | 1/1 PASS；既有三页模板路径继续通过 |
| 当前 Mac 0.3.26 本地未签名安装副本 CSV | 1/1 PASS；标准打包后只读挂载新 DMG，解包专用副本、核对 app.asar，再经独立文件 profile 运行完整链 |

CSV E2E 输入包含 BOM、逗号、引号和多行正文；报告重新打开为 `CSV!H3`，复制结果与发布原文一致，数据库审批事实/绑定均为 0。原生文件/确认框使用受控响应，不是人工作业验收；本次已重打并实际验证新的本机未签名安装副本，办公 Windows 未验证。未覆盖已安装应用，同名旧包先复制保留，DMG 已卸载，自有 PG/userData 已清理。根 `lint/typecheck/test/build` 均实际 PASS；根 test 默认条件跳过数据库 23、API 329、桌面 7，独立 PG/Electron 专项按上表另外运行，不能据此声称全部专项通过。首轮 root test 遇到当前快照断言仍指向 1.21/1.23，更新为本次精确已批准版本/摘要后，53 项 intake 测试及完整 root test 复验通过，失败日志保留。`docs:check` 通过；`workspace:check` 仍为 FAIL（38.8 MiB / 32 MiB，超约 6.75 MiB），root policy PASS。未清理历史或放宽门限。依赖安全审计复用原 csv-parse 7.0.3 精确版本记录；既有依赖告警未消失，不构成全仓安全通过。

## 发现、修复与剩余边界

独立本机 `/review` 发现格式错误未完全按新合同返回的问题：来源格式不匹配须为 `SOURCE_FORMAT_MISMATCH`，数据库明确回滚不能误报 `COMMIT_UNKNOWN`。本轮补齐精确错误映射和专项回归；真实来源版本变化仍与格式错误区分。

完整旧 intake PG 回归首轮 152 项中 150 PASS、2 FAIL。一项是既有目录增加一条请求后测试总数仍为 150，已按 authorization=100、sources=50、shop-directory=1 分类核验，定向 PASS。另一项是旧非空目录继承时 0033 的 NOLOGIN 函数属主缺少旧表 CHECK 函数 EXECUTE，返回 42501；它属于既有冻结运行权限合同缺口，不是 CSV 触发器失败。本轮保留失败证据并在治理仓准备最小修复候选，未私改冻结合同或在产品 fixture 增权掩盖失败。该正式路径尚未验收通过。另建一次性数据库及临时测试副本，仅在原实际发布前应用精确 DRAFT SQL（SHA-256 `6e286747d15b8af6a11a03d9b00c33d36ac62c36f25efa653285c1cbc6984584`），结果 1 PASS / 151 skipped，8 行旧资料逐字段保留；[探针日志](draft-legacy-acl-probe.log)证明补丁可行，不代表产品已消费。原测试和消费锁未改，临时副本已删除，本次未扩大回退验收。

完整外部 `/review` 维持 INCOMPLETE；本轮本机独立审查不能替代外部覆盖。旧角色 15/15 审查未重跑，治理完整 release 旧证据按未变输入复用并单独说明。本次没有真实资料接入、旧目录认领、生产激活、push、PR、合并或部署。原桌面仓 TODO 与未跟踪计划保持原状。

治理已备 `schema.v1.25` DRAFT 最小修复（旧事项内，不新增业务）：只给既有 NOLOGIN 属主八个纯校验函数 EXECUTE，静态 3/3、实库 17/17 通过。具体对象为 `legacy-check-acl.v1.sql` / `schema.v1.25.sql` / `legacy-check-installation.v1.json`，精确摘要见 checks.json；可审说明在治理仓 `content-intake-runtime-candidate/legacy-check-verification.md`。需要该候选精确批准及新版完整出口/接收支持后，才能冻结、导出、接收并追加产品迁移，接着验证旧非空目录发布/回退。当前正式 CSV 消费锁与 0033/0034 均未加入该补权。
