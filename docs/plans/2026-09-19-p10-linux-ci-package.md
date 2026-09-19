# P10：CI 在 Ubuntu 上打 local-unsigned Linux 包

> **状态：** 实现中（`feat/p10-linux-ci-package`）。  
> **不包含：** GitHub Release、签名、把 CI 绿写成远端登录已验。

## 拍板

1. `linux-feasibility` job 在 `ubuntu-latest` 跑 `pnpm package:linux`。
2. 进 CI gate，与 windows-feasibility 并列。
3. 不上传正式 Release。证据边界写明：不是会话 / IME / 签名 / Pilot。
