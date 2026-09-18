# 方案 C：产品自管账号 + 飞书 OAuth

> **状态：** 开工。取代方案 B（Logto）和 #129 合成口令补丁。  
> **不合并：** #129、#130。

## 拍板

两群人、两套认证、一套产品会话：

| 人 | 登录 | 谁核验 |
| --- | --- | --- |
| 企业飞书用户 | 选择器「飞书」→ 系统浏览器 | 飞书 OAuth，产品只做 RP |
| 进不了飞书租户的人 | 选择器「账号」→ 本窗口令 | 产品自己的口令服务（哈希、一次性 code、锁定） |

产品 API 仍只：`createLoginRequest` → callback → `exchange` → 不透明会话。不改冻结契约加密码 REST。口令发生在 loopback 身份服务。`subject_bindings.provider` 飞书用户为 `feishu`，账号用户仍为 `synthetic`（冻结 CHECK 只有这两档；表示产品签发账号，不是「假登录」）。

飞书 App Secret 在 API 进程，回调 `https://…/v1/auth/callback` 经隧道转到 `127.0.0.1:43100`。账号不走隧道。

## 明确不做

- 不把 Logto 当正路
- 不用 `synthetic_` 前缀猜飞书 code
- 不把明文 `synthetic-password` 当外包生产口令（种子账号也改哈希）
- 不放宽 API 非 loopback
- 登录 UI 不写内部/外包
