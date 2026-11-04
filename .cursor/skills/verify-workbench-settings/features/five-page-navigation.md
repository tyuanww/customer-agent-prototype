# Five-page navigation

## Sub-features

- 工作台 is the current authorized materials workspace in `faq-v2` and `product-remote`.
- 内容库 reads the current server catalog and has no 本机草稿 tab.
- SOP, 资料审核, and 设置 are the remaining entries.
- The old `content`, `permissions`, `announce`, and remote five-page destinations are absent.

## How to get to it (user POV)

Sign in, open the Dashboard, and inspect the left navigation. Open Settings and then return to each page.

## Driving it with Playwright

Run `tests/e2e/dashboard-handoff-real-stack.spec.ts`. The central assertions are:

```ts
await expect(dashboard.getByTestId('nav-overview')).toBeVisible();
await expect(dashboard.getByTestId('nav-wording')).toBeVisible();
await expect(dashboard.getByTestId('nav-sop')).toBeVisible();
await expect(dashboard.getByTestId('nav-materials')).toBeVisible();
await expect(dashboard.getByTestId('nav-settings')).toBeVisible();
await expect(dashboard.getByRole('tab', { name: '本机草稿', exact: true })).toHaveCount(0);
```

The final evidence is the navigation screenshot plus `data-active-module="wording"` after leaving and returning. A component render with mocked page state is not enough.

This journey passes against the real Electron, HTTP, and PostgreSQL stack. The host reserves an adjacent loopback port pair so the desktop profile can accept the synthetic origins without relaxing its production check.

## Gotchas

- The local `desk-knowledge.json` may still exist. Its presence is expected and is not a failure; the app must not read or write it.
- A seat may see fewer entries because job and permission visibility are part of the contract.
- Settings opens only when active grant or active account capability exists. Recovery copy in a closed grant does not make the entry reachable.
