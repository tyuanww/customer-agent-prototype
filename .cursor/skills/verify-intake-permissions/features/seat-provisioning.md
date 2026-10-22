# Seat provisioning

Creating a seat from the 权限 page writes the identity record, the intake principal, the facts
window, and the role rule its post names. Without the last two the account can never be granted,
because `authorization_deadline` joins `role_rules`.

## Sub-features

- List existing seats. Seats created here appear alongside the seeded ones.
- Create a seat: name, login name, password, and a post (客服 or 客服主管).
- Reset a seat's password.
- Disable a seat. It is marked unavailable; the rows stay.

## How to get to it (user POV)

Sign in as the owner, open the dashboard, 权限 tab, and use the 新建坐席 form under 已有外包坐席.

## Driving it with verify-intake-permissions

Through the dashboard bridge, which the page itself calls:

```
const reply = await dashboard.evaluate(({ }, intent) => window.customerAgent.dashboardSeats.command(intent),
  { action: 'create', displayName: '合成客服', username: 'seat_a', password: 'pw-123456', post: '客服' });
```

Then read the database for the rows the same action wrote:

```
select binding_id, role from backend_identity.subject_bindings where binding_id = 'synthetic_seat_a';
select person.principal_id, facts.job_id from content_intake.principals person
  join content_intake.principal_facts facts
    on facts.principal_id = person.principal_id and facts.facts_version = person.current_facts_version
 where person.principal_id = 'synthetic_seat_a';
select job_id, role from content_intake.role_rules where job_id in ('job-seat','job-seat-supervisor');
```

## End state

For 客服: binding role `agent`, principal job `job-seat`, role rule `agent`.
For 客服主管: binding role `coach`, principal job `job-seat-supervisor`, role rule `supervisor`.
No grant is written by the create form; which shops a seat reaches is granted on the permission page.

`apps/api/tests/seat-provisioning.integration.test.ts` asserts exactly these rows against a real
cluster, so this journey exists to prove the page reaches that same writer, not the writer itself.

## Gotchas

- The seat list used to filter on `role='agent'`, which hid every 客服主管 seat. If a supervisor seat
  is missing from the list but present in the database, that filter has regressed.
- A seat cannot sign in yet. See [seat sign-in](seat-sign-in.md); do not read the 401 as a
  provisioning failure.
- Creating a seat writes a password hash under the stack root, not the database. Reading the hash is
  not part of this journey.
