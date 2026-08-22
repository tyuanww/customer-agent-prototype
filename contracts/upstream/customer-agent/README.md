# 客服 Agent 正式合同快照

本目录只保存从 `ai-赋能立项` 单向交接、经过来源 Git SHA 与 OpenAPI / DDL 双哈希校验的不可变快照。

- `contract-set.lock.json` 选择当前已接收快照，额外固定 manifest SHA-256，并保持 `VERIFIED_NOT_ACTIVATED`。
- `<contract_set_id>/` 内只能有 `contract-set.json` 及其声明的 OpenAPI / SQL 文件；禁止手改、补文件、软链接或运行时跨仓读取。
- 接收新快照：`pnpm contracts:intake -- --source=/absolute/path/to/contract-set --source-repository-root=/absolute/path/to/ai-赋能立项`；接收器会从声明 commit 直接复核两份来源文件。
- 日常复核：`pnpm contracts:verify`。
- 接收合同不等于 Ddev、codegen、migration、runtime、真实数据、部署或发布获准；正式能力仍等待项目记录仓的专用门。

上游合同变化必须先在记录仓形成新 commit 和新 `contract_set_id`，再以新增快照交接。产品仓不得修改旧快照制造第二真源。
