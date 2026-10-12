# P2 使用资格上下文审查记录

2026-10-06；基线 `b5d26ec496862eb477ba639e7b37a4c0bdb3015c` 后本轮差异，精确输入见 [verification.json](verification.json)。

## 结论与来源

当前已确认缺陷均已修复，父审按用户指定的 **open-code-review-delegate** 核验修复差异与实际回归，未发现新的可行动问题。逐文件覆盖见 [ocr-coverage.json](ocr-coverage.json)。OCR 只做确定性文件筛选和规则解析，不调用外部模型。

**gstack `/review` 本次调用未收敛，不能作为最终通过记录。** 已完成三轮本机独立对抗审核，各发现一条同一生命周期不变量的不同失败路径；第三轮修复后达到所用技能 Step 5.8 的三轮修复上限，按要求停止该调用，未启动第四次 native pass。保留 `cycles=3, converged=false`；最后修复由父审和实际测试复核，没有最终零修改独立复审的覆盖。后续 PR 交付前须完成该覆盖。历史外部审查超时/无效结果不改变；本轮外部覆盖 unavailable，未调用外部模型。

子审只接收测试/fixture 摘要，父审阅读全部受影响测试。大合同快照按冻结字节、精确语义增量、独立哈希及生成一致性核验；没有把生成物大行数当作人工逐行审查。

## 已修复问题

| 问题与级别 | 修复所有者 | 实际验证 |
| --- | --- | --- |
| P2：旧目录 timer / current() 到期误取消新分页，短期新资格误撤销长期旧句柄 | Main 将目录到期与全上下文撤权分离，保留每个句柄的原截止 | 旧到期/新分页、短新/长旧及回拨不复活 |
| P2：分页完成后的本地过期仍走全局拒绝 | 同一 Main 所有者归一局部 EXPIRED | 已到期新分页失败，旧有效句柄保持可读/可复制 |
| P2：API FORBIDDEN / LEASE_EXPIRED 被升级为全局撤权 | 只识别该精确 code/reason；权限、审批及会话拒绝仍全局失效；合成 HTTP 保留 reason | 18 项 Main 回归；真实 API/PG/HTTP 延迟至期限后的消费探针 |
| validator 先拒绝超限材料，错误原因误归 FILE_INVALID | API 原词项预算门提前至 validator 前，维持 FILE_LIMIT | 既有材料及 PG 词项预算回归 |
| 合成 API 测试直接依赖 desktop，违反应用边界 | 根级独立消费者通过 loopback HTTP 调用实际 Main；未放宽架构检查 | lint 架构门与实际 HTTP 产物消费 |

未修改会话撤权、APPROVAL_REVOKED、PERMISSION_CHANGED 的失败关闭语义。只允许本轮合成入口；生产 ACL、路由、factory/IPC 均未开放。

## Exploratory QA and Verification Results

| 字段 | 值 |
| --- | --- |
| 日期 / 分支 / 基线 | 2026-10-06 / codex/content-intake-p2 / b5d26ec；当前输入 SHA-256 见 verification.json |
| 授权与范围 | 已授权实现、修复、验证及本地 commit；API / DB / Main 合成链 |
| 运行环境 | macOS arm64、Node 24.19.0、pnpm 11.19.0、临时 PostgreSQL 15.18；capture helper 自身为 Bun 1.4.2 |
| 输入与目的地 | 合成工作簿、隔离 Unix socket PG、测试专用 loopback HTTP、内存复制器；无真实数据 |
| 结束原因 | 范围内验证完成；gstack 达到三轮修复上限，停止该调用 |

### 合同结果

| 合同 | 证据 / 预期 → 实测 | 结果 |
| --- | --- | --- |
| 每份资格独立截止；换店/会话/撤权跨句柄失效 | [最终 functional evidence](functional-evidence.json)：18 项 Main 用例 | PASS |
| 实际发布产物可被下游消费 | API PG 合成发布 → HTTP → 根探针 Main → 原文复制；短资格服务端到期保留旧句柄；空目录更新及真实授权撤销清除全部句柄 | PASS；日志与命令见 verification.json |
| 活动会话、持久选择、跨会话/无上下文拒绝、签发与注销排序 | 95 项 API PG/材料检查；认证 8 项；最终 HTTP 变更单独重验 | PASS |
| 精确旧账本升级、不可变绑定、应用 ACL 仍封闭 | 数据库 PG 22 项及生成校验；前 24 段字节与基线一致 | PASS |
| 整仓检查 | lint / typecheck / test / build、workspace / docs / diff；详见验证清单 | 按验证清单记录 |
| 原生 Mac / Windows、真实 Feishu、完整 FAQ UI | 尚未接入对应入口 | NOT RUN |

### 探索历史及证据复用

- [历史 checkpoint 003](qa-history/exploration-003.json)：由旧局部期限行为转向独立到期修复；已被后续验证替代。
- [历史 checkpoint 004](qa-history/exploration-004.json)：补齐分页中本地 EXPIRED 的隔离；已被后续验证替代。
- [最终 checkpoint 002](qa-final/exploration-002.json)：由 14 项本地到期验证增加服务器精确 reason 及相邻拒绝，18 项通过。最终 materialize verdict=pass；这只认证功能 probe，不认证 gstack 审查收敛。

全量测试与 build 并发启动曾触发合同生成排他锁，测试未进入用例；保留失败日志，build 完成后串行重跑。不得把该次失败启动写成测试通过。未变的数据库和 API 主体复用同内容实测；最后变化的 Main、根 HTTP 探针和测试单独重验。

测试清理自身临时 PG、子进程、HTTP server、timer 及内存句柄。本轮未新增常驻进程、原生窗口或 OS 剪贴板副作用。旧 WSL 证据仅属旧提交；没有浏览器/视觉分数。无未修复确认缺陷；缺少的最终 native 复审、真实运行与设备证据如上保留。
