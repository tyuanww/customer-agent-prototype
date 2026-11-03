# Cross-window logout

## Sub-features

- Dashboard exposes logout from the account menu.
- Logout sends exactly one `/v1/auth/logout` request.
- The Dashboard returns to its signed-out state.
- Query loses the shared session and closes its filters.
- Renderer-facing APIs do not expose a token.

## How to get to it (user POV)

Sign in, open Dashboard, open the 账号信息 menu, choose 退出登录, then inspect Dashboard and Query.

## Driving it with Playwright

Run `tests/e2e/dashboard-handoff-real-stack.spec.ts`. It records the logout request count before the action, clicks the menu item, and asserts:

```text
Dashboard shows 未登录
/v1/auth/logout count increases by one
Query sessionStatus() reports signed out
Query filters are absent and the filter control is disabled
```

The signed-out screenshots in `.gstack/dashboard-handoff/<timestamp>/` are the visible evidence. The request count and session status are the durable evidence.

This journey passes against the real Electron, HTTP, and PostgreSQL stack.

## Gotchas

- Dashboard must not retain session tokens in a renderer object.
- Opening the menu is not proof of logout.
- A logout request alone is not proof that Query cleared its local state.
- Do not use a window focus event to manufacture the final signed-out state.
