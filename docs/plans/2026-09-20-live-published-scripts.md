# 查询前对齐当前发布 · Dashboard 话术库读同一份

> **状态：** 已实现（`feat/live-published-scripts`）。

## 拍板

1. 产品查询每次点查询都 `refreshAnnounce`，不能只在尚未持有租约时刷新（租约 600s 会让坐席用旧稿）。
2. Dashboard 话术库以 hydrate（当前发布）为准；本机 retrieval index 只在 hydrate 为空时回退。
3. VOC / 工单仍合成。安装包自动更新不做。
