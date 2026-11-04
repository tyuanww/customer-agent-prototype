# Workbench and Settings feature map

Run `verify-workbench-settings` first. This map assumes its launch, doctor, drive, evidence, and cleanup rules.

| Feature | What it proves | Provable today |
| --- | --- | --- |
| [Five-page navigation](five-page-navigation.md) | The workbench has exactly the five current entries and no local draft or legacy remote page | Yes, real Electron + HTTP + PG15 |
| [Settings permissions](settings-permissions.md) | An operator previews, saves, observes, and revokes a permission under the Settings navigation | Yes, including the query-only denied control |
| [Settings accounts](settings-accounts.md) | A review-only administrator lists, creates, resets, and disables accounts without receiving grant controls | Yes, real Electron + HTTP + PG15 |
| [Cross-window logout](cross-window-logout.md) | Dashboard logout revokes the shared session and clears Query state | Yes, real Electron + HTTP + PG15 |

The permissions journeys include the denied-reader control. Do not report the operator journey as authorized proof without running that control.
