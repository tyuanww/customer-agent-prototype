# Menokin 客服试点 · S0 合成验证实施计划

> **状态续记（2026-08-31）：** 本页作为 S0 获批输入保留原貌；之后 `DEC-DDEV-01=PASS` 与产品仓开工授权已进入 `DEV-M0`。当前正式实施状态见 [`2026-08-31-dev-m0-execution.md`](2026-08-31-dev-m0-execution.md)，本页“不代表 Ddev”仍表示 S0 计划本身不能替代正式授权。

> **状态：** `APPROVED · PILOT-S0 · SYNTHETIC`
> **决定来源：** 项目记录仓 `DEC-054 / DEC-055`
> **批准日 / 生效日：** 2026-08-30 / 2026-08-31
> **复核日：** 2026-09-30
> **费用：** 新增付费 0
> **实施者：** 单人 FDE
> **不代表：** G0、Ddev、正式 `DEV-M0`、真实数据接入、部署、外发或上线授权

## 1. 目标

Menokin 是当前唯一客服试点。本阶段继续完善现有 Fox → Query → Top 3 → 人工复制与合成 Dashboard，用于交互验证、工程基线和后续正式产品切片设计。它是同一 Menokin 试点的 S0 阶段，不建立第二个 Demo 项目，也不激活已接收但保持 `VERIFIED_NOT_ACTIVATED` 的正式合同。

## 2. 允许范围

- `src/renderer/` 内的 UI、交互、可访问性、ViewModel 与纯合成视觉状态；
- `src/shared/` 内不产生 I/O 的类型、validator、状态模型、几何和纯函数；
- 现有窄白名单边界内的 Fox / Query preload 适配与 Main 原生桌面行为；不得扩成通用 IPC；
- 编译期、深冻结、完全虚构的 fixture / manifest；
- unit、component、Electron E2E、构建、workspace hygiene、开发诊断与文档；
- 不计正式通过的 Windows 构建 / 启动可行性 smoke；
- 现有“已复制”本地能力和本地推送演练，但不得把复制或演练写成发送、采纳、正确或已解决。

## 3. 失败关闭的红线

出现以下任一项，当前切片立即停止并转项目记录仓走正式 G0 / Ddev 或专项授权：

- Menokin 真实飞书文档、账号运行接入、OAuth、token、URL、客户数据或公司话术正文；
- 正式 Application API、worker、migration、PostgreSQL、对象存储、网络 provider 或生产配置；
- 外部模型、向量库、Embedding、付费 API、采购或新增云资源；
- 遥测 / 分析 SDK、后台采集、窗口标题 / 进程监听、全局鼠标追踪或用户行为上传；
- 自动发送、自动学习、自动发布、真实工单写回或任何绕过人工确认的能力；
- 部署、外发安装包、签名 / 公证、生产承诺或将合成结果包装为真实试点证据；
- renderer 直连 Electron / Node / 文件系统 / 网络，通用 `send/on/invoke` 或任意 channel / bounds 能力。

## 4. 单人纵向切片流程

每个 S0 任务只需要一张短卡，不重复正式十四责任包。开工前写清：

1. 用户可见目标与一个明确不做项；
2. 写入所有者和涉及模块；
3. 必须保持的不变量与失败路径；
4. 最小接口，优先复用现有深模块；
5. 窄测试与完成时的完整验证命令。

中等以上结构改动仍比较至少两个模块边界方案。实现完整纵向切片，不留伪按钮、未接线状态、重复真源或静默 fallback。发现任务触碰第 3 节任一红线时，不自行扩大范围。

## 5. 默认验证路由

先跑受影响模块的窄测试，再按影响面扩展：

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

- Float / handoff / 原生窗行为追加 `pnpm test:float` 与相关 Electron E2E；
- 品牌资产追加 `pnpm test:assets`；
- Dashboard 追加对应 component / E2E；
- 生成物、打包或目录调整追加 `pnpm workspace:check`；
- 默认不产正式安装包，不运行部署；Windows smoke、macOS 本地包与正式包分别报告，不互相冒充。

## 6. 证据与 Git 边界

- S0 完成只报告源码、测试、构建和实际启动证据；不回填为 G0 / Ddev、真实数据接入或生产验证。
- 合成 fixture 不引用 Menokin 企业工作簿内容，也不读取项目记录仓运行时状态。
- commit、push、创建 PR、merge、deploy 和分支删除继续分别授权；本计划不自动授权任何 Git 写出动作。
- 2026-09-30 复核继续、调整或结束本阶段；未复核不扩大权限，费用仍保持 0。

## 7. 当前开工结论

从 2026-08-31 起，符合本计划第 2 节且未触碰第 3 节的 S0 切片可以进入代码实现。正式 `DEV-M0` 仍等待项目记录仓完成 Menokin 试点证据重绑定、G0 / Scope、G0 签发与 `DEC-DDEV-01`。
