# 2026-08-17 批准构图派生 QA

本目录 5 张小图由 `scripts/generate-fox-head.mjs` 的 `writeApprovedFoxQa()` 从**已经在仓内的派生资产**缩小写出，只供人工对照构图，**不替代** raster canonical。

| 文件 | 边长 | 源 | 对照用途 |
| --- | --- | --- | --- |
| `float-64.png` | 64 | 共享透明 `fox-head.png` | Float / Query 狐狸视觉 |
| `dashboard-light-40.png` | 40 | 共享透明 `fox-head.png` | Dashboard 浅色 Logo |
| `dashboard-dark-40.png` | 40 | `src/renderer/assets/dashboard-fox-headset-dark.png` | Dashboard 深色耳麦变体 |
| `tray-20.png` | 20 | 共享透明 `fox-head.png` | Tray / 菜单栏 |
| `dock-20.png` | 20 | `assets/app-icon.png` | Dock / 任务栏（近白 squircle，不是透明狐狸） |

Canonical 仍是 `assets/fox-head-master.png`；运行时共享图是根目录 `fox-head.png`；App / Dock master 是 `assets/app-icon.png`。不要把这里的 20/40/64 预览检入为新的 SSOT，也不要用它们覆盖 master。

重新生成（不会改变许可结论，也不等于正式验收）：

```bash
pnpm generate:fox-head -- --qa
```
