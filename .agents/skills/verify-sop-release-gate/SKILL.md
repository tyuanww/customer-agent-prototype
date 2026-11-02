---
name: verify-sop-release-gate
description: "修改 SOP 候选事务前置门禁、来源绑定或审核证据时使用。运行真实 TypeScript 的有界穷举与负向变异，核验未满足条件的候选不能进入事务准备；不验证业务故事或发布批准真实性。"
---

本 Skill 检查一个承诺：未完成合同接收、业务审核或来源绑定不符的 SOP 候选不能返回 `ready-for-transaction`，任何结果都保持 `publishable:false`。违约会让未审核或错误版本的流程获得后续事务资格。

## 执行

在仓库根目录，使用 Node.js 24.x、项目 pnpm 11.19.0 和已有 TypeScript 5.9.2 依赖运行：

```sh
node .agents/skills/verify-sop-release-gate/verify.mjs
```

可追加仓外 JSON 输出路径。脚本构建 content-intake，直接调用编译后的真实函数；不读取工作簿正文，不连接数据库或服务。构建输出沿用项目 dist。负向变异在独立系统临时目录内编译、导入，退出时清理，不修改工作树中的产品代码。

## 范围与判定

这是有限域穷举，不是无限输入的形式证明。未引入 TypeScript 证明工具；为避免另写模型偏离实现，直接生成输入调用实际代码。

穷举 10 个二值条件、10 种 successor 证据状态、6 种 business 证据状态，共 61,440 组。包括正确正例，防止始终拒绝的实现冒充安全。两个证据分别是无错配或任一列出的单字段错配，可同时跨证据错配；不覆盖同一个证据内部任意多个错配的全组合。字段和条件列表由 verify.mjs 的 axes、successorFields、businessFields 定义。

固定图只有一个合成终点，另有空图，不覆盖任意拓扑、可达性、环或故事条件。输入遵循函数所需对象结构；不覆盖任意 JSON 解析。另验证拆解后新工作簿的摘要即使被两个证据同步使用，也不能继承旧六表的来源许可。

六种源码变异必须分别被抓到：删除合同接收、删除业务审核、删除两类证据绑定、信任自报 snapshot、把结果改为可发布。例子：删除业务审核检查后，`reviewed=false` 的输入返回事务就绪，构成反例。脚本随后再次跑原函数全部组合并检查源文件未被修改。

`PASS` 只覆盖以上前置门禁。`accepted` 和 `reviewed` 的真实性、签名、审批人及权限由上游拥有；本函数仅消费这些事实。也不覆盖数据库发布事务、Main/Query、UI、真实故事、医学内容或上线验收。

## 覆盖与同步

最近核对提交：`a8652c87950d24b3bf9068fb3ca3de0da53583b1`。创建 Skill 时这三个被测源文件相对该提交无修改；同工作树另有不相关未提交工作。

- `packages/content-intake/src/sop-graph-release-gate.ts` 的 `checkSopGraphTransactionPreconditions` 是直接被测函数。
- `packages/content-intake/src/sop-graph-snapshot.ts` 的 `checkSopGraphSnapshotReadiness` 是真实被调用依赖。
- `packages/content-intake/src/sop-real-mapping.ts` 拥有当前允许的来源摘要与映射版本。

调用者 `sop-graph-transaction.ts` 有额外检查，不属于此次证明范围。每次报告记录当前 HEAD、上述文件摘要和工具版本。被测代码、字段或合同变化后，先核对组合域仍表达真实承诺，再运行；负向变异定位失败表示验证脚本需同步，不能删除变异逃避失败。基线反例先判断真实违约还是合成输入已不合法，不弱化性质、不自动修改产品代码。

只有重新核对实现、基线通过且六个变异有效后，才前移同步提交。后续变更未同步时，使用 `/maintain-formal-verification-skill` 对齐，若该技能不可用则依照本节逐项核对。
