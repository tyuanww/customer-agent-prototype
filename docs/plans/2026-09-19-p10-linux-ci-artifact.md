# P10：CI 上传 UNSIGNED Linux 包（不是 Release）

> **状态：** 已实现（`feat/p10-linux-ci-artifact`）。  
> **不包含：** GitHub Release、签名、把 artifact 当成正式外发。

## 拍板

1. `linux-feasibility` 在 `package:linux` 之后 `actions/upload-artifact`，路径只匹配 `*UNSIGNED*.AppImage`。
2. 缺文件 fail-closed。保留 7 天。
3. job 级 `actions: write`，工作流仍 `contents: read`。
4. 不是 Release。
