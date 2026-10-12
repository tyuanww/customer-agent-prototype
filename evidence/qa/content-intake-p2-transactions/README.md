# P2 权限与持久候选事务验收

日期：2026-10-06。基线 `a7243a801f416abb23064a3afd4b9fe0d256e0c8`，工作分支 `codex/content-intake-p2`。授权记录见[计划 §0.6](../../../docs/plans/2026-10-03-content-intake-requirements.md)。只用合成主体/来源/工作簿和本机 Unix socket 临时 PG15；不读取真实数据，不注册生产 HTTP/DSN，不开放 `content_intake` 应用 ACL。消费锁仍为 `VERIFIED_NOT_ACTIVATED`。

## 已实现的可运行切片

`apps/api/src/content-intake` 负责当前身份事实与角色/动作/精确范围判定、整批授予、撤权接管、文件接收任务、API 独立解析、不可变候选/修订/取消、持久错误报告和原操作恢复。复用已有对象存储、正式 validator、`backend_review.lock_content()`、私有永久 receipts 与共享 ExcelJS 解析包，没有第二个数据库/身份/审批服务。

最小接口见[开发配方](../../../docs/how-to-develop-content-intake.md)。原始 XLSX 经实际对象存储读取、指纹复核和隔离解析；材料规范化后进入 PG，错误报告从存储重新打开并核验 `FAQ!C2`。缺行/问法继承，正文/问法分别分版。修订成功原子废旧；坏文件保留旧候选；另一个有范围权限的管理主体可以查看候选。没有生成 release 或 import batch。

当前运行消费者是 `test:intake:transactions` 的临时 PG 执行器。测试安装账户不得接入 API 生产启动配置。对象登记/组织事实/根 allocation/来源词项由受控合成 setup 提供，不声称这些 HTTP/真实同步已实现。

## 审查修复与实证

| 问题 | 修复 | 修前/修后证据 |
| --- | --- | --- |
| 授权在操作期间到期，admission 仍提交 | 权限和分配模块登记最早有效期；事务在所有写入及回执后、COMMIT 前核对数据库时钟 | PG 短时 grant + 配额查询延迟：修前成功；修后拒绝且无 job/回执 |
| 永久回执依赖会淘汰的 HTTP HMAC key | 使用已有私有永久回执惯例的版本化 canonical SHA-256 绑定；服务不再接收 HTTP key ring | 修前移除 v1 key 后同键冲突；修后服务重建仍返回原结果、改载荷拒绝 |
| 风险提示未参与分级 | 新旧非空风险提示只升级；删除旧提示仍为关键变更 | 修前风险提示为赔付承诺得到 routine；修后 critical |
| 新任范围负责人无法接管旧授权 | 撤权/接管检查当前资格；新授予继续要求母资格覆盖整个有效时段 | 新 supervisor allocation 晚于旧 grant、期限更短：修前拒绝，修后接管/撤销成功，原 issuer 不变 |
| 首次 current 无行时无法与旧发布串行 | 统一内容锁后复用旧发布 advisory lock，再锁 current | PG 双会话：修前旧 try-lock 可得；修后不可得，含空指针 |

修前日志分别为 ignored `.gstack/content-intake-p2-transactions/regression-before.log` 与 `expiry-regression-before.log`。第一份的到期用例最初因 fixture 试图修改不可变 expires_at 被数据库拒绝；随后改为撤销旧 grant、追加短时 grant，第二份才是已确认产品缺陷。两份均保留，不把 fixture 失败冒充缺陷复现。

OCR delegate 为宿主审查；规则与可审项由 OCR CLI 选择，不调用 OCR 外部 LLM。`/review` 首轮原生审查确认提交截止、风险提示、永久回执三项，主审补充接管与旧锁两项，均按用户已授权修复。外部首轮对抗完成；其“坐席不能获分配资格”与已确认 §12.1 冲突，判为误报，并用 PG 验证坐席获 delegation 后可在范围内分配，但本人仍不能导入且不能再委派。建议重复 parser 业务校验未发现当前入口可触发的绕过；唯一文件生产者仍是受控服务端 parser，不接客户端 ParseResult。外部结构化首轮在 540 秒超时，保留缺失覆盖，不记 PASS。修后宿主 OCR 与原生完整复审无剩余确认缺陷；原生复核只读测试摘要，测试/fixture 原文由宿主审查并实际运行。修后外部对抗、结构化两项均在 540 秒超时，未返回 findings，两个记录均为 unavailable。宿主 `/review` 为 completed/converged，1 次修复轮次；外部结构化门仍为 MISSING COVERAGE，不称全部外部审查通过。

## Exploratory QA and Verification Results

| 项 | 实际结果 |
| --- | --- |
| Node / pnpm / PG | 24.19.0 / 11.19.0 / 15.18，本机 macOS，临时 Unix socket 集群 |
| `pnpm --filter @customer-agent/api test:intake:transactions` | 20/20，通过；15 项实库场景 + 5 项实际工作簿材料验证 |
| `pnpm lint` / `pnpm typecheck` / `pnpm test` / `pnpm build` | 修后全部退出 0；日志为 `*-final.log` |
| `pnpm workspace:check` / `pnpm docs:check` / `git diff --check` | 全部通过；目录预算与文档链接有效 |
| 常规 `pnpm test` 的实库跳过 | API 448 passed / 106 skipped；以上 15 项新 PG 场景由独立环境命令真实运行，不把 skipped 写为通过 |
| 文件/对象消费 | 真实生成的 XLSX → store → 子进程 → PG candidate；失败报告从 store 回读并核指纹/坐标 |
| unknown/restart | 注入 COMMIT 已落库但响应丢失；同键恢复不重复；持久 parsing job 重启继续，同 job 成功结果不重复 |
| 并发/撤权 | 两个 service 实例修订同键只赢一个；11 次 admission 恰好 10 个成功；队列到期及解析期间撤权拒绝；取消后不复活 |

gstack capture 001 是修前 15 项探索基线，capture 002 是修后 20 项明确回归；原探索五分钟已结束，002 使用显式修复验证的 120 秒上限，不延长原探索时钟。当前 capture 002 SHA-256 为 `afceda920d20baab84be4e259a6accc7c2b0114cac4ceaaeb9241f30bfb51f70`，19.472 秒，退出 0。[checkpoint 002](exploration-002.json) 原样归档；receipt/stdout 保留在 ignored `.gstack/content-intake-p2-transactions/qa/`。`gstack-qa-evidence materialize` 实际输出 PASS、open=[]，证据 SHA-256 为 `8dcd9be83743b7a77078281215aa1b58eb413c3bca3aa9e953084b11cfcb158e`。历史 P1/合同交接的缺失外部覆盖不被本报告改写。

## 下一阶段条件与验收

下一切片按已接收的正式合同推进来源确认、审核包和合成人工审批适配，再实现原子发布；复用本阶段 candidate key/权限/事务和对象存储。必须证明：证据绑定精确候选与实际附件字节；常规可自审、关键排除全部贡献人及同人别名；历史与当前审核资格均有效；缺失/拒绝/撤回/超时不进入 ready，补证不改变材料摘要；unknown 创建/提交按原操作恢复。

发布后才能接 Main/窄 preload、按当前店查询与第二坐席消费。开启应用 ACL 之前还需发布/撤权、发布/取消、同 base、旧整域写影响集、使用资格/撤销双序，以及四域/catalog/announcement 原子性；不能用本次空 current 锁测试代替完整旧写隔离。

剩余边界：当前只验证 actor/source 并发准入和已登记对象的保守 1GiB 总量门。上传/报告字节预留、受控 retention 清理、十倍历史存量性能尚未完成；取消不自动释放对象磁盘，未知提交保留对象。历史关键风险的持续谱系判定还须在发布/纠正链验收，当前覆盖变更前后的材料提示。非空 family 引用/选中媒体/附件继续明确拒绝。真实飞书组织/人工实例、Electron 包内解析、Windows/Linux、非开发业务演练均未验证。

本次本地 commit 已授权；push、PR、merge、deploy、v2-active 和真实数据仍不在授权范围。

## 审查覆盖归档

代码复审覆盖 10 个 OCR 可审源码/配置：API `package.json`、`idempotency.ts`、`content-intake/{authority,candidate,material,service,transaction}.ts`；解析包 `package.json`、`policy.ts`、`workbook.ts`。每项以 path/status 和 SHA-256 记录在 ignored `ocr-review-final.json`。该轮无 skipped 可审项，覆盖率 100%。

原 9 个 OCR 排除项均补核：四份 docs/plan 与包 README、本报告因 unsupported_ext 排除，检查当前行为/范围/引用；pnpm-lock 因 default_path 排除，只新增 workspace 依赖链接；两份 test 因 default_path 排除，由宿主全文审查并实际执行。复审后追加的 `exploration-002.json` 是工具 checkpoint 的逐字归档，另做 JSON/原始 SHA 校验，未改产品代码；归档后最终 OCR 清单为 20 项总变更、11/11 可审项和 9 个有原因的排除项。

外部首轮完整输出、模型 usage（实际返回 claude-opus-5）、所有超时原始 JSON、OCR preview/rules、修前/修后命令日志与原生复审保留在 ignored `.gstack/content-intake-p2-transactions/`。只复用过往合同验证时，已核对前次提交 manifest 的全部 30 个 HEAD Git blob，不能用本次无改动宣称后续运行门已过。
