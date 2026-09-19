# Overlay：Windows 收起后交还前台

> **状态：** 实现中（`feat/windows-yield-focus`）。  
> **不包含：** native addon、NSPanel、`app.focus({ steal: true })`、Windows 实机勾选。

## 拍板

1. macOS 仍用有条件 `app.hide()` + 34ms 后 `fox.showInactive()`。
2. Windows 没有 `app.hide()`。收起查询后若要交还前台：狐狸 `blur`、`hide` 一帧，再 `showInactive`，让千牛/编辑器先成为前台。
3. Dashboard / SOP / 登录仍可见时不交还（与 macOS 相同）。
4. 打开查询仍可用 `app.focus()` **不带 steal**。
5. 本刀不声称 Windows 实机已验。

## 明确不做

- 不引入 native `SetForegroundWindow`
- 不把闲置狐狸做成会抢键盘的置顶窗
