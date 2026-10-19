# JOB_ROSTER 权限模型（P0-P3）

这份说明记录客服桌面登录、权限投影和查询的共同边界。它是代码评审和本地验收的口径；上线前仍需用同一套合成数据完成 PostgreSQL 集成验证。

## 结论

运行时唯一决定因素是 `content_intake.authorization_deadline` 返回的有效业务授权。它同时要求：主体当前事实存在且在五分钟租约内、业务授权未撤销且未过期、授权的 tenant/app/scope/action/source 与请求一致。`JOB_ROSTER` 是稳定职务目录，`role_rules` 是预先配置的签发策略，五分钟事实是 Feishu 对主体的短期证明；这三者都不能单独放行查询。

客服登录只做身份和策略投影：命中既有 `role_rules` 后登记主体和五分钟事实，查询授权由 `content-intake-system/query-signer` 按当前发布内容签发。登录路径永远只传 `query`；`publish`、`import` 和 `grant` 必须走已有的显式签发流程。没有匹配策略时返回 `policy-pending`，不写主体、事实或授权。

## 流程和不变量

### 登录

1. Feishu 证明 open id、职务原文和部门 id；`normalizeJobTitle` 只做 NFKC、Unicode 空白折叠和首尾空白清理。
2. `matchJobRoster` 用稳定的 `jobId` 精确匹配；未知职务、空职务和重复目录项都不能猜测角色。
3. 数据库要求同一 tenant/app、部门交集、稳定 `jobId` 和角色的 `role_rules` 已存在。策略不存在时返回 `policy-pending`，不登记人。
4. 策略存在时登记主体和新的五分钟事实。重复登录递增 `facts_version`，旧事实自然失效。

不变量：职务字符串不能成为主体或授权的身份键；首次登录不能创建策略；部门不匹配不能套用同名职务；登录失败不会把主体当成有查询权的人。

### 签发

`content-intake-system/query-signer` 是唯一的自动查询签发人。它不是登录人，也不复制任何 allocation/delegation 父授权。系统签发的查询授权必须指向当前发布内容的 `release_lineage`，来源为 `v2-preview`，过期时间不超过内容有效期和一天。

不变量：自动路径不产生 `publish`/`import`；业务授权必须有可追溯的 issuer；没有当前内容的店不会获得查询授权；已有人工授权不被登录投影冒充或覆盖。

### 查询

查询服务只调用 `authorization_deadline`，不读取 `JOB_ROSTER` 或 `role_rules` 作为放行条件。返回的店集合来自当前发布内容中存在有效 lineage 的来源，店目录只是显示投影。

不变量：查询按钮可见性和服务端放行分开；事实或授权任一到期都立即拒绝；未知职务、策略待配置、主体缺失、事实过期和无查询授权最终都显示「没有权限，请找人开通。」。

### 撤权

下一次登录或策略投影按当前内容重新计算查询来源：职位变更会撤回名单系统签发的旧授权；内容从当前发布集消失会撤回对应来源授权；离职通过禁用主体/事实或撤销授权立即生效。发生撤权时递增主体 `revocation_generation`，让桌面已缓存的资格失效。

不变量：撤权不删除审计行；已撤授权不能因五分钟事实刷新恢复；重新获得权利必须重新经过稳定职务、部门策略和当前内容三项判断。

## P0-P3 交付边界

| 优先级 | 已落地的判断/代码边界 | 验收条件 |
| --- | --- | --- |
| P0 | 有效业务 grant + 五分钟事实是唯一运行时权威；登录只登记匹配主体并自动签发 query；禁止 allocation 冒充登录签发人 | `authorization_deadline` 在无业务 grant 时始终为空；未知策略不产生 principal/facts/grant；query 可用时 publish/import 仍没有自动 grant |
| P1 | `JOB_ROSTER` 每行有稳定 `jobId`；职务容错限于 Unicode 格式噪声；部门交集参与策略匹配；当前 `release_lineage` 是内容店集合 | 同名不同部门不放行；全角空格和 Unicode 空白可匹配；来源无当前有效 lineage 时不签发；新增 source 不会因登录自动获得 |
| P2 | Feishu 快照五分钟 TTL；过期快照从 token 查询中删除；API 投影记录 `projected/registered/policy-pending/missing-binding` | 五分钟后 `/v1/auth/job` 不再返回旧职务；事实刷新与查询放行都重新检查数据库授权；投影异常只记录状态，不中断登录交换 |
| P3 | 静态权限边界测试、迁移生成检查、单元测试和权限模型文档 | 生成迁移可复现；边界测试确认无 role fallback、无父授权复制、无 publish/import 自动签发；未连接杭州时不宣称远端验收通过 |

## 首日行为

现有配置和当前发布内容都通过时，客服首次登录后看到客服职务和查询入口，查询只能覆盖当前已有内容的店；发布、上传 SOP 和发授权仍由显式流程控制。策略缺失、部门不匹配、未知职务、主体未登记、事实过期、授权过期或撤销时，登录本身可以成功，但查询保持拒绝并显示固定句子「没有权限，请找人开通。」。

