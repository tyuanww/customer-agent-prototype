# 飞书登录后 ACK 403

> **状态：** 已实现。

## 拍板

1. 现场日志：`POST /v1/announce/ack 403 FORBIDDEN`，不是 304、不是隧道。
2. `client_sync_state.client_id=desk_5dd…` 已绑定 `usr_synthetic_agent`。飞书用户 `usr_ou_…` ACK 触发 `client_id belongs to another user`。
3. 冻结库函数不能改。announce 的 client_id 改为 `desk_` + sha256(installId, userId)。
4. ACK 403 FORBIDDEN 不得清掉 /current 已签发的租约；继续拉 snapshot，查询可走本地 hydrate。
5. drop('unavailable') 不覆盖 FORBIDDEN。
6. 「查询未完成」是 ERROR 壳。
