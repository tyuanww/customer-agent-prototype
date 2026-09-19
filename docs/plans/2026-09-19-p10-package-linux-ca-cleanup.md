# P10：Linux 打包失败必须清掉临时 CA

> **状态：** 实现中（`feat/p10-package-linux-ca-cleanup`）。  
> **不包含：** 在 macOS 上打 Linux 包、Linux 实机勾选。

## 拍板

`packageLinux` 与 Windows 相同：任一步失败都要 `systemCa.cleanup()`。主 bundle 仍含 workspace 裸 import 时不得 `resetOutput`。
