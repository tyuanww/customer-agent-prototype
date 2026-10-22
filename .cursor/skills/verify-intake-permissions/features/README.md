# Feature map

The journeys an operator, a seat, or an outside account actually walks through the intake
permission surface. Each file states the observable end state that proves the feature works, so a
green run means the claim holds rather than that a test executed.

Run `verify-intake-permissions` first; this map assumes its launch, doctor and cleanup sections.

| Feature | What it covers | Provable today |
| --- | --- | --- |
| [Permission page](permission-page.md) | An operator grants a named seat an action, then revokes it | Yes |
| [Seat provisioning](seat-provisioning.md) | Creating a seat writes the principal, facts and role rule its post names | Yes, to the database |
| [Seat sign-in](seat-sign-in.md) | A created seat signs in and queries a shop | No. The identity provider admits only the seeded bindings |
| [First projection](first-projection.md) | A brand-new Feishu account lands with the right state and sentence | Yes, at the API |

A journey that cannot run reports the reason. Do not weaken it into a passing shape; the reason
belongs in that file's Gotchas.
