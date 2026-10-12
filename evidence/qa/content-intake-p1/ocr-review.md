# P1 OCR 复审与修复记录

> 2026-10-04 · `open-code-review-delegate` · OCR v1.12.11。结论：本轮 P1 差异复审完成，已确认问题 1 项并修复，当前未修复发现 0。此结论限定本地合成模块，不授予生产、合同或发布权限。

用户追加授权：审核、修复，确认后 commit，再开始下一步。审核由宿主执行；OCR 只负责文件选择和规则解析，本轮没有调用外部 LLM 或子 agent。上一轮 `/review` 未收敛记录保留为历史，不能改写为其外部审查全部通过。

## 范围与覆盖

- workspace 模式，基线 `8ab309fcd9c494b7343ed88bacb253205d36575f`，分支 `codex/content-intake-p1`。
- `total_files=30`、`reviewed_files=30`、`skipped_files=0`、`coverage_rate=100%`。这里的 total_files 是 OCR 可审列表；初始 Git 差异共 42 个文件，其中 12 个被 OCR 默认排除。
- [原始 preview](ocr-preview.txt) / [逐组规则](ocr-rules.txt)。清单身份为 `(path,status)`，下表绑定修后文件 SHA256。
- 额外检查 OCR 排除的两份测试、依赖锁、受影响架构/发布文档、运行配方、交付说明与计划当前 §0/§12。计划历史 autoplan 长记录仅复用既有结论，没有把历史全部重审计入覆盖率。
- 权限/候选、ZIP/Excel、子进程、构建与证据分别审阅；最后复核来源绑定修正及调用方，确认没有把 grant 的全来源权限误当候选范围。

## 已修复发现

```json
{
  "path": "apps/api/experiments/content-intake-p1/approval.ts",
  "content": "冻结候选没有约束 source.id 与 scope.source 一致。来源风险与确认按 source.id 判定，权限按 scope.source 判定，因而同一候选可携带两套来源。现已要求单个非空登记来源与权限范围完全一致；不同来源、null 全来源、空来源的三项回归均先红后绿。仅影响 P1 合成模型，生产路径未接入。",
  "start_line": 38,
  "end_line": 44,
  "category": "security",
  "severity": "high"
}
```

High：1 已修复；Critical / Medium / Low：无已确认发现。`comments=[]`，不存在待修的已确认阻断。修复收在候选所有者，接口及摘要格式未改变；错误沿用 `INVALID_MATERIAL`。普通来源、既有常规自审、关键他审及授权范围回归仍通过。

## 验证与复用

- 修复前：新增三个用例均失败（错误候选被接受），原有 31 项通过。
- 修复后：41 项解析/进程 + 34 项权限/审批，**75/75 PASS**。
- 权限规则有变化，重新运行 `pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm build`，全部退出 0。命令、摘要及原日志指纹见 [验证输出](ocr-validation.txt)。
- 解析源码、依赖与探针输入未变，复用 [probe.json](probe.json) 的实物、性能和取消结果；[verification.json](verification.json) 是上一轮历史绑定，其中审批源码与 API 测试的两个旧指纹已由本次清单及下方补充指纹取代，其余输入已复核一致。
- 条件 SKIP、既有全仓 audit 告警、真实飞书/PG/设备/OS 隔离未验证等限制保持；没有把新增的三项模型验证写成生产安全或完整 FAQ 验收。

## 修后逐文件清单

| path | status | rule group | disposition | SHA256 |
| --- | --- | --- | --- | --- |
| `package.json` | modified | 1 | reviewed | `89c15dd870721678541cbf45904f391f6425c972bfe82438c6f32b54fad21b5f` |
| `pnpm-workspace.yaml` | modified | 2 | reviewed | `e73d6796c65573f47469238478a68181ecc6a1458d65e279dd2788f716896f49` |
| `scripts/dev-help.mjs` | modified | 3 | reviewed | `3d448c83c026af7396eb487aef115cbecca49b2b3133eeb23d1c2eb29e1b0135` |
| `apps/api/experiments/content-intake-p1/approval.ts` | added | 3 | reviewed | `9753db9e3ff6bfd45ff36cb31a6870e2d7acce68cc73a9e8088395443ae6e0fc` |
| `apps/api/experiments/content-intake-p1/permissions.ts` | added | 3 | reviewed | `0c867063ac723c7a2218c5d5d2a061b801f75c9e262496324627b412fa2b8963` |
| `evidence/qa/content-intake-p1/contract-audit.json` | added | 4 | reviewed | `62c8efa4e36b5a2d6139c739a84c8d38a13efd722afbcd6ab7333d690725d374` |
| `evidence/qa/content-intake-p1/probe.json` | added | 4 | reviewed | `7a0075d43c1c0193746e7c99278e55ead3d64446a691afe2fd85053d5fe46e6d` |
| `evidence/qa/content-intake-p1/review-attempts.json` | added | 4 | reviewed | `a23af2e1b11eab52f86bdb87ba87c147cc2d3e7e15aae2b469aaf069e614bd00` |
| `evidence/qa/content-intake-p1/review-evidence/cycles-1-2.json` | added | 4 | reviewed | `11ad982a9867883f0034727ae156096fbfd17743f22e31b9caae95a2f6ad3176` |
| `evidence/qa/content-intake-p1/review-evidence/exploration-002.json` | added | 4 | reviewed | `301b5024bce620bfb0f97dd6f8dd6c72f858d9dd8423e760e7d2b94e414bad85` |
| `evidence/qa/content-intake-p1/review-evidence/exploration-003.json` | added | 4 | reviewed | `e185df639241f1a3d772324b9e749b7a8002c6e6dfdccd0ff09aca038da3364e` |
| `evidence/qa/content-intake-p1/review-evidence/exploration-004.json` | added | 4 | reviewed | `f64d3e5c795d118ea0f6c585fdbd9a8a0c7ee69a1d0dd60030c6a78456d67097` |
| `evidence/qa/content-intake-p1/review-evidence/exploration-005.json` | added | 4 | reviewed | `4bd4738862b86545459de5785627ef5a345bfaf455057f3bae483aa7bebd8793` |
| `evidence/qa/content-intake-p1/review-evidence/exploration-006.json` | added | 4 | reviewed | `0aaf99e777b8a0506a3313e979a84cc904df268a3f7d67ed60f8659f4e466271` |
| `evidence/qa/content-intake-p1/review-evidence/exploration-007.json` | added | 4 | reviewed | `56cb4d2304b1b3575a787424429d9c7d4a84dd09da442bca8745e688461df5f1` |
| `evidence/qa/content-intake-p1/review-evidence/exploration-008.json` | added | 4 | reviewed | `1ab4bdbc63d3b6d627dda0cd22609a65d78d3bc07aaa0e9d15f73f49c3126bdf` |
| `evidence/qa/content-intake-p1/review-evidence/exploration-009.json` | added | 4 | reviewed | `e2c216be1f926537cc0f1893982dd0a34507cc1821b3086d655bc75351f22359` |
| `evidence/qa/content-intake-p1/review-evidence/exploration-010.json` | added | 4 | reviewed | `903f67d59a96f08dd0811825d786ab6aff5b03c5bd5fe36a61f4676d32e44705` |
| `evidence/qa/content-intake-p1/review-evidence/final-regressions.json` | added | 4 | reviewed | `77e0c4373d7e19fdaddff6d1fdbcbd6307b13519b0ce1f740b886644080ecf31` |
| `evidence/qa/content-intake-p1/verification.json` | added | 4 | reviewed | `204d6347be86c81385a02e76319ec844207bbf698d857b0a1cde730e99ff2743` |
| `packages/content-intake/package.json` | added | 1 | reviewed | `35358c8a5c5d0406f91f07fa74d298139afdbc40ac746a125fe412389298320e` |
| `packages/content-intake/scripts/probe.mjs` | added | 3 | reviewed | `e328a5e5adb03d2946c3e11c6dd826a82e874c4b2d466ada5592549aa3982335` |
| `packages/content-intake/src/archive.ts` | added | 3 | reviewed | `9d477f89275892cc41fea14001d8269f95ee6322c312305085773e6935a6322f` |
| `packages/content-intake/src/parser-process.ts` | added | 3 | reviewed | `634c7f13a654134ed2c8f247377368c55e708201cab985e81d5d9f016239de4d` |
| `packages/content-intake/src/policy.ts` | added | 3 | reviewed | `175f2f09b56568dca50357dced250446e971ed103a7e8498e7709ecbf7ccd0b0` |
| `packages/content-intake/src/runner.ts` | added | 3 | reviewed | `683f80db3a581f4ab5374c38ef43f8fea8602bc9709b2121ae8b162d3e0e7ca4` |
| `packages/content-intake/src/workbook.ts` | added | 3 | reviewed | `2ca3b60e86294250f91d360e104c03ca1c77bb9c46be1597445d4a0e1de27505` |
| `packages/content-intake/tests/fixtures.ts` | added | 3 | reviewed | `c7b25b2b1bdce5511e02e31e3fd7075d8369c4ef53e351ac1a77f57f0ee8bb04` |
| `packages/content-intake/tsconfig.build.json` | added | 4 | reviewed | `89f7cffdd3fbb928b80acb12c5e601ef29fb608b43193065ce686dc231a93c08` |
| `packages/content-intake/tsconfig.json` | added | 4 | reviewed | `785087c1c77adb80248801ee4bf5ef477ebd0e90957a51cc6ac366a8fe996a39` |

额外测试指纹：

- `apps/api/tests/content-intake-p1.test.ts`：`fbceaf12d0bf6ed10d53f7928d171c89e4426741fbe67864f0d20507335bb7ad`
- `packages/content-intake/tests/workbook.test.ts`：`2abd79e98a73fd7db5cd90717a27e2f23ab1f87bb5e965f8b8695c3619e85c58`
