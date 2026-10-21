# Search door latency, trunk against head

Measured with `apps/api/scripts/probe-search-latency.mjs`, which drives the public
`POST /v1/search` surface only, so the same script runs on both sides.

Both sides were built and probed on this machine against a disposable PostgreSQL 15 cluster
started by the probe itself. Runs were interleaved trunk, head, trunk, head, trunk, head with
20 samples per door, so a machine-level slowdown cannot land on one side only.

| Round | Trunk allowed median | Head allowed median | Trunk denied median | Head denied median |
| --- | --- | --- | --- | --- |
| 1 | 3 ms | 3 ms | 3 ms (status 200) | 1 ms (status 403) |
| 2 | 2 ms | 3 ms | 2 ms (status 200) | 1 ms (status 403) |
| 3 | 3 ms | 6 ms | 3 ms (status 200) | 1 ms (status 403) |

Trunk at `e5d56674`, head at the commit that added this file.

## The plan's three rules

- **Head median must not exceed the trunk median by more than 50 ms.** Trunk medians 2–3 ms,
  head medians 3–6 ms. Worst observed difference is 3 ms.
- **The denial call must stay under 300 ms.** Head denial median is 1 ms in every round.
- **The capsule must show its sentence.** Not measurable here; proven by the six lanes in
  `apps/desktop/tests/e2e/content-intake-search-lanes-real-stack.spec.ts` with screenshots.

## What the status codes already show

The denied lane is the same stranger session with no principal in both columns. On trunk it
returns 200 because no gate exists; on head it returns 403. That is the regression lane's
evidence in one line: trunk serves hits, head refuses, and the refusal costs about 1 ms.

## Reproducing

```
cd apps/api && PROBE_LABEL=head node scripts/probe-search-latency.mjs
```

The probe prints one JSON line per run with each door's status set, median, min and max. A
sample whose status differs from the rest is never averaged in silently: the status set is
printed, so an accepted request cannot be reported as a refusal latency.
