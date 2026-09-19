# P7：有 API origin 时运行时读取不回落 leftover

> **状态：** 已实现（`feat/p7-runtime-no-unkeyed`）。  
> **不包含：** 删 leftover 文件、改 leftover `/v1/search` 关闭策略、多公司 PG。

## 拍板

1. `runtimeStackReadPath`：origin 已设时只走显式 env 或带后缀路径，不读未带后缀 leftover。
2. origin 未设时仍可用 leftover，供本机仪表盘 / CLI。
3. 话术库、dense catalog 默认路径、telemetry 默认路径都走这个函数。
