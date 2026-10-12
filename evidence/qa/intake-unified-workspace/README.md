# FAQ 统一工作台合成验收（2026-10-08）

基线：产品 `e25d528e7a611fb977901b6fd9b53f0b0335f549`，分支 `codex/intake-organization`；版本保持 0.3.26。消费合同仍为 OpenAPI 1.21.0/schema.v1.23，0033 及此前 migration、角色上限均未改变。治理工作区保持 `830e1c826b2ee479146ccd23d7437e634b4b6be8`，原 Desktop 工作区未修改。最终被测文件指纹见 `source-files.json`，命令与环境见 `checks.json`，日志字节指纹见 `logs.json`。

## 本轮交付

五模块复用原工作台外壳，默认内容管理。内容管理与权限配置跨导航保持挂载，来源确认和发布输入、原生确认等待、未保存权限预览不丢失。上传来源展示登记范围给出的所属域，不猜文件名或岗位。

话术库使用独立 Main `ContentIntakeCatalog`，每个工作台窗口持有独立 usage 和选择；current/command 为窄 Dashboard 主 frame IPC，销毁时释放。完整分页后，按同一次资格的唯一 source→domain 映射分到产品/活动/售前/售后四个 Tab。目录表示当前店铺、商品和场景条件下的可用内容，无条件维度只读通用资料，不是全库清单；无复制、下架或导出能力，不向 renderer 投影 token/资格/copy key/URL。

系统同步与话术库共用一份当前读取结果，仅展示可用发布版本与截止，不表示已读、同步完成或四库变更量。概览只有真实导航入口，统计、SOP 和软件更新明确未接入。旧公告、话术、内容和 ops 适配器在 FAQ profile 内仍关闭。

关键拒绝路径：无 query 权限、重复来源、分页失败、超过 5000 行/2 MiB 展示预算均整组拒绝；不部分展示。正文与名称各自到期，名称失效回退编号，正文失效清空；停止、换条件、退出、重登录和窗口销毁挡住迟到结果。主动命令不发失效事件，失败保留可见原因并恢复操作状态。

## 验证范围和结果

- 根 `pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm build` 实际退出 0；本轮不是使用历史复合结果代替根测试。根测试包含 contracts 24、retrieval 9、intake 56、database 36、API 562、desktop 1368 个通过用例及根脚本检查。PG 环境门等跳过：database 21、API 319、desktop 7，不计为通过；其中本轮实际 PG 纵向证据见下项。
- 原四项实际 Electron/HTTP/PG15（正式用途池）通过：上传/报告保存回读/整批更正/修订/取消/来源/人工质量/原生取消及确认直发/另一坐席系统剪贴板，纠正回退，具名权限预览取消/保存/撤销，重名店铺选择。新增跨导航输入与权限预览保留断言也通过，见 `electron.log` 中前四项。
- 新四域实际 Electron/HTTP/PG15 通过：受限业务池发布真实合成产物，另一普通坐席在工作台四域 Tab 读取原文及相同 release，其他域为空；Query 与 Dashboard 刷新隔离；撤权后新读取及旧查询复制均拒绝。断言没有旧 content/announce/iteration/metrics/sop/software 请求、审批事实为 0。最终图形结果见 `electron-workspace-appearance.log`。
- 新目录 Main/IPC、原 usage/Query/上传专项 6 文件 82 项通过；renderer 首轮 6 文件 89 项通过，新增真实 Main＋renderer LIMIT/UNAVAILABLE 组合后相关目录/外壳 13 项通过。这些由分工 Agent 实跑，本次根 test 再覆盖全部最终源码，最终结论以归档根日志为准。
- 980×680 光暗主题及横向溢出核对；截图保存在 ignored `.gstack/intake-workspace/`，具体路径和 SHA 见 `artifacts.json`。图形仅为自动化合成桌面，没有把受控原生弹窗响应写成人工点击、Windows 或安装包验收。

首轮 8 项命令是 **4 PASS + 4 FAIL**，原始日志保留。四个新增用例最初在打开 Dashboard 前取得 Query key，而打开 Dashboard 会按原 overlay 生命周期收起 Query 并取消旧结果，故后续 copy 正确拒绝。测试改为 Dashboard 打开且 Query parked 后签发并先实际 copy，随后刷新目录/切换页面，再验证同一 key 可复制；产品撤销行为未修改。修正后四域 4/4 PASS，见 `electron-workspace-final.log`。视觉复核发现初始截图处于主题过渡中，追加等待实际控件背景和字色稳定后重新跑四域并截图，未改变产品样式或放宽断言。最终 8 个场景由未变的原四项通过记录与最终新四项组合覆盖，不声称最初整条命令一次全绿。

## 审查与文档

并行工程边界比较选择“共用外壳＋独立只读目录”，不复用含旧字段/授权默认值的适配器。独立本机复核覆盖本次新增 owner、scope 投影、IPC、preload、生命周期、renderer 和测试；发现的 WIP 重复来源映射、busy 回包和失效事件语义已修复并有回归，没有剩余必须改代码问题。没有重做用户已交接的 15/15 角色审核。完整外部 `/review` 继续 **INCOMPLETE**，无新增外部结论；本轮本机审查不能替代它。

更新 AGENTS 窄能力清单、DESIGN、DEVELOPMENT_BRIEF、架构、开发/验收指南、当前计划 §0.53 和原 TODO 的完成/剩余条件，不增加新的业务 TODO。桌面单文件 HTML 图同步实际模块行为，文件在仓外，不进入运行产品。

## 保留的限制

真实店铺/资料来源/确认负责人和旧目录认领未到位；真实飞书认证观察/刷新、生产受限账号/密钥/容量及运行装配未启用；历史保留期未批准，不删历史。办公 Windows、普通账号、非开发维护者修错/编号演练、整机断网、人工系统窗、安装包/签名仍未完成。runtime/Ddev false，VERIFIED_NOT_ACTIVATED 保持。

工作区根规则与源码体积预算分开记录：已有 32 MiB 源码预算失败仍保留，未删除历史合同/证据或上调阈值。当前实际输出见 `workspace.log` 和 `checks.json`。日志为原始字节，不为差异空白检查重写；代码/文档的差异检查排除 `.log`。本轮仅本地 commit，无 push/PR/合并/部署。
