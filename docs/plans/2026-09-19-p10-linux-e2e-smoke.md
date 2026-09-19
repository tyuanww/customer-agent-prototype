# P10：Linux CI 打包后跑 overlay smoke

> **状态：** 实现中（`feat/p10-linux-e2e-smoke`）。  
> **不包含：** Linux 实机 IME、签名、远端登录勾选。

## 拍板

1. 同一条 overlay 透明/快捷键用例同时标 `@windows-feasibility` 与 `@linux-feasibility`。
2. Ubuntu job 在 `package:linux` 之后 `xvfb-run` 跑 Playwright。
3. 证据边界：hosted 启动与干净退出，不是 Pilot。
