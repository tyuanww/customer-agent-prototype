# `@customer-agent/contracts`

默认视图从已经通过 `contracts:intake` 验证的不可变 OpenAPI 快照生成以下五项受控产品仓资产。

- `openapi/bundle.generated.yaml`：确定性 bundle；
- `src/generated/openapi.generated.ts`：编译期 TypeScript 类型；
- `src/generated/runtime-schema.generated.ts`：不读取 YAML 的 JSON Schema 2020-12 运行时校验输入；
- `src/generated/provenance.generated.ts`：来源 commit、双哈希、工具版本和未激活状态；
- `src/generated/codegen-manifest.generated.json`：上述生成物的字节数与 SHA-256 清单。

`src/runtime.ts` 提供封闭的 component schema 校验 API。校验失败只返回有上限的路径、关键字和合同消息，不回显被校验数据。普通 `x-*` 仍作为非验证注解剥离；源合同中承担数组唯一性语义的 `x-unique-by` 会保留并执行。

`pnpm build` 把源码编译到忽略提交的 `dist/`；包根、`./runtime`、`./provenance` 和 `./generated` 的运行时入口只指向该 JS 输出。validator 在首次使用某个 schema 时才编译它，Node 包入口由独立 smoke 验证。

```bash
pnpm contracts:verify
pnpm contracts:generate
pnpm contracts:codegen:check
pnpm test:contract
pnpm --filter @customer-agent/contracts build
```

生成物只能由 `scripts/generate-contracts.mjs` 更新，禁止手改。本包没有 HTTP 服务、数据库、renderer 接线或真实数据；当前消费锁继续保持 `VERIFIED_NOT_ACTIVATED`、`runtime_activated=false`。生成校验器不等于正式 runtime 已激活，也不构成 DEV-M0 全部退出证据。

## 统一 SOP 视图

`@customer-agent/contracts/sop-unified` 提供独立的 `components`、`paths`、`operations` 类型，以及 `parseContractSchema`、`validateContractSchema`、`contractSchemaNames`、`ContractValidationError` 和 `CONTRACT_PROVENANCE`。例如任务正文类型为 `components['schemas']['IntakeSopNode']['body']`，知识、话术关系和要求均通过该 schema 派生。

该入口消费接收器核验的 `sopUnifiedCorrected` inactive 快照。生成器在 `withVerifiedContractSetSnapshot` 的共享锁内调用 `verifyIngestedCorrectedSopUnifiedContractSet`，从 `sop-unified-corrected-contract-set.lock.json` 选择 OpenAPI `1.29.1` 的 v11 快照。旧 v10 锁继续校验固定纠错前序。provenance 保存合同 ID、来源 SHA、manifest 摘要与字节数，以及包含 `negotiation-proof.v1.json` 的全部来源成员描述符和生成物摘要。最终来源 SHA 和重生成结果随实际接收核对，来源规则见[合同接收参考](../../docs/reference-sop-unified-contract-intake.md)。

| 生成边界 | 取舍 |
| --- | --- |
| 独立入口生成全部 1.29 组件 | 视图隔离明确，保留的无关组件与生成字节较多 |
| SOP 家族、引用它们的封套及实际依赖闭包 | 当前采用。覆盖材料、快照、质检和 query，包入口集中拥有选择规则 |

生成器从 `IntakeSop*`、`MenokinSopQuery*` 收集引用这些 schema 的封套，再递归收集正向依赖。`/v1/sop/query` 的请求、成功响应、错误响应和认证声明均纳入闭包。缺失或外部引用使生成失败。当前得到 79 个 schema，类型、bundle、runtime schema、provenance 和 manifest 分别生成在 `openapi/sop-unified/` 与 `src/generated/sop-unified/`。

类型生成针对无 mapping 的 discriminator 使用 schema 自身的 `const`。这避免 `openapi-typescript` 把四态的 `status` 推断为组件名。bundle 保留来源注解，运行时执行 schema 约束。

两个视图复用 `runtime-engine.ts` 的 AJV 配置、格式、唯一性扩展与脱敏错误实现，各自拥有注册表和延迟编译缓存。新视图关闭 AJV 的 `strictRequired` schema 编写检查，因为媒体的 `required` 引用外层声明。字段必需性仍由 JSON Schema 校验执行。旧视图维持原严格配置。

现有生成、漂移检查、类型检查、构建与测试命令覆盖该视图。脚本导出的 `buildGeneratedArtifacts()` 保留既有默认单视图行为，`generateContracts()` 与 CLI 核验全部已接收视图。`tests/sop-unified-entry.smoke.mjs` 从真实公开入口运行和编译合成正反例，并在独立副本中验证重生成与漂移拒绝。仅有旧合同的隔离 fixture 继续生成旧视图。已有新生成物而缺少新消费锁时，生成器拒绝继续。

此入口只提供 schema 形状与验证。图连通性、依赖与权限的一致性、来源事实、图摘要计算和正常业务链执行由对应消费者拥有。
