# P2 管理上下文：合同接收与真实合成消费

被测基线：产品 `eab46ef` 后的本目录提交；治理 `240ae98a47d8b9432559c298f60af6fdc9ba8c4e`。环境：macOS 26.5.2 arm64、Node24.19.0、pnpm11.19.0、PostgreSQL15.18。全部身份、工作簿和审批均为临时合成输入；无真实客户、员工、飞书或外部模型。

## 交付与边界

- 版本化接收 `cs-ai-c11-openapi-1.19.0-schema-1.21-240ae98a47d8`。原81条路径、233个schema逐项保持；新增管理上下文GET和1个schema。当前234个runtime schema。机器文件保留原获批字节中的DRAFT/exportApproved注解；生命周期由治理批准记录与导出门拥有，不手改快照更新状态。
- 26段SQL字节、逐段来源/checksum不变；旧1.17、1.18完整账本在新目录下不执行SQL。
- API复用 discovery/authority/transaction，在内容锁→发布锁内读取来源版本、真实principal、当前base；只允许import，末端检查原会话/事实/授权期限，返回不构成提交资格。生产factory和新ACL未开放。
- Main真实 ProductHttp/ProductSession 经HTTP读取上下文，提交合成对象并解析成可读取候选；取消及注销迟到响应验证通过。本轮未新增Main运行时适配层或上传UI。

## 修复记录

治理审查发现浅克隆可能绕过批准里程碑并降级导出；现导出前要求完整Git历史，失败关闭且不自动fetch。固定历史提交依赖的测试改为自建临时仓，已在depth1消费环境验证。治理最终274单测和24项浅克隆测试通过；35步release中未受修复影响的门复用修前证据，详细记录随治理提交保存。

产品修复两项问题：迁移规划器把连续同DDL的完整前序目录当成非法重复；现仅在完整目录、同DDL和不同合同身份时允许相同段数。Fastify默认100字符路径限制挡住合同合法128字符ID；合成宿主显式配置128。两项均保留红绿证据。

## 验证

最终命令、状态及输入/日志SHA由同目录 `verification.json` 记录。以下命令均已实际执行，当前源码输入哈希与被测输入一致。

| 检查 | 实际结果 |
| --- | --- |
| 正式export→intake、合同与DB生成物 | PASS；不可变双哈希与治理Git blob一致 |
| 合同接收边界 | 23项通过 |
| contracts与编译包消费 | 23+1项通过 |
| database单元、编译包与真实PG15 | 27+1+25项通过 |
| 新管理上下文PG/HTTP/Main | 9项通过 |
| 完整资料事务与材料回归 | 153项通过，371.84秒 |
| 合成宿主/CLI | 5项通过 |
| 根 lint / typecheck / test / build | 全部通过；API普通测试476通过/247按环境跳过，桌面1203通过/6按宿主跳过 |
| 架构 / workspace / 文档与差异 | 通过 |

9项专项覆盖：空/已发布基线、认证principal不同于userId、无业务写入；权限/来源/tenant/app/私有会话拒绝；会话/grant/facts三种慢读过期；等待发布锁读取提交后base；旧base/映射变化拒收且不写job/receipt；严格GET和128字符；Main接收解析及取消/注销隔离。

## 审查与证据复用

`open-code-review-delegate` 只用于确定文件和规则，宿主完整审阅源码/测试增量，未调用外部审核模型。新快照DDL复用逐字节相同的历史审查，OpenAPI核验所有旧path/schema相同并完整审查新增内容。`/review` 原生独立审查的test/fixture/support/probe按SUMMARY处理，父审查补齐原始断言。

最终核心与原生复审均为0项剩余确认缺陷。初轮API专项有5项fixture构造失败，修正延迟FK事务、mode版本、贡献人声明和PG数组解码后9项通过；未抹除首轮日志。

原始记录位于本工作树 `.gstack/management-context-intake/`、`.gstack/qa-reports/content-intake-management-context-20261007/` 及 `...-api/`。原参与人目录复审输入与16份日志hash一致，未重新计为本轮执行。根普通test会跳过需外部宿主的专项；本轮独立PG入口实际执行了这些探针，不以跳过冒充通过。

## 剩余范围

下一完整上传切片：原生选文件→参与人确认→上传/receive→解析进度→报告保存/修正→接既有来源确认、组织审批、质量检查与发布UI。必须保留Main持有文件/操作键、renderer窄意图、原请求恢复、取消与未知结果反馈；禁止默认空base或从userId推断principal。

Mac/Windows原生文件对话框、安装包、杭州Windows/WSL实机、本轮新上传UI、真实飞书transport与生产activation均未验证。合同锁保持 VERIFIED_NOT_ACTIVATED。本地提交授权不包含push、PR、merge或部署。
