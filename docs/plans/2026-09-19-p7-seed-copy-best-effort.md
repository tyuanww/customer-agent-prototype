# P7：origin-keyed 种子拷贝失败不阻断启动

> **状态：** 已实现（`feat/p7-seed-copy-best-effort`）。  
> **不包含：** 改 leftover 回落策略、包内索引、多公司 PG。

## 拍板

1. `seedOriginKeyedStackFile` 在 keyed 文件不存在且 unkeyed 存在时仍拷一次。
2. `mkdirSync` / `copyFileSync` 失败只跳过这次种子，仍返回 keyed 路径。
3. 登录 persist 继续往 keyed 路径写。打包启动不得因拷贝失败退出。
