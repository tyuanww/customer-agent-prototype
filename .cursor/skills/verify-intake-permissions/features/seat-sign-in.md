# Seat sign-in

A seat signs in and queries a shop with its own credentials.

**This journey cannot run today.** It is mapped so the gap is visible rather than rediscovered.

## Sub-features

- Exchange a password for a session code, then a binding.
- The seat's window opens signed in, with its post's actions.
- Query a shop the seat was granted.

## How to get to it (user POV)

The desktop login window offers 飞书登录 and a password form. A seat created in 权限 is meant to use
the password form.

## Driving it with verify-intake-permissions

Not driveable. The second step refuses:

```
POST /password  {username, password}  -> {code: bindingId}
POST /exchange  {code}                -> 401 {"error":"unknown_subject"}
```

`/exchange` admits only the bindings in `SYNTHETIC_IDENTITIES`
(`scripts/synthetic-stack/identity-provider.ts`), which is the four seeded
`synthetic_agent|coach|quality|owner`. A created seat's binding is `synthetic_<username>`, so it is
not admitted. This is stated as intended in `docs/reference-intake-pages.md`.

## End state

When this journey becomes runnable, the claim is: the seat's `/v1/auth/job` returns its post's
`actions`, and `/v1/intake/snapshot` returns the entries for a shop it was granted, with no entry
from a shop it was not.

## Gotchas

- The password endpoint and `/exchange` are different doors with different rules. A `200` from
  `/password` means the hash matched; it says nothing about admission.
- Do not add the created binding to the provider's allowlist to make this pass. That widens who may
  exchange a synthetic session, which is a security decision, not a test fixture.
- Until this runs, provisioning is proven only to the database. Say so when reporting.
