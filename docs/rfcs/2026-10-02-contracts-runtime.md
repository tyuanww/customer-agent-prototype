# RFC：合同运行时边界

状态：`DRAFT · 等待第二个真实消费者`

本 RFC 讨论把合同快照编译后的通用运行时校验能力抽成共享模块的条件。当前实现继续由 `packages/contracts` 独占；本 RFC 不授权新的合同 intake、真实数据接入或 runtime activation。

## 当前 owner

`packages/contracts` 拥有完整合同链：

1. `contracts:intake` 验证不可变上游快照、来源 commit、OpenAPI / DDL 双哈希和 `contract_set_id`。
2. 生成脚本产出 bundle、TypeScript 类型、JSON Schema runtime 输入、provenance 和 manifest。
3. `src/runtime.ts` 延迟编译 component validator，并把失败收敛为有限的路径、关键字和消息。
4. `src/index.ts` 暴露类型、`CONTRACT_PROVENANCE`、`validateContractSchema`、`parseContractSchema` 和 `ContractValidationError`。

当前包不读环境变量、不连接数据库、不拥有 HTTP 路由，也不决定 `runtime_activated`。这些边界必须继续保留。

## 候选公开 API

第二个消费者出现后，候选共享层只提供与产品无关的 runtime 机制：

```ts
type ValidationIssue = Readonly<{
  instancePath: string;
  schemaPath: string;
  keyword: string;
  message: string;
}>;

type ValidationResult<T> =
  | Readonly<{ ok: true; value: T }>
  | Readonly<{ ok: false; issues: readonly ValidationIssue[] }>;

interface ContractRuntime<Name extends string, Value> {
  validate(name: Name, value: unknown): ValidationResult<Value>;
  parse(name: Name, value: unknown): Value;
}
```

候选接口接收一个由项目提供的 schema registry 或生成 document。它不接受任意 `$ref`、任意代码回调或产品路由名称。`parse` 只能在 `validate` 失败时抛出稳定的 typed error，错误最多保留有限条 issue，不能回显完整输入。

## 留在项目内的知识

- OpenAPI bundle、schema 名称、业务字段和生成版本。
- `contract_set_id`、来源仓库、来源 SHA、双哈希和 `runtime_activated` 状态。
- `x-unique-by` 等业务合同扩展的启用清单。共享层可以实现机制，但项目决定哪些扩展属于自己的合同。
- HTTP 状态码、路由错误文案、认证方式和正式数据装载策略。

共享层只负责验证，不把 provenance 验证、合同 intake 和运行激活混为一层。项目 adapter 负责把项目生成物映射到共享层输入，并在边界记录 provenance。

## 依赖与注入

共享层可以依赖 Node 可用的 JSON Schema validator，但不能依赖 Fastify、Electron、`pg`、React、环境变量或业务 package。以下内容必须显式注入：

- schema registry / JSON Schema document；
- 支持的格式和自定义 keyword；
- 最大 issue 数量与错误公开策略；
- schema name 到项目类型的编译期映射。

默认策略应当是 fail-closed。unknown schema、无效 registry、非法格式和不支持的 keyword 都应成为可识别失败，不能静默跳过。

## 失败策略

| 情况 | 结果 |
| --- | --- |
| 已知 schema，输入合法 | 返回冻结的 typed value |
| 已知 schema，输入非法 | 返回有限 issue；`parse` 抛 typed validation error |
| unknown schema | `schema` 类失败，不执行宽松校验 |
| validator 初始化失败 | 让调用方得到稳定失败，禁止回退到未校验输入 |
| issue 超过上限 | 截断诊断，不截断“失败”结论 |

错误只包含定位所需信息，不写入原始客户内容、凭证或完整请求 body。

## 独立验证方式

第二个消费者的 adapter 至少应有：

- 包入口 smoke，验证编译产物可被标准 Node 24 加载；
- 每个候选自定义 keyword 的正例、反例和未知 keyword 反例；
- schema registry 不完整、错误 `$ref`、超限 issue 和非法格式测试；
- 与项目现有 validator 的冻结样例对照，证明结果和错误语义一致；
- 架构门证明共享层没有业务包、数据库或桌面依赖。

## 停止抽取条件

出现任一条件就保留项目内实现，并记录 adapter 债务：

1. 两个项目的错误公开策略、扩展 keyword 或 schema 生命周期不同；
2. 共享接口需要暴露 `contract_set_id`、路由、租户或产品状态；
3. 为兼容其中一个项目而加入超过一个产品特例；
4. 不能在不读取环境变量或真实输入的情况下完成独立测试。

满足第二个消费者门槛后，才建立候选 package，并把它作为独立 PR 验证，不能直接移动当前 `packages/contracts` 的生成物。

## 相关文档

- [`@customer-agent/contracts` README](../../packages/contracts/README.md)
- [项目架构与目录边界](../reference-project-architecture.md)
- [可复用能力 RFC 索引](README.md)
