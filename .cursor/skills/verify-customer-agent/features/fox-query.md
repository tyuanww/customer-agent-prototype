# Fox and Query

The Fox floater is the always-present entry point. Clicking it opens the Query capsule. A signed-in or fixture-backed operator can search, inspect up to three original-text candidates, copy one manually, close the capsule, and reopen it without leaking the previous session state.

## Sub-features

- `fox-idle`: shows a transparent 88 by 88 Fox window with no rectangular backing plate.
- `query-open`: opens a 600 by 88 Query capsule and focuses the question input.
- `query-search`: returns visible candidate cards from the configured fixture or synthetic stack.
- `query-copy`: writes the selected original text to the system clipboard and shows `已复制`, never `已发送`.
- `query-close`: collapses back to Fox and clears transient input/results as specified for the session.
- `query-reopen`: reopens in the correct input state without a stale close timer or state leak.

## How to get to it (user POV)

- Click the Fox floater.
- Press the configured global shortcut, when real OS key delivery is part of the approved scope.
- Type a question into `客户问题` and choose `查询` or press Enter.
- Choose a candidate or its number key, then use `复制话术`.
- Click the Fox inside the open capsule, press Escape, or use the close control.

## Driving it with verify-customer-agent

Preconditions:

- Run `pnpm build`.
- Use a new temporary `--user-data-dir`.
- For the fixture journey, let `smoke.spec.ts` own the launch and cleanup.
- For the real-stack journey, start an isolated synthetic stack before the spec.

- **Fixture happy path.** Run `pnpm --filter @customer-agent/desktop exec playwright test tests/e2e/smoke.spec.ts --grep "starts as a fox floater"`. PASS requires the Fox window, focused Query input, candidate cards, `已复制`, clipboard equal to the selected answer, no `已发送`, and return to Fox after copy.
- **Fixture open/close.** Run `pnpm --filter @customer-agent/desktop exec playwright test tests/e2e/smoke.spec.ts --grep "hands the fox and query windows off"`. PASS requires repeated and rapid toggles to keep Fox or Query visible, preserve focus, and avoid old close timers hiding a newer session.
- **Real synthetic stack.** Run `CUSTOMER_AGENT_STACK_ROOT="$VERIFY_ROOT/stack" node scripts/synthetic-stack/stack.ts start`, then `CUSTOMER_AGENT_STACK_ROOT="$VERIFY_ROOT/stack" pnpm --filter @customer-agent/desktop exec playwright test tests/e2e/synthetic-stack.spec.ts`. PASS requires synthetic login, the seeded shipping answer, copy to the system clipboard, logout, and no persisted session file.
- **Proof.** Preserve `.gstack/qa-reports/screenshots/fox-idle.png`, `overlay-results.png`, and `overlay-copied.png`. For the real stack, retain the Playwright transcript. Record the clipboard value and the session file absence.

## Gotchas

- Playwright click automation does not prove real macOS Stage Manager, Dock compositor, OS focus, or global shortcut delivery.
- A synthetic blur proves the product path only when the owned Electron instance is frontmost. Activate that instance first; otherwise the product correctly keeps Query open while another application owns focus.
- A copy result proves clipboard write only. It does not prove sending, adoption, correctness, or resolution.
- The real-stack spec requires an already running stack. Do not stop or destroy a stack this run did not create.
- Do not prove Query by calling renderer setters or the Main test harness when the claim is about clicking Fox or typing into the visible input.
