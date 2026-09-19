# P7：话术库与向量读取走 origin 路径

> **状态：** 实现中（`feat/p7-dashboard-origin-keyed`）。  
> **不包含：** 多公司 PG 分库。

## 拍板

1. 管理台话术库、dense catalog 在 env 未设时，按 `CUSTOMER_AGENT_DESKTOP_API_ORIGIN` 读带后缀文件。
2. 显式 `CUSTOMER_AGENT_*_INDEX` 仍优先。
3. 只读，不在列出话术时拷贝文件。
