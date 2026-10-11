# P2 来源确认与人工审批证据验收

范围：`codex/content-intake-p2`，前序 `46c39ab` 后本轮差异。仅合成资料、隔离 PostgreSQL 15 和内存审批 transport；沿[计划 §0.7](../../../docs/plans/2026-10-03-content-intake-requirements.md)推进。原工作区改动保留。前序提交只复用未改变的证据，不宣称重审整个历史分支。

`confirmSource / requestReview / review / refreshReview` 已被实际执行器消费。审核包含完整材料、差异和贡献人，经对象存储及独立附件字节回读；来源补证不改变材料摘要。历史人工资格与当前候选权限分别判断；`ready` 不是发布回执。

## 审查与修复

Pre-Landing Review: **0 unresolved issues（0 critical / 0 informational）**；宿主及原生零修改复审 completed=true、converged=true，1轮修复。外部修后对抗复审完成且格式校验通过；外部修后结构化复审仍在540秒后超时，属于 missing coverage。首轮两项外部超时原样保留，不能称全部外部审查通过。

本轮先复现再修复两处 P1 权限缺陷：历史事实/授权的微秒到期与毫秒决策边界不完整，以及把授权事务内时间误作已提交资格。4 个回归在修前连续两次失败，修后原命令 4/4、全部 36/36 通过。实现按完整 `[T,T+1ms)` 校验，复用同一内容锁下的审核包检查点证明角色/业务 grant 已提交；晚取得资格需新建审批，不倒算旧 PASS。该证明依赖受控事实与所有资格写入者遵守锁序，真实组织同步的真实性与写入时序仍待验证。另修复控制字符校验的 lint 错误，删除重复 readiness 表达。

宿主 OCR 可审18/18（7份代码、11份JSON证据），6项工具排除文件已补充检查，逐项覆盖见[文件清单](ocr-coverage.json)。原生对抗复审为 `NO_FINDINGS`，测试按技能限制只看摘要；父级完整读取测试并执行实库。Review Army 未派发，不用默认质量分数宣称专家覆盖。外部结果见[审查尝试](review-attempts.json)；失败尝试不算 clean，也不覆盖历史外部失败。

## Exploratory QA and Verification Results

| 项目 | 实际记录 |
| --- | --- |
| 日期 / 分支 / 输入 | 2026-10-06 / codex/content-intake-p2 / HEAD46c39ab 后未提交输入；[26 项输入 SHA](inputs.json) |
| 范围与授权 | `/review`；用户已授权合成实现、测试和修复；没有生产数据、端口、外发或发布 |
| 运行环境 | macOS arm64；Node24.19.0、pnpm11.19.0、PG15.18；证据工具 Bun1.4.2 |
| fixture / 目的地 | Pg15Harness 独立集群、任务临时对象目录、进程内实例与附件；测试结束关闭连接并移除集群 |
| 探针时长 / 停止 | 7 次 capture 共90,845ms；首轮 smoke未重置，修后必要复验已完成；[工具证据](evidence.json) verdict=pass、open=[] |

| 合同与入口 | 期待 → 实际 | 结果 |
| --- | --- | --- |
| `pnpm --filter @customer-agent/api test:intake:transactions` | 同一测试命令覆盖实际 XLSX/候选/包/附件、历史资格和撤销传播 → 31 PG + 5 材料全部通过 | PASS，capture005 |
| 原失败命令 `vitest ... -t 'sub-millisecond\|uncommitted grant'` | 不合格人工审批不得写事实；提交后新审批恢复 → 修前4失败、修后4通过 | PASS，003/004→006 |
| 原成功与高风险命令 `vitest ... -t 'round-trips\|keeps revoked'` | 资料包完整消费、常规自审、撤回不能被晚到结果复活 → 2通过 | PASS，修后007 |
| `pnpm lint / typecheck / test / build` | 当前输入全部退出0；根test默认跳过实库，本轮PG由上面的独立命令实跑 | PASS，[检查记录](checks.json) |
| `pnpm workspace:check / docs:check`、`git diff --check` | 目录预算、引用、差异检查通过；证据落盘后追加文档/目录核验 | PASS，[检查记录](checks.json)含收尾复验 |

根测试中 API 448通过/122条件跳过（其中本轮31PG已独立实跑），桌面1096通过/1条件跳过。未将默认跳过的其他实库、实机或窗口E2E算作本轮通过。未更改UI，不做视觉评分。

### 探索记录与永久回归

- [checkpoint002](exploration-002.json)：原成功/撤回探针进入完整必要测试；修前历史。
- [checkpoint003](exploration-003.json)：32项旧回归通过后，审查提出历史资格精度与提交时序缺口；修前历史。
- [checkpoint004](exploration-004.json)：新增4项实际失败后，原命令重放确认。
- [checkpoint005](exploration-005.json)：失败再现后修复并运行全部36项。
- [checkpoint006](exploration-006.json)：完整36项通过后，用原失败命令闭合回归证据。
- [checkpoint007](exploration-007.json)：4项修复转绿后，复验共享依赖所影响的原成功与撤回契约。

永久回归在 [API 实库测试](../../../apps/api/tests/content-intake.integration.test.ts)。初始001/002与失败003/004仅保留为历史；当前验证是005/006/007，源码与测试/合同/锁文件哈希在检查、复审和提交前核对未变。工具生成的证据与checkpoint按原始字节复制，未改写失败结果。原始证据内的 `../r2-inputs.json`、`../checks-r2.json` 指向本机生成位置；可移植副本分别是本目录的 `inputs.json`、`checks.json`。

### 验证边界

已验常规自审/关键他审/贡献人回避、当前撤权与历史PASS区分、严格实例/表单/任务/时间线/附件绑定、创建丢响应原UUID恢复、审批提交未知永久回执重放、换实例/补证/取消竞争、过期及GET/失败刷新不续期、锁外I/O、撤回终态和全部继承release失效。撤销传播测试使用既有合成release支持，不证明P2新发布成功。

未验证真实 Feishu 原生协议/认证/凭据/附件、组织事实写入器、生产角色ACL/HTTP/Main/preload、10倍PG历史规模、对象字节预留/retention和实机。来源整数先后检查已有实现，但最终发布时的并发先后门须由下一发布切片证明。当前审核包建立后新取得角色/业务资格须重开审批，这是保守证明的已知限制。

## 下一入口与验收

下一切片沿冻结合同§2/§5将 ready 候选接到既有发布底座：受控 staging 与质量证据、60秒单次票据、同事务 release/current/公告/catalog/lineage/publication/永久回执。旧函数在 `0020_coach_publish_v1_19.sql`；既有质量计划/population hash/抽样缺陷门、owner acceptance、治理摘要和四域来源继续有效。新路径只替换旧双组织声明，不伪造两位审核人，不直接插release作为运行实现。

必须覆盖发布/撤权、发布/取消、同base竞争、响应未知原键恢复，以及缺行继承、显式停用和全部来源谱系；旧整域写按实际影响集合共锁并继承未触及catalog，否则拒绝。原子发布、旧写隔离和使用资格完成后再连接另一坐席按店查询；这些实现尚未完成，不能由当前 ready 或合同安装推断通过。应用新schema ACL保持封闭，未push/PR/merge/deploy、未启用active。收尾再次 fetch origin/main 遇网络超时；本轮沿用启动时取得的 `8ab309f` 目标基线，审查对象为 `46c39ab` 后差异，不声称收尾已同步到远端最新。

## 2026-10-11 命令展示补充

原始 `evidence.json` 的 001、003、004、006、007 五条 `command` 展示串省略了 `-t` 参数引号，不能直接复制到 shell 执行。可复制命令与原始参数数组见 [replay-commands.json](replay-commands.json)，从同一证据的 `learning` 参数数组还原，并验证 shell 分词往返相同；`|` 保留在单个筛选参数内，不作为管道。原日志、状态、输入摘要和证据 JSON 字节均未改写。本轮仅修正文档消费方式，没有重跑这些历史测试；重放仍须恢复记录绑定的输入、Node 24/PG15 环境与专项开关，不能将旧通过迁移为当前 HEAD 的验收结论。
