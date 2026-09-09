# TODOS

> **复核：** 2026-08-30。下列四项已逐条对照当前测试，仍是未覆盖的 P3 窄分支；它们属于 Menokin `PILOT-S0` 合成基线的验证债务，不构成 G0 / Ddev 或正式 DEV-M0 授权。

## Verification

### Cover the unavailable WindowContext branch

**What:** Add a handler-level test for `GET_WINDOW_CONTEXT` when the overlay controller is unavailable.

**Why:** Preserve the typed fail-closed response at the Main IPC boundary.

**Context:** The trusted and untrusted sender paths are covered in `apps/desktop/tests/unit/overlay-ipc-handlers.test.ts`; the controller-unavailable branch in `apps/desktop/src/main/overlay-ipc.ts` is the remaining narrow case.

**Effort:** S
**Priority:** P3
**Depends on:** None

### Cover a rejected renderer WindowContext request

**What:** Add a Query component test in which `getWindowContext()` rejects and the manual search interaction remains usable.

**Why:** Prove renderer startup degrades safely when the context request itself fails.

**Context:** Missing API and successful context responses are covered in `apps/desktop/tests/component/QueryApp.test.tsx`; this should remain a component-level error-path test rather than an Electron E2E.

**Effort:** S
**Priority:** P3
**Depends on:** None

### Cover simultaneous shortcut and error banners

**What:** Add a Query layout test for the shortcut warning and the `ERROR` result banner being visible together.

**Why:** Lock the shared banner measurement owner against future height-accounting drift.

**Context:** The equivalent `EMPTY` combination is covered in `apps/desktop/tests/component/QueryApp.test.tsx`; reuse that fixture with an error result instead of adding a browser test.

**Effort:** S
**Priority:** P3
**Depends on:** None

### Cover the test harness without a Fox window

**What:** Add a unit test for `attachTestHarness()` when no Fox `BrowserWindow` is present.

**Why:** Keep the optional E2E provenance helper fail-closed without expanding production behavior.

**Context:** The current Stage Manager Electron test covers tracing with a live Fox window. Exercise the absent-window branch directly in a fake Main-process fixture.

**Effort:** S
**Priority:** P3
**Depends on:** None

## Completed

### Login residual invalid banner

**What:** After a successful synthetic login, Query no longer reuses the red `invalidMessage` banner. Session notices distinguish unsigned, success, expired, and failed; restore and re-login paths are covered.

**Why:** Login success must not look like a validation error. Independent of D1–D5 closeout and of Windows packaging.

**Context:** Fixed in `codex/macos-m2-login-status` for the macOS synthetic query-experience slice. Not a Windows-device finding.

**Effort:** S
**Priority:** P3
**Depends on:** None
**Status:** DONE
