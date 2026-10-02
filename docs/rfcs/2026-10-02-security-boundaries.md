# RFC：安全边界纯函数

状态：`DRAFT · 等待第二个真实消费者`

本 RFC 讨论把安全边界中的纯机制复用于第二个项目的条件。当前安全合同仍由 `apps/api/src` 及其数据库合同共同拥有；本 RFC 不开放真实凭据、真实客户数据、自动发送或新的认证方式。

## 当前 owner

当前实现分散在几个有明确产品语义的 owner 中：

- `idempotency.ts`：canonical JSON、密钥环多版本 HMAC 和请求 hash；
- `policy-rules.ts`：owner 权限与 Phase 1 hard-off flag 的纯授权判断；
- `request-log.ts`：请求上下文和 actor hash，避免原始 user id 写入日志；
- `content-import-multipart.ts`、`search-text.ts` 等：请求大小、字符和查询边界；
- 数据库 migration 与 API repository：幂等 lease、scope、持久化 replay 和 SQLSTATE 到稳定结果的映射。

这些模块现在绑定 API 合同、密钥版本和业务 policy，不能直接复制成“通用 security package”。

## 候选公开 API

第二个消费者出现后，只考虑无 I/O 的机制层：

```ts
canonicalJson(value) -> string
prepareDigest(value, keyRing, domain) -> VersionedDigests
safeHash(value, key, domain, version) -> string
validateBoundedText(value, limits) -> BoundedTextResult
authorize(claims, action, policy) -> Allow | Deny
```

候选接口不得接收 request、Fastify reply、数据库 client、文件路径或全局 env。`domain`、版本、长度上限、允许动作和 policy 都必须是调用方显式提供的值。

## 留在项目内的知识

- HMAC key ring 的来源、轮换窗口、版本名和密钥读取方式；
- 幂等 scope、数据库函数、lease TTL、replay body schema 和 HTTP status；
- actor role、租户、资源所有权、Phase 1 hard-off flag 和审核规则；
- PII / 敏感字段清单、日志保留、脱敏格式和合规策略；
- 错误码到产品反馈文案的映射。

共享机制只能产生稳定的 allow / deny、digest 或 bounded result。它不能自行决定某个项目的“owner”“发布”“自动发送”或“合规通过”。

## 依赖与注入

候选共享层只能使用标准库纯函数和显式输入：

- canonical JSON 的值域和有限数字规则；
- hash / HMAC 实现与 domain separator；
- 文本、字节、集合和结构深度上限；
- claims、action、policy evaluator 和脱敏 field policy。

密钥、环境变量、日志 sink、数据库 idempotency table 和外部身份 adapter 都留在项目边界。共享层不能把“拿不到 key”降级为普通 hash，也不能把授权失败降级为默认允许。

## 失败策略

| 情况 | 结果 |
| --- | --- |
| 输入超长、非法 Unicode 或结构超限 | 拒绝，并返回不含原文的稳定原因 |
| canonical JSON 遇到非有限数字或不支持值 | 抛出 typed input error，禁止隐式字符串化 |
| key ring 缺少当前版本 | fail-closed，不能回退到旧 key 或明文摘要 |
| policy evaluator 无法决定 | deny，保留项目内审计上下文 |
| 未知 action / domain | 拒绝，不能用相似字符串匹配 |
| 日志或诊断格式化 | 只输出允许字段与受限 digest，不输出原始 user id / body |

共享层不负责重试。幂等冲突、lease 过期、数据库提交未知和来源门失败由项目 repository 根据自己的恢复合同处理。

## 独立验证方式

第二个消费者的 adapter 至少应有：

- canonical JSON 的键排序、数组顺序、Unicode、非有限数字和嵌套上限测试；
- domain / version / key rotation 下的 digest 对照和跨版本 replay 测试；
- 每个 action 的 allow、deny、unknown action 和 policy unavailable 反例；
- 证明原始请求 body、user id、token 和 key 永不出现在结果与日志的脱敏测试；
- fuzz 或性质测试，保证不同输入不会意外共享可接受的 canonical 表示；
- 架构门和依赖审计，确认没有 API、数据库、Electron 或环境读取。

只有两个项目对同一机制给出相同结果，且项目 policy 仍通过显式注入表达，才可以提炼公共 package。

## 停止抽取条件

出现以下情况时保留项目内实现：

1. 两个项目的 canonical 表示、HMAC domain 或 key rotation 语义不同；
2. 共享 API 需要内置角色、租户、PII 字段或合规规则；
3. 安全失败需要不同的恢复、审计或用户反馈；
4. 为满足一个项目而加入隐式默认 key、默认 allow 或静默脱敏；
5. 纯函数无法在不携带项目状态的情况下表达不变量。

## 相关文档

- [`@customer-agent/api` README](../../apps/api/README.md)
- [项目架构与目录边界](../reference-project-architecture.md)
- [可复用能力 RFC 索引](README.md)
