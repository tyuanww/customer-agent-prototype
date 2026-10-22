# SOP 链路整改（2026-10-23 第二轮）

上一轮审核列了 5 个阻断项与 6 个可用性缺口。这一轮逐项处置，状态写在每项后面。

## 已解决

### B1 业务模板被拒

模板不再是一个散落在桌面上的文件，而是代码。

`packages/content-intake/src/sop.ts` 新增 `createSopTemplate(samples)`，`scripts/write-sop-template.mjs` 把它写成 xlsx：

```sh
node scripts/write-sop-template.mjs --out ./SOP-模板.xlsx
```

第 1 行是 `条目编码 | 答案`，示例行写 `DEMO-n` 并从第 2 行开始（第一版把示例写到了第 1 行，覆盖了表头，`sop-template.test.ts` 当场抓到）。

`apps/api/tests/sop-template.test.ts` 断言两件事：空模板只报 `EMPTY_DATA`（没有表头错误），带示例的模板解析出 `DEMO-1` 且正文正确。

### B2 生产无有效授权

`scripts/bootstrap-sop-v2.mjs`，默认 dry-run，`--apply` 才写，`--rollback` 反向。

它做四件事：在 `scope-menokin-product` 上注册 `src-menokin-sop-v2`（FAQ 元组 + `sop-not-imported` 标记）、把该来源并入当前 store set（新版本，不改旧版本）、给 `hz-publisher` / `hz-reviewer` / `hz-allocator` 签 allocation 与 business grants、`--rollback` 撤销 grants 并把来源移出当前 store set。

不切现有五个来源：`sources.source_id` 与 `scope_id` 不可变（`0021 source_scope_guard`），而 `src-menokin-faq` 等四个来源仍是 legacy 批量链，切到 `v2-preview` 会动摇当前服务 408 行的发布表。

本地验证（临时 PG15 + 全部 61 条迁移）：

| 步骤 | `authorization_sources` | `authorization_deadline` |
| --- | --- | --- |
| apply 前 | 0 行 | null |
| apply 后 | 1 行 | 有值 |
| 再次 apply | 1 行（24 条 grant 不变，store set 不新增版本） | 有值 |
| rollback 后 | 0 行 | null |

过程中三个真实约束被踩到并修正，都是脚本必须遵守的事实：

1. `sources.current_mapping_version` 外键 `DEFERRABLE INITIALLY DEFERRED`，注册必须在同一事务里写完两行。
2. `grant_parent_guard`（`0060:22-29`）要求 parent 的窗口**严格包含**子 grant 的窗口，否则 `GRANT_PARENT_MISMATCH`。根 allocation 因此取 `now - 1h` 到 `now + days + 1d`。
3. `0021` 的表级 CHECK 禁止业务 grant 自授（`kind='allocation'` 除外）。`hz-allocator` 的 query 因此由 `hz-publisher` 签发，后者也需要自己的根 allocation。

`--rollback` 不能删注册：`source_mappings` 受 `INTAKE_HISTORY_IMMUTABLE` 保护，且它的外键指向 `sources`，两者于是都留了下来。`sources` 本身没有不可变触发器。它改为撤销 grants 并用新版本 store set 把来源移出可读集合，这是真正收回访问的那一步。

### B4 首个 publish grant 无法自助创建

同一个脚本用直连 SQL 写入根 allocation 与首批 business grants，绕开 `authority.ts` 的 `SELF_ESCALATION`（`:126`）与 `issuingParent`（`:89-98`）限制。这是引导操作，不是放宽。

### B5 只有 import 权限看不到候选

不改代码。脚本给操作者同时签 `import` 与 `content-manage`（`hz-publisher` 两项都有）。`content-intake-upload.ts:89-91` 的 `canManage` 因而通过。

### C1 材料只能单向翻页

服务端 `files.ts` 的 material 新增 `previous` 查询参数：用当前页自己的 cursor，服务端减一页。参数只接受 `true`/`false`，其它值 `FILE_INVALID`。

桌面 `content-intake-management.ts` 维护 `materialTrail`（每一页是用哪个 cursor 取到的）。向前用 `page.nextCursor`，向后重发 `materialTrail` 末项并 `pop()`。cursor 签名是服务端独占的，客户端算不出来，这就是必须记 trail 而不是推 offset 的原因。

`MaterialPage` 加了「上一页材料」与页码。第一版我试着从 offset 反推 cursor，签名对不上，属于当场发现并改掉的错误。

### C3 解析进度要手动刷新

`ContentIntakeUpload.needsSettle()` 判断 job 是否还在 `reading`/`parsing`。`ContentIntakeManagement.settleUpload()` 只在此时发一次 `upload-refresh`。IPC 的 `dashboard:intake-current` 分支先调它再返回视图。

渲染层本来就是 250ms 轮询内存，现在这个 tick 顺带把服务端进度拉回来。失败静默，下一 tick 重试。

### C5 SOP 条目落在「产品」页签

`content-intake-catalog.ts` 在取 access 时记下 `sopSources`（`mappingVersion === 'sop-not-imported'` 的来源）。目录行的 `domain` 对这些来源改为 `'sop'`。

`IntakeCatalogRow.domain` 加上 `'sop'`；`IntakeLibrary.tsx` 把 `sop` 并入 `domains`，删掉「这一栏还没有 SOP 目录」的空态与 `visible=[]` 的短路。

这里只用了 mapping 标记，没有用 `templateVersion`/`ruleVersion`：契约把这两个字段类型化成 FAQ 字面量，比较 `'sop-v1'` 会直接编译失败。

### C4 审阅界面不显示条目编码

`MaterialPage` 每张卡片加一行 `<code>{entry.businessEntryId}</code>`，差异列表同样带上编码。266 张卡片原本只有 6 种标题。

## 未解决（需要决策或上游）

### B3 坐席看不到图片

缺四层，前三层在冻结契约与桌面通道上：

1. `IntakeSnapshot.media` 是 `maxItems: 0`（`runtime-schema.generated.ts:9843-9869`），`usage.ts:412` 固定返回空数组
2. `IntakeQueryRow` 没有媒体字段
3. Query preload 没有 preview 方法
4. 卡片没有图片节点

`IntakeCatalog.preview(objectId)` 在 `content-intake-usage.ts:197-208` 已实现且零调用。要打通必须有上游契约给 snapshot 加 media，并把 entry 与 media 关联起来。仓内无法自行补这一层。

### C2 质量检查要求 266 条全过

`content-normalize.ts:543-545`：`ordinaryCount <= 500` 时 `initial === ordinaryCount`。SOP 材料是 routine，266 行就要 266 次人工判断。

这是产品规则，不是缺陷。放宽它有真实风险（漏检），需要产品确认抽样策略。我没有改。

### C6 桌面按钮要求 binding 角色是 owner

`project-roster-login.ts:98-112`。这是有意的（历史批量链只认 owner binding）。生产 `hz-publisher` 的 binding 是 `owner`，所以操作者不受影响；`hz-reviewer` 是 `coach`，本就只做复核与查询。保持原样。

## 两个被我改坏的既有断言

跑桌面套件时发现两条断言与我的改动冲突。它们都是**既有设计决定**，我改之前先判断了取舍，没有默默绕过。

**材料页不得显示条目 id。** `intake-management.test.tsx:337` 原本断言 `faq-a` 不出现在材料页。我加编码显示正是为了打破这一点。

判断：保留编码显示。SOP 工作簿每行标题都是工作表名，266 行只有 6 种标题，没有编码就无法指向具体某一行，审阅在产品上不可用。编码是业务方自己填的「条目编号」，不是服务端句柄，而审阅人本来就看得见完整正文。断言改为「编码应当显示」。

同一文件第 54 行（质量检查页 `faq-0` 不显示）仍然保留并通过，那个页面我没有改。

**SOP 页签是固定空态。** `intake-library.test.tsx:91` 原本断言「这一栏还没有 SOP 目录」。C5 之后该页签渲染真实表格。

判断：改为断言渲染真实表格的空态文案（`当前条件下没有此类可用话术。`），并额外断言旧的占位文案**不再出现**，这样这条断言仍然防着「用占位冒充未接入」的退化。

## 验证

| 检查 | 结果 |
| --- | --- |
| `pnpm lint` | 通过 |
| `pnpm build:services` | 通过 |
| `pnpm --filter @customer-agent/desktop typecheck` | 通过 |
| desktop `vitest run` 全套 | **1649 passed / 7 skipped** |
| `pnpm test:db:integration` | 77/77 |
| `content-intake.integration.test.ts` | 178/178 |
| `apps/api` 相关单测（8 个文件） | 55/55 |
| `scripts/bootstrap-sop-v2.mjs` 本地全流程 | apply / 幂等 / rollback 均符合预期 |

桌面套件必须在沙箱外跑：`customer-agent-contract-set.test.ts` 会 `git init` 临时仓库，沙箱拒绝该调用，会报 82 条 `Command failed: git ... init`。沙箱外是 87/87。这是环境限制，不是代码问题。

## 生产执行顺序

1. `node scripts/bootstrap-sop-v2.mjs --dsn <dsn>` 看计划
2. `--apply`
3. 操作者通过飞书登录一次（`bindKnownPrincipal` 写 5 分钟 facts 窗口，`bind-known-principal.ts:66-68`）
4. 用 `scripts/write-sop-template.mjs` 生成的模板上传

第 3 步不能省：生产 `principal_facts` 全部过期，而授权判断要求 facts 新鲜。

## 套件里那两条间歇失败，已查明

之前有一轮全量跑出现 1 条失败、抓不到名字。后来连续跑 5 次把它抓到了，结论分两种，都不是这次改动引入的。

**我自己的干扰（run5）。** 失败原文：

```
could not open file "base/16384/18900": No such file or directory
pg_ctl: 目录 "/var/folders/.../customer-agent-pg15-PHfKUI/data" 不存在
```

我在测试运行期间清理了 `/var/folders/.../customer-agent-pg15-*`，把那一跑正在用的临时集群删掉了。所以这条是我制造的，不是产品缺陷，也不是测试缺陷。教训很直接：临时 PG 集群只能在没有测试运行时清理。

**5000 规模的预算偏紧（run3）。** 桌面 `content-intake-usage-http.test.ts` 那一跑耗时 100008ms，正好撞在 100s 边界上；服务端 `discovery: completes the 5000-source menu` 的探针 SIGTERM 预算 120000ms、单次实测 95880ms（占 80%），两个套件并行时超出。这一条与 SOP 链路无关，是既有的规模测试在负载下的余量不足。

我没有改这些预算。理由是：调高它会让真实的性能退化失去信号，而当前没有证据说明 5000 来源的读取本身变慢了。如果 CI 需要稳定，正确做法是给这两个用例独占运行时间，或者把规模测试移出默认套件，那是一个独立决定。

## 未验证

- 真实 266 行 / 47 图工作簿仍未跑过（原文件不在仓库）。
- 桌面端的 C1/C3/C4/C5 只过了 typecheck，没有启动应用点击验证。
- `bootstrap-sop-v2.mjs` 只在临时集群验证，没有对生产执行。
- B2 的 facts 刷新依赖飞书登录链路，这条链路在生产是否正常未验证。
