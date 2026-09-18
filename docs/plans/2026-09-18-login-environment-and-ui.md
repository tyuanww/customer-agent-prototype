# 登录环境与登录窗 UI（2026-09-18）

> **状态：** 规格已拍板；本切片已在 `feat/login-system-browser` 落地（仍 `AUTH_MODE=mock`），走 `/ship` PR。  
> **拍板：** 环境先定规格、不开 `AUTH_MODE=feishu` 启动门；UI 保留 520×420 选择器，飞书改系统浏览器。  
> **相关：** [登录与身份设计](2026-09-17-login-identity-design.md)、`DESIGN.md` 窗口 4、`TODOS.md` P4。

## 已拍板

### 环境

- 运行期继续 `AUTH_MODE=mock`、双 loopback。点飞书仍打本机 `/authorize`，直到有飞书应用 `APP_ID` / `SECRET`、https 回调（`/v1/auth/callback`）和独立安全评审。
- **禁止**在仍用合成 provider 时把会话标成 `feishu`。
- 契约 `AuthMode` 只有 `mock | feishu`。账号密码没有契约位；UI 可留「账号」段，正式环境不能假装已有密码 API。
- 产品 token 仍是服务端不透明会话。飞书 token 不得进 renderer、不得进 `product-session.enc`。
- 回调继续落在服务端 `/v1/auth/callback`。桌面不收 redirect、不起 loopback OAuth 监听。

### UI

- 登录窗仍是 `520×420` 原生标题栏，标题「登录」，分段只有 **飞书 / 账号**。
- 本窗只放选择器和账号表单。**不在窗里加载飞书官方页**（RFC 8252 §8.12）。
- 点「飞书登录」：校验 `authorize_url` 后再 `shell.openExternal`。文案：「将用浏览器打开飞书登录」。
- 账号表单仍在本窗：管理员下发口令；失败「账号或密码不正确」；找回「联系管理员」。
- 关窗 / Esc = 取消。成功以 `exchange` 拿到产品会话为准，不看浏览器是否还开着。
- 选择器窗继续独立非持久 session；系统浏览器是用户自己的浏览器会话，登录窗不得读它的 cookie。

## 本切片落地（mock，未开 feishu 门）

1. `LoginApp` 飞书文案改为浏览器打开；打开后选择器进入等待态。
2. `product-login-window`：chooser 不再进入 provider 导航；飞书 `allowedLoginUrl` 后 `openExternal`；账号 `POST /password` 后由 main GET callback。
3. 删除 `isFeishuPage` / `phase=provider` 窗内飞书放行。
4. Playwright `DEMO_E2E` 用 fetch 跟随合成 `/authorize` 的 302，不依赖 CI 上的系统浏览器。
5. 明确不做：打开 feishu 启动门、放宽 loopback、改契约加密码 API、改胶囊几何。
