# 如何验证 P1 合成导入规则

本入口只验证已授权 P1，不启动桌面/API/数据库，不读真实工作簿、员工或飞书凭据。完整 FAQ 产品闭环属于 P2；[合同差集](reference-content-intake-p1-contract-gap.md)列出进入条件。

## 运行

沿项目要求使用 Node 24.x、pnpm 11.19.0，依赖缺失时执行 `pnpm install --frozen-lockfile`。

```sh
pnpm test:content-intake:p1
pnpm content:intake:probe
```

第一条覆盖 API experiments 权限/审批模型和共享解析包的格式、限制、子进程生命周期。第二条实际生成 `.gstack/content-intake-p1/valid.xlsx`、`missing-c3.xlsx`、`issues.xlsx` 和 `probe.json`；重新从磁盘打开、解析、核对坐标与摘要，不以退出 0 代替验收。可指定不同输出目录：`pnpm --filter @customer-agent/content-intake probe /absolute/owned/output`。目录应为本次专用输出，命令会替换同名探针文件。

固定样例含来源页、`faq-p1.1`、非活动域、合法稳定 ID/启停、空相似问法页；有效样例两条合成话术，保留 C2 中文换行；无效样例只清 C3，因此恰好一个 `FAQ!C3 REQUIRED`。错误报告正文为纯字符串单元格，不生成 Excel 公式。

ZIP 前检逐条约束展开量、局部/中央文件名一致和规范 ASCII 内部部件名，拒绝 Unicode 路径别名、点路径、重复行/单元格及超界列定义；中文表名和单元格内容不受 ASCII 部件名限制。所选页背景图、绘图引用和图片统一阻断，避免 ExcelJS 忽略未支持对象。此限定适用于本轮生成的统一模板；未验证任意第三方导出器的内部 ZIP 命名兼容性。

## 所有者与复用

- `packages/content-intake`：ExcelJS 4.4.0（MIT）、yauzl 3.4.0（MIT）、saxes 6.0.0（ISC），固定模板及错误坐标、前置预算、模板/报告实物与子进程生命周期。没有通用列映射或客户原表兼容分支。
- `apps/api/experiments/content-intake-p1`：权限交集、委派模型、候选材料、风险与人工证据/提交点判定。复用已有 test-support JCS/SHA；不进 API dist、不注册 HTTP、不增加数据库权限。
- 现有 API、桌面和冻结合同未接新路径；`build:services` 只编译验证包，产品运行时没有新增依赖。正式两个消费者将在 intake 后分别通过 Main/worker adapter 接线。

## 测量含义与未验证范围

探针分别运行 500 行与 5000 行（10 倍）样例各 10 次，均含六页、排除页合并单元格和八个图片引用；报告进程总延迟 p95/p99、子进程 maxRSS、Node 调用方事件循环 p99、取消到退出耗时、网络尝试数。n=10 的尾值相当于样本最大值，不是 SLA。5000 行不是同量真实内容的容量证明。

唯一预算在 `src/policy.ts`。前置检查覆盖文件字节、ZIP 数量/重复路径/实际展开量、宏/外部关系/XML、坐标/共享字符串/单值与媒体预算。所选页媒体尚未支持就明确阻断；未选页内容不入规范结果，但仍经过资源安全检查。只传有限字节和固定 context 给子进程，不传会话环境。进程取消/超时等待退出后再收新任务。

另对选中页实际读取文本累计设置 300 万 UTF-16 单元预算（`normalizedTextChars`），重复共享字符串按每次引用计数。它在结果序列化前拒绝放大输入，保留 JSON 转义、重复行字段和元数据的输出空间；单格、行数、ZIP 和输出预算须同时满足，不能把各上限相乘当作保证容量。

未验证：CSV 规范入口、SOP 图与媒体导入、商品/场景词项存在性、正式稳定版本分配、来源先后事实、持久 candidate/幂等/PG 竞态、真实飞书人工审批/附件和多客户端、Electron utilityProcess 打包、Windows/Linux/真实 Main 延迟、OS 级内存与出站限制。网络入口观测为零不能证明 OS 无网络能力；`--max-old-space-size` 不限制全部 RSS/Buffer。DB 查询量为 0，是本探针不调用数据库，不能替代 10 倍存量的 PG 查询计划验证。

依赖审计单列新增生产依赖与全仓已有项。ExcelJS 只使用 uuid.v4，锁到仍提供 CommonJS 的 uuid 11.1.1；minimatch 的 brace-expansion 按兼容 major 锁修复版。新增包沿用现有 Vitest 3.2.7，未启动它的 UI/browser 服务；既有工具链公告不代表本轮已修复。

实际运行结果链接由[执行计划 §0.1](plans/2026-10-03-content-intake-requirements.md)维护。
