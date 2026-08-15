# 客服 Agent Demo 开发约束

请用中文汇报执行结果，代码标识符可使用英文。

## 任务定位

这是独立的本地原型仓，不是正式产品仓，也不是 `DEV-M0` 的开始。原型用于验证坐席的“狐狸头浮窗 → 搜索 → Top 3 → 人工选择 → 复制”主链、玻璃浮窗视觉，以及一个演示级 Dashboard（静态合成架构模拟，非正式 BI / 后端）。

不得修改正式立项与设计文档仓。该仓只可作为只读需求参考，本 Demo 必须保持独立工作区和独立 Git 历史。

## 工程约束

- Node.js 24.x；包管理器使用 pnpm，并提交 `pnpm-lock.yaml`。
- Electron + React + TypeScript；renderer 不得获得 Node.js 权限。
- Electron 必须设置 `contextIsolation: true`、`sandbox: true`、`nodeIntegration: false`。
- renderer 只能通过白名单 preload API 请求复制到剪贴板；不要暴露通用 IPC 或文件系统能力。
- 只使用合成话术 fixture，不读取真实飞书、客户数据、凭证、URL 或 token。用户显式提供的 VOC Excel 只允许一次性只读提取结构与聚合来校准 Demo；不得把原文、订单、图片、批次、员工、快递或竞品评价写进仓，运行时也不得读取该文件。
- 不接 PostgreSQL、OAuth、外部模型、线上 API、埋点平台或自动学习。
- 不实现自动发送；复制成功文案只能表示“已复制”，不能暗示已发送、已采纳或回答正确。
- 默认不做 commit、push、远端仓库或部署。只有用户对当前变更明确授权后，才可执行对应的 Git 操作；提交、推送和部署必须分别授权。

## 执行纪律

1. 先完整阅读 `DESIGN.md` 与 `DEVELOPMENT_BRIEF.md`。
2. 实现完整可运行的纵向切片，不留伪按钮或静默失败。
3. 安装依赖并实际运行 lint、typecheck、unit/component test、build；能稳定运行时再补 Electron smoke test。
4. 若某项受环境阻塞，保留实现并明确给出阻塞证据，不要宣称通过。
5. 最终汇报：实现内容、文件清单、实跑命令及结果、已知限制、如何启动 Demo。
