# P2 已确认参与人目录验收

> 证据交付边界（2026-10-12 校正）：下文 `.gstack/` 文件只在原本机工作树保留，未随 Git 交付，远端审阅者不能据此直接复核原始执行。本文保留历史观察及其限制；这些本机路径不是仓内可点击证据，也不证明当前版本通过。
日期：2026-10-07。集成分支 `codex/content-intake-p2`；前序 `ef700cb`。仅本地合成开发，未扩大正式运行、真实员工目录、飞书或外部 Git 授权。具体文件/日志哈希见 [verification.json](verification.json)。本目录独立于既有审批发布验收，不覆盖历史证据。

## 本轮结果与所有权

实现既有冻结 `GET /v1/intake/principals`，没有修改 OpenAPI/DDL。contributor 要求来源 import，可列已禁用或无业务 grant 的已确认贡献人；grant-recipient 要求分配资格、当前事实与岗位适格，排除本人并支持首次授权对象。目录只提供选择材料，最终授权事务仍按事实版本及当前权限重验。

`transaction.ts` 统一拥有身份/事实/岗位投影，目录一次批量读取最多 limit+1 条登记主体；`authority.ts` 共享原同人和岗位谓词；`discovery.ts` 拥有来源/用途授权、有界分页及签名游标。标签由隔离宿主显式登记，不新增姓名表、不从账号猜姓名。非法或缺失标签整页失败。

每页重新验权，游标绑定 session、tenant/app、source、purpose、limit、调用者事实/权限及截止。空过滤页仍可有 nextCursor；按 ASCII 顺序继续到 null。响应上限262,144字节，无截断、无授予权限/租约/回执/发布/同步写入。生产 factory 与 ACL 未开放。

实际 ProductHttp/ProductSession 探针完成目录分页、改变来源/用途/limit 的游标拒绝、取消、注销后迟到响应丢弃。它是 Main 层真实 HTTP 消费证据，本轮没有新增 Dashboard 人员选择或上传 UI。

## 验证与复用

环境：macOS26.5.2 arm64、Node24.19.0、pnpm11.19.0、PostgreSQL15.18。沿仓库原生工具，临时 Unix socket PostgreSQL 与随机 loopback HTTP 只使用合成数据；未读取业务 env、已有数据库、员工显示名文件或真实凭据。

| 检查 | 实际结果 |
| --- | --- |
| 目录 PG/HTTP/Main 专项 | 10/10，通过；修后再次10/10，stderr为空 |
| 完整 intake integration + material | 144/144，通过，222.10秒 |
| 宿主及CLI | 5/5，通过；真实审批/发布后坐席收到3条相同多行答案，启动信号/EOF/清理正常 |
| 根 lint / typecheck / test / build | 全部退出0；fixture修后再次lint/typecheck退出0 |
| 根默认Desktop测试 | 1201 passed、5 skipped；外部宿主专用用例由上述真实HTTP探针单独验证 |
| 根默认API测试 | 476 passed、238 skipped；实库目录及完整intake由上述专项单独验证 |
| 实物容量 | 第一页100个最长Unicode标签，126,473字节；完整两页108个主体无重漏，最大测试cursor346字符 |
| 数据库读取规模 | 首次扫描101行，第二次8行；第一页身份相关SQL共3次：actor、批量页、最终actor，非逐人查询 |

根 typecheck 首次读到旧API dist声明，报告不认识 principalLabels；按宿主真实构建消费要求完成根 build 后重跑通过。没有用类型断言或修改源码绕过。构建输入变化须先重建服务产物，再启动宿主或做该消费的类型检查。

完整144项与根test/build在唯一的测试快照辅助函数修复前运行；生产源码、合同、命令及其余fixture均未改变。修复将同一PG Client上的快照查询改为串行，只有新增目录用例调用该函数；修后完整目录10项及lint/typecheck通过。复用其余134项和未受影响根测试/构建结果，不把重叠计数相加。API工作树冻结清单保留原测试哈希，最终manifest另记录修后哈希。

## 审查与修复

使用 `open-code-review-delegate` 的确定性文件/规则解析，由宿主逐项审查；所有可审文件完整覆盖，默认排除的测试和文档由父完整核对。独立 `/review` 原生对抗审查完整阅读5个生产源码文件，未发现可证实的权限或分页缺陷；测试/fixture及根消费探针仅SUMMARY，覆盖减少明确保留。未调用外部模型，历史外审失败记录不改写。

父审查确认一项测试维护问题：同一pg Client通过Promise.all查询快照，触发驱动弃用警告。trace定位到新快照辅助函数，随后改成串行查询；仍对8张表执行前后全量比较，修后10项通过且无警告。没有删除断言、放宽身份/时间约束或改变生产权限规则。

## Exploratory QA and Verification Results

| Metadata | Value |
| --- | --- |
| Authority / surface | 已授权实现及修复；`/review` functional-only，实际HTTP/PG/Main和CLI |
| Isolation / destinations | 原有PG15 harness的本次自有临时库、合成对象目录、loopback宿主；退出清理自有资源 |
| Smoke | 同一300秒/12探针预算；执行001–003后停止探索，未重置时钟 |
| Required revalidation | 修后004使用120秒单命令上限；17.502秒完成，是必需复验，不算新一轮冒烟 |
| Captured execution duration | 四次capture合计45.451秒；等待审查、根检查和完整PG另计 |

| 合同与预期 | 证据及观察 | 结果 |
| --- | --- | --- |
| 授权、分页、禁用贡献人、首次grant目标、三个截止及Main失效 | capture001/004；10项；108个主体实际JSON回读，无部分结果或越权 | PASS |
| 查询无业务写入，测试连接使用正确 | capture002 trace确认辅助代码警告；capture004串行修后保留8表前后比较、stderr为空 | PASS，历史警告保留 |
| 共享身份投影不破坏旧发布/坐席读取与进程清理 | capture003；5项含实际发布、3条多行答案、SIGINT/SIGTERM/EOF | PASS |

原始证据位于本工作树 ignored `.gstack/qa-reports/content-intake-principals-20261007/`；命令、stdout、stderr、截止及完成回执均保留。以下检查点由证据工具在后续探针执行前生成：

- checkpoint002（本机历史文件 `.gstack/qa-reports/content-intake-principals-20261007/exploration-002.json`）：用trace定位目录成功测试的数据库客户端警告。
- checkpoint003（本机历史文件 `.gstack/qa-reports/content-intake-principals-20261007/exploration-003.json`）：检查共享身份投影及宿主标签接线对发布和退出清理的影响。
- checkpoint004（本机历史文件 `.gstack/qa-reports/content-intake-principals-20261007/exploration-004.json`）：修后重跑目录必需矩阵，确认警告消失且断言保留。

### 限制与下一步

治理 `63e7130` 的管理上下文1.19仍为DRAFT，未冻结/export/intake；不能猜self principal或空发布基线。下一步是该精确版本对批准后，完成原生文件选择→上传/解析→报告保存/原操作恢复→已有审核发布的整条上传切片。既有合同没有parse-job cancel，停止本地等待不表示服务器撤销。

本轮未执行新的Electron GUI/安装包、Mac原生文件对话框、杭州Windows/WSL、真实飞书或真实员工目录验收；没有修改桌面运行代码。前序Electron证据保留在其原目录，不改称本轮设备实测。P2修改/停用/回退界面、容量治理及正式运行条件仍未全部完成。
