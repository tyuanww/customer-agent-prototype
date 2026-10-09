# `/review` 定向收口记录（2026-10-09）

**结论：INCOMPLETE。** 本轮修复了审查中确认的两条桌面恢复/显示问题，当前增量复核没有已确认待修问题；这不等于整条分支的 gstack `/review` 已完成，也不授权真实运行。

## 输入与范围

- 产品仓：`codex/intake-organization`，从干净的 `c72e0205b436e4271dac3537a593d4bab030f1c4` 开始；版本始终为 `0.3.26`。基于 `8ab309fcd9c494b7343ed88bacb253205d36575f` 的当前分支差异有 1013 个路径、307419 行增删（在本报告正文写入前）。
- 治理仓 `codex/content-intake-p2-contracts` 保持 `0125a97c284a78262a52a67b3d9834107a0f59bc` 且干净，只读。
- 先前的 [覆盖账本](coverage-ledger.json)、[审查记录](review.json)、[真实上传竞争测试](../../../apps/api/tests/content-intake.integration.test.ts) 和 [Grok 定向补证](grok-final-targeted-handoff-2026-10-09.md) 只按原输入与范围复用。账本的旧 `completeReview: INCOMPLETE` 和记录的 `externalCompleteReview: INCOMPLETE` 未改。旧角色 15/15、五条双会话 PG15 上传竞争、三条来源 mode 锁序均未重跑。

## 实际审核与修复

读取已安装 gstack `/review` 的 checklist、Step 5.8、review-army、Step 4.7 和 adversarial 规则。在当前分支执行 `gstack-diff-scope origin/main`，退出 0：frontend、backend、tests、docs、config、migrations、API、auth 均为 true，prompts 为 false。按大差异范围派出 Testing、Maintainability、Security、Performance、Data Migration、API Contract、Design、Simplification 和 Red Team；他们对原候选做定向阅读，对行为增量做 changed-path 复核，未把 1013 个路径说成逐行读完。Design 最初的 FAQ 胶囊按钮怀疑经 `DESIGN.md` 复核撤回，不作为缺陷。

1. `f6ee4deb4302d0c84e86c25cc5a1fd9b280e7c1a`（5 个桌面文件）：在授权请求首次提交结果未知、下一次重试因当前资格被拒时，Main 保留原 operationId/body；更正上传恢复注释；回退历史时间使用既有本机时间格式，确认/关闭按钮进入同一工具栏。Testing、Maintainability、Security、Performance、Data Migration、API Contract、Design、Simplification 对此增量均给出无新增发现的**定向**结论。
2. Red Team 在该增量又指出一条同会话恢复缺口：写请求可能已提交、用户点击停止后，旧响应被判为 `STALE`；若首次重试得到 `FORBIDDEN`，原请求会被清掉。新增测试先实际写入合成回执并扣住响应，证实修复前 `pending` 断言失败（退出 1）；`0a62747819160e2d225fa75c1bad27d1e9b4a66f` 使停止在途写入先标记结果未知，再中止等待。修后定向 55/55，通过同一原请求重试且最终仅一条合成授权。Testing、Security、Red Team 对该两文件增量只读复核，无新问题。跨会话仍清内存 pending 并提示人工核对，未建设持久跨会话回执恢复。

## 命令、结果与证据

| 门禁 | 本轮实际结果 | 证据或限制 |
| --- | --- | --- |
| gstack 技能启动与 scope | `gstack-skill-start --skill review --model claude` 退出 0；`gstack-diff-scope origin/main` 退出 0 | 启动不等于审查完成；九名审查者均为本宿主 Codex 代理，结论限于所读路径 |
| Step 4.7 smoke | 两条真实合成 API/临时 PG15 管理 HTTP，用 `gstack-qa-evidence capture` 记录；成功上传/重放/解析/分页 1 passed，以及匿名/越店/错误输入拒绝 1 passed，均退出 0 | [功能报告](../../../.gstack/qa-reports/review-c72e020-20261009-gstack/functional/report.md)与[物化证据](../../../.gstack/qa-reports/review-c72e020-20261009-gstack/functional/evidence.json)；API 路径及 fixture 在其后桌面改动中未变 |
| 当前恢复探针 | `pnpm --filter @customer-agent/desktop exec vitest run tests/unit/content-intake-permissions.test.ts -t 'keeps the original grant request when stopping after a possible commit precedes a forbidden retry'`：修前退出 1，修后经 `gstack-qa-evidence capture --timeout-ms 120000` 退出 0，1 passed | [checkpoint 003](../../../.gstack/qa-reports/review-c72e020-20261009-gstack/functional/exploration-003.json)。该捕获发生在首次 evidence.json 物化之后，工具拒绝第二次物化（退出 2），所以不把 003 写成该 JSON 中的第三项 |
| 定向回归 | `pnpm --filter @customer-agent/desktop exec vitest run tests/unit/content-intake-permissions.test.ts tests/component/intake-rollback.test.tsx tests/unit/content-intake-upload.test.ts`：退出 0，55/55 | 当前桌面恢复、回退显示和上传单测 |
| 根检查 | `pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm build`、`pnpm workspace:check` 全部退出 0 | [test-final.log](../../../.gstack/qa-reports/review-c72e020-20261009-gstack/test-final.log)、[build-final.log](../../../.gstack/qa-reports/review-c72e020-20261009-gstack/build-final.log)；API 567 passed/362 skipped，桌面 1461 passed/7 skipped；当前分组预算总量 39.5/45、合同 12.8/15、证据 9.86/10、源输入 16.8/20 MiB。旧 32 MiB 失败不改写 |
| 提交门禁 | 两次代码提交各自显式 `git add` 指定文件、`git diff --cached --check` 退出 0、暂存 diff 经 `gstack-redact --repo-visibility public` 扫描退出 0，无发现；作者 `tyuanww` | 只本地提交，不推送/建 PR/合并/部署 |

## 尚未满足的完整 `/review` 条件

1. 已安装的 Claude 宿主技能要求 native Step 4.8 及非 Grok 的独立外部声音。本会话处于 Codex 宿主，已做 Codex 内对抗复核，**不能冒充 Claude native**。上轮 Claude Code 外部尝试 120 秒超时并给出模型配置诊断；没有配置已修复的证据，本轮遵照限定未无界重试。两项都没有可计为完成的当前输入结论。
2. 1013 路径的大分支未在本轮按 checklist 做全量语义审查；specialists 和 Red Team 的定向结论不能替代它。Step 4.7 的两条 smoke、桌面恢复探针与根检查已实际通过；未把未执行的计划/设备/真实运行探针写成 PASS。完整门禁仍须在其适用输入上补齐并做最终零修改复审，才可将 `completed` 改为 true。
3. 历史限制继续保留：86/97 个含 `public/pg_temp` 的 `SECURITY DEFINER` 未逐个动态试验；冻结 schema/OpenAPI 有批准哈希与谱系而非全文逐行语义审查；CSV 外部审核仍 INCOMPLETE，0033 ACL 的 `formallyFixed` 仍 false。真实飞书/客户/员工资料、生产配置、标准尺寸真人系统框与 Windows 均不在本轮授权内。

本报告是本次新增量及运行结果的索引；不扩充原覆盖账本的旧范围，也不把 OCR 的 `coverage_rate=1.0` 解释为完整 `/review` 通过。
