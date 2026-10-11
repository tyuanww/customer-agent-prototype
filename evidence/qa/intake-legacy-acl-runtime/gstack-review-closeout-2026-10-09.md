# `/review` 定向收口记录（2026-10-09）

> 证据交付边界（2026-10-12 校正）：下文 `.gstack/` 文件只在原本机工作树保留，未随 Git 交付，远端审阅者不能据此直接复核原始执行。本文保留历史观察及其限制；这些本机路径不是仓内可点击证据，也不证明当前版本通过。
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
| Step 4.7 smoke | 两条真实合成 API/临时 PG15 管理 HTTP，用 `gstack-qa-evidence capture` 记录；成功上传/重放/解析/分页 1 passed，以及匿名/越店/错误输入拒绝 1 passed，均退出 0 | 功能报告（本机历史文件 `.gstack/qa-reports/review-c72e020-20261009-gstack/functional/report.md`）与物化证据（本机历史文件 `.gstack/qa-reports/review-c72e020-20261009-gstack/functional/evidence.json`）；API 路径及 fixture 在其后桌面改动中未变 |
| 当前恢复探针 | `pnpm --filter @customer-agent/desktop exec vitest run tests/unit/content-intake-permissions.test.ts -t 'keeps the original grant request when stopping after a possible commit precedes a forbidden retry'`：修前退出 1，修后经 `gstack-qa-evidence capture --timeout-ms 120000` 退出 0，1 passed | checkpoint 003（本机历史文件 `.gstack/qa-reports/review-c72e020-20261009-gstack/functional/exploration-003.json`）。该捕获发生在首次 evidence.json 物化之后，工具拒绝第二次物化（退出 2），所以不把 003 写成该 JSON 中的第三项 |
| 定向回归 | `pnpm --filter @customer-agent/desktop exec vitest run tests/unit/content-intake-permissions.test.ts tests/component/intake-rollback.test.tsx tests/unit/content-intake-upload.test.ts`：退出 0，55/55 | 当前桌面恢复、回退显示和上传单测 |
| 根检查 | `pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm build`、`pnpm workspace:check` 全部退出 0 | test-final.log（本机历史文件 `.gstack/qa-reports/review-c72e020-20261009-gstack/test-final.log`）、build-final.log（本机历史文件 `.gstack/qa-reports/review-c72e020-20261009-gstack/build-final.log`）；API 567 passed/362 skipped，桌面 1461 passed/7 skipped；当前分组预算总量 39.5/45、合同 12.8/15、证据 9.86/10、源输入 16.8/20 MiB。旧 32 MiB 失败不改写 |
| 提交门禁 | 两次代码提交各自显式 `git add` 指定文件、`git diff --cached --check` 退出 0、暂存 diff 经 `gstack-redact --repo-visibility public` 扫描退出 0，无发现；作者 `tyuanww` | 只本地提交，不推送/建 PR/合并/部署 |

## 尚未满足的完整 `/review` 条件

1. 已安装的 Claude 宿主技能要求 native Step 4.8 及非 Grok 的独立外部声音。本会话处于 Codex 宿主，已做 Codex 内对抗复核，**不能冒充 Claude native**。上轮 Claude Code 外部尝试 120 秒超时并给出模型配置诊断；没有配置已修复的证据，本轮遵照限定未无界重试。两项都没有可计为完成的当前输入结论。
2. 1013 路径的大分支未在本轮按 checklist 做全量语义审查；specialists 和 Red Team 的定向结论不能替代它。Step 4.7 的两条 smoke、桌面恢复探针与根检查已实际通过；未把未执行的计划/设备/真实运行探针写成 PASS。完整门禁仍须在其适用输入上补齐并做最终零修改复审，才可将 `completed` 改为 true。
3. 历史限制继续保留：86/97 个含 `public/pg_temp` 的 `SECURITY DEFINER` 未逐个动态试验；冻结 schema/OpenAPI 有批准哈希与谱系而非全文逐行语义审查；CSV 外部审核仍 INCOMPLETE，0033 ACL 的 `formallyFixed` 仍 false。真实飞书/客户/员工资料、生产配置、标准尺寸真人系统框与 Windows 均不在本轮授权内。

本报告是本次新增量及运行结果的索引；不扩充原覆盖账本的旧范围，也不把 OCR 的 `coverage_rate=1.0` 解释为完整 `/review` 通过。

## A1–A5 修复提交的后续绑定（2026-10-09）

在上述记录之后，产品仓从 `468375e0644bd30e15051d1975e4ce4923e9521b` 完成两笔本地提交：`eda5ab709df9d297696f1cff5469bc96e8581afb` 只包含 API 事务回滚失败的未知结果归一及测试（2 个文件）；`15bcc6c732a26ae3ceb24eb7b47a3f2dea25084e` 包含桌面确定性拒绝、无 pending 重试守卫、结果未知的关闭提示，以及授权 POST／撤销 PATCH 原请求恢复与测试（12 个文件）。作者均为仓库既有的 `tyuanww`；版本仍为 `0.3.26`。两笔提交后工作树干净，治理仓仍在 `0125a97c284a78262a52a67b3d9834107a0f59bc`，未推送、建 PR、合并或部署。

提交没有再修改已测代码。`git diff 468375e..15bcc6c` 对原 13 个跟踪文件的 SHA-256 为 `6e520b285bd67c223bf85b679eedfddddf573fbf5f65e41099bfce612f2fb8d0`，新增 `apps/desktop/src/shared/content-intake-recovery.ts` 的 SHA-256 为 `94506e7cf6550762bc8bb611fb229f02f9102e9e89734cde0212e0764cde584d`，均与提交前验证输入相同；因此复用下列本机合成结果，而不把“提交成功”当作重新运行测试：API 事务单测 12/12，桌面受影响回归 67/67，根 lint/typecheck/test/build、分组 workspace:check 均退出 0；两条实际 PG15 管理 HTTP 定向探针各 1 passed，最终 Electron/HTTP/PG 权限探针 1 passed。最后的窗口按钮增量另有定向 21/21 与 lint/typecheck/build/E2E 复核。详细命令、未运行项和原始日志在本机 `.gstack/qa-reports/review-468375e-20261009/a1a5-review-gap-report.md`；该 `.gstack` 目录为本机忽略证据，不声称已经随提交导出。两份物化探针结果摘要分别为 `845a25131982031ae7b6135ecb51d419cf2524b906a1965d4850908402a9bb2e` 与 `ca2fea77bc4426fa5fb657e615f35afe107c4bf3f0d85f2749bbef02bac22efa`。

每笔提交前均用明确路径暂存并运行 `git diff --cached --check`，退出 0。API 暂存差异的 `gstack-redact --repo-visibility public` 无发现；桌面差异的四条 MEDIUM 仅命中新增单测的合成 `http://127.0.0.1:5173` 地址，核对精确片段后仅对这些地址豁免，重扫 HIGH/MEDIUM/LOW/WARN 均为 0。两笔最终差异的 14 个文件已做本地逐文件复核；先前 Security、Testing、Maintainability 与 Codex 对抗复核仅覆盖这个增量，不能外推为整分支。

按当前稳定 HEAD 重新对照账本：`git diff --name-only 3bbf065..15bcc6c` 为 20 个路径；旧账本记录其中 18 个，另两个新增路径是本次 shared 恢复谓词与此前的审查记录。`3bbf065..15bcc6c` 的六笔提交依次为 `c72e020`、`f6ee4de`、`0a62747`、`468375e`、`eda5ab7`、`15bcc6c`；前一份定向审查记录覆盖中间两笔行为修复，`468375e` 仅记录审查，后两笔行为增量由本节与本机 A1–A5 报告精确绑定。当前 `merge-base..HEAD` 有 1015 个差异路径；这里的 20 路径增量映射不能证明其余分支内容已按 Pass 1/2 全文语义审查，旧账本也不因路径均有处置就自动更新为通过。

本轮只读分类旧账本的待语义核对面：`reviewable + hash_check` 共 379 路径、当前 Git 对象去重后 352 种字节；其中 `evidence/qa` 284 路径，冻结 `contracts/upstream` 58 路径，`packages/database` 的迁移/overlay/配置 26 路径，其余 package、脚本及 workspace 输入 11 路径。历史合同副本中有精确同 blob 可复用的条目，但“同字节”只消除重复阅读，不证明首次语义审查已经做过。下一批 Pass 1 应先核对当前消费的冻结合同与数据库安全边界，再处理其历史同 blob 副本；证据 JSON 的 284 个哈希记录不能冒充运行或审核结论。本轮没有把任何 `hash_check` 改写为 `semantic_read`，也没有新缺陷结论。

完整 `/review` 继续为 **INCOMPLETE**：旧覆盖账本停在 `3bbf065` 的输入；当前大分支 Pass 1/2 全范围语义结论、所需 specialist/native 对抗及有效非 Grok 外部来源仍未齐。`review.json` 的 `externalCompleteReview`、CSV 外审和 0033 ACL 既有状态不因这两笔修复而改写。正式资料、具名主体、来源登记、旧目录认领、历史保留期和生产装配的准确缺项沿[Menokin 整理对照](../../../docs/reference-intake-menokin-readiness.md#真实整理前只缺这些内容)及现有 TODO 管理，不新增业务事项或真实数据接入。

## Grok 语义补审核对与 F2/E1 定向推进（2026-10-09）

仓外 Grok 报告在 `~/Desktop/客服Agent-Grok-合同语义补审-20261009/`；主 Agent 逐项核对在 `~/Desktop/客服Agent-Codex-核对Grok补审-20261009/`。本轮独立重算旧账本 `reviewable + hash_check` 的 379 个路径与当前 HEAD 字节，零哈希失配；27 个 `exact_reuse` 均指向本轮标为 `semantic_read` 的同 blob。六份当前运行伴随 SQL 被 0033 字节包含，0035 仅有八函数 EXECUTE。计数不证明全文语义审查：272 个 QA 条目的阅读范围只是顶层状态，冻结 schema/OpenAPI 也只读相关片段。

F1 的模式差异属合成 `v2-preview` 共存，批准计划 E14 只要求与 `v2-active` 相交时拦截旧写；前后顺序下基线/lineage 会失败关闭，不将 F1 记为当前 Medium。S1–S4 维持疑似。F2 在 `apps/api/src/content-intake/publication.ts` 的资源级 SQL 拒绝映射中确有合约偏差：准备阶段通过后若授权变化，最终 `ZA005/SCOPE_DENIED` 曾变成 403。新增实际 PG15 合成测试在修复前得到 `FORBIDDEN`（预期 `NOT_FOUND`，1 failed/159 skipped）；随后只将该资源拒绝映为 `NOT_FOUND`，无权前置检查和准备后撤权两条定向测试 **2 passed/158 skipped**。未改冻结合同、数据库函数或全局拒绝语义。

E1 的原五规格记录 exit 1 继续保留。当前 Mac arm64、Node 24.19.0、pnpm 11.19.0、合成 PG15 环境，以 `CUSTOMER_AGENT_INTAKE_SYNTHETIC_E2E=1 CUSTOMER_AGENT_INTAKE_PURPOSE_RUNTIME=1 pnpm --filter @customer-agent/desktop exec playwright test` 加原五份 `content-intake-*-real-stack.spec.ts` 的**同一组合**复跑，exit 0、8/8 passed；[日志的本机路径脱敏副本](../intake-unified-workspace/electron-five-spec-rerun-2026-10-09.log) SHA-256 为 `5af39f19df18ced11ca7842eca60f2d4f84191b4a44f8624721c96384cda9b64`。该结果只证明合成五规格在本轮工作树通过，不覆盖标准尺寸真人系统框、Windows 或真实资料。

根 `pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm build` 全部 exit 0；`pnpm workspace:check` exit 0，分组值为总 39.5/45.0、冻结合同 12.8/15.0、冻结证据 9.88/10.0、源码输入 16.8/20.0 MiB。OCR 工作区预览只选中 `publication.ts` 一份行为源码，排除七份测试/Markdown，新增 `.log` 未进入其清单；OCR 主审 1/1 返回一条 Medium 样式意见（多层三元表达式），评论过滤子请求超时，不能称完整无缺陷外审。按意见改成 if/else 后，主 Agent 以 delegate 规则复核源码和测试，并逐份核对其余文档及脱敏日志；九个暂存路径均有处置。本机定向 ESLint、API `tsc --noEmit`、API build 退出 0，实际 PG15 两条发布撤权用例为 2 passed/158 skipped。原根检查输入的行为逻辑未变；其余较广测试不因本次样式改动机械重跑。当前 API 行为代码与测试的文件 SHA-256 分别为 `43d25978b7a195df8a72fc9614a520259eb2e716b23681f61c1a3f5605d884e0`、`82eecdb88cede980ee4ecd780204e7114105364b3d2c2d9b0d29cb01ee3c9bc5`；两文件相对原 HEAD 的 binary diff SHA-256 为 `a827812422a1bc4cfbda632d09c4e4d059d02af9b69525edca75942904cb6386`。文档按 `document-release` 核对直发、CSV/XLSX、35 段迁移与五规格命令，`pnpm docs:check` 退出 0，独立本机文档复核无剩余本次范围内问题。以上只收口当前增量；`externalCompleteReview` 与完整 `/review` 仍为 INCOMPLETE。
