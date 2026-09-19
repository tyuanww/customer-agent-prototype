# P10：Linux overlay smoke 前安装 Electron 系统库

> **状态：** 实现中（`feat/p10-linux-e2e-deps`）。  
> **不包含：** Linux 实机 IME、签名、远端登录。

## 拍板

Ubuntu job 在 xvfb smoke 之前跑 `playwright install-deps`，并保留 `xvfb`。否则 Electron 常因缺 libnss3 / libgbm 起不来。
