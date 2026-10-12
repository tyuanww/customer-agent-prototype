# CSV 合同与解析候选验证

本轮基线为产品 `3abd57c44bd76cf5e70f3fa9641920661074d482`、治理 `830e1c826b2ee479146ccd23d7437e634b4b6be8`。版本保持 0.3.26。仅合成实现与本地提交；CSV 状态为 DRAFT，未冻结、未 export、未 intake，正式消费者仍为 OpenAPI 1.21.0/schema.v1.23 与 XLSX。没有真实文件正文、员工数据、凭据或生产配置进入测试。

## 实际交付

- [CSV 候选](../../../packages/content-intake/experiments/csv/README.md)直接消费原 UTF-8 字节，支持 BOM、三种记录分隔、引号内多行/逗号/引号；原件 SHA 与结构摘要分开。23 列保留现有 FAQ 与独立问法身份，不把 CSV 转成 XLSX 冒充原件。
- [合成模板](../../../packages/content-intake/experiments/csv/synthetic-template.csv)已由解析器实际读取；错误报告用 ExcelJS 重新打开验证。来源、编号、重复行、停用、活动期限、媒体标记与预算失败均整批拒绝。
- `src/faq-rules.ts` 抽取原 XLSX 业务校验；两种格式复用同一套业务规则。CSV 在 experiments、开发依赖及包内 typecheck 范围，未进入 dist/exports/runner/API/Main。
- 治理仓新 OpenAPI 1.22.0/schema.v1.24 候选绑定 MIME、template/rule/mapping、结构摘要、数据库对象和捕获的 source_version。旧冻结字节与产品消费锁不变；治理的具体机器摘要及验证状态由 `19-P2CSV资料输入合同候选.md`、`content-intake-csv-candidate/verification.md` 与其检查记录拥有。

## 产品实际验证

环境：Mac arm64、Node 24.19.0、pnpm 11.19.0。新增依赖 `csv-parse` 7.0.3（MIT）精确锁定为开发依赖；其余锁定依赖未升级。使用 [Sync API](https://csv.js.org/parse/api/sync/) 与字段回调；同步解析只在离线候选中运行，后续正式消费须进入原隔离 parser。

| 命令 / 检查 | 结果 | 证据 |
| --- | --- | --- |
| `pnpm --filter @customer-agent/content-intake test` | 94/94 PASS：CSV 38、原 XLSX 56 | [定向记录](parser-final.log) |
| 包 typecheck、定向 eslint、diff-check | PASS | 同上；其中日志是实际工具输出转录，根检查另留完整输出 |
| `pnpm lint` | PASS | [lint](lint.log) |
| `pnpm typecheck` | PASS | [typecheck](typecheck.log) |
| `pnpm test` | PASS；保留默认条件跳过项，不声称这次重跑 PG/GUI 专项 | [test](test.log) |
| `pnpm build` | PASS | [build](build.log) |
| `pnpm docs:check` / `git diff --check` | PASS：236 Markdown 链接及入口归属；差异格式通过 | [docs](docs.log) |
| `pnpm workspace:check` | FAIL：源码余项约 37.0 MiB / 32 MiB；root policy PASS | [workspace](workspace.log) |
| 依赖审计 | 新增 csv-parse 未报告 advisory；全仓审计退出 1，既有依赖存在 4 low / 19 moderate / 41 high / 2 critical，不构成全仓安全通过 | [摘要](dependency-audit-summary.json) |

根 test 的默认跳过项为数据库 21、API 319、桌面 7；CSV 自身 38 项未跳过。Mac 已有安装包 E2E 仍只证明其原 SHA 下的 XLSX 闭环，不外推成本次 CSV 或重新打包验收。测试输入、日志 SHA 与最终检查见 [checks.json](checks.json)。

## 新差异审查与修复

本轮本机核心与独立 `/review` 仅审新增差异，不重做旧角色 15/15。发现并修复 1 项资源分配问题：只有 `max_record_size` 和整行回调时，纯逗号可以先生成大量空字段。20 万字节合成探针实际生成 200,001 字段；字段回调提前检查后在第 24 字段拒绝，尚未产生完整记录，见[复现与机制验证](empty-column-probe.log)。最终候选回归另外证明 `CSV!X2` 提前拒绝，且正常列宽的不配对引号仍被拒绝。最终源码摘要与审查范围记录在 checks.json；没有未修复的本轮产品代码问题。完整外部 `/review` 的 INCOMPLETE 保留，不把这次本机检查改写成外部通过。

## v3 合同包下游消费补齐

治理候选本地提交 `5335107563510f54f656237b3d11bc375d179edb`：机读/合成导出 7/7、PG15 35/35、完整 release 44/44 步通过。PG 用 owner 验证 DDL 守卫，不冒充用途 LOGIN 或 HTTP 验收；旧冻结文件与正式 profile 未变。

产品接收工具已支持精确的 1.22.0/schema.v1.24 v3 包，14 件固定成员、安装顺序、内外 SHA 和来源提交的独立冻结/批准必须同时成立。旧完整历史 v1/v2 仍可接收；批准文件曾出现后删除不能降级，浅克隆必须拒绝。候选安装文件中的 DRAFT 字样保留原字节，来源提交中的精确批准才是冻结依据。上述均发生在目标目录/消费锁写入前，不执行 SQL 或激活运行。

| 最终验证 | 结果 | 日志 |
| --- | --- | --- |
| 合同工具单测 | 53/53 PASS | [单测](intake-unit-final.log) |
| 治理实际 exporter → 产品 ingest CLI → verify CLI | 1/1 PASS，14 件，VERIFIED_NOT_ACTIVATED/runtime=false | [实际上下游](v3-consumer-final.log) |
| 工具收尾后的根 lint/typecheck/test/build | PASS；默认专项跳过仍为 347，合同接收 53 项均运行 | [lint](tooling-lint.log)、[typecheck](tooling-typecheck.log)、[test](tooling-test.log)、[build](tooling-build.log) |

实际往返只在临时合成批准仓和临时产品根执行，辅助脚本路径与指纹写在日志中；两者清理断言通过，真实产品消费锁 SHA 前后均为 `0161f430d0171b4836e6b08e011c0c8c4c92fde8edb5602608533b4c1a5bf858`。独立审查发现的浅克隆历史缺口已修复并复核；修复前的中间根检查留在本地 `.gstack/qa-reports/intake-csv-candidate/pre-shallow-review/`，不作为最终通过证据。最终源码和日志指纹见 checks.json。

## 未验证与后续边界

CSV 原生选择、上传、服务端独立复算、worker material、模板响应、发布至另一坐席查询复制、Mac 安装包与 Windows 尚未接线或验收。先完成所属仓精确候选批准及冻结/export/intake，再复用既有候选、质量和确认发布链；不提前放宽旧 wire。

首批仍为 Menokin，FAQ 用已选 B；初始总监/经理范围不修改四岗上限。B 空表头列、图片必要含义、来源/具名主体和旧目录认领仍需业务输入；不猜测字段、期限或人员，不扩 SOP/自动同步。当前计划与剩余任务分别维护在 [§0.53](../../../docs/plans/2026-10-03-content-intake-requirements.md#053-角色上限与直发候选2026-10-08) 和 [TODOS](../../../TODOS.md)，不新增业务待办。
