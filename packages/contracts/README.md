# `@customer-agent/contracts`

本包只负责把已经通过 `contracts:intake` 验证的不可变 OpenAPI 快照编译为五个受控产品仓资产：

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
