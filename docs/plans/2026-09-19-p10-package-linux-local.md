# P10：Linux local-unsigned 打包脚本

> **状态：** 实现中（`feat/p10-package-linux-local`）。  
> **不包含：** 在 macOS 上打出 Linux 包、签名分发、包内 PG、Linux 实机勾选。

## 拍板

1. `pnpm package:linux` 只接受 `local`，必须在 Linux 上执行。
2. 产物目录 `release/local-unsigned/linux/`，文件名含 `UNSIGNED`。
3. extraResources 仍只有离线 profile / 图标 / 许可，不含 postgres。
4. 本刀不在本机跑 electron-builder --linux。
