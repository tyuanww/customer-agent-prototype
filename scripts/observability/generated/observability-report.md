# Observability mechanism report

Synthetic fixtures exercise the observability mechanism. This is not production telemetry or a runtime latency measurement.

Observed at: 2026-11-05T00:00:00.000Z

## Latency fixtures

| Surface | Temperature | Samples | Errors | p50 ms | p95 ms | p99 ms | Limiter |
| --- | --- | ---: | ---: | ---: | ---: | ---: | --- |
| dashboard-acceptance | cold | 20 | 0 | 332 | 346 | 348 | synthetic-fixture-v1 |
| dashboard-acceptance | warm | 200 | 1 | 256 | 288 | 315 | synthetic-fixture-v1 |
| ordinary-query | cold | 20 | 0 | 538 | 565 | 568 | synthetic-fixture-v1 |
| ordinary-query | warm | 200 | 2 | 392 | 538 | 582 | synthetic-fixture-v1 |
| overlay-dispatch | cold | 20 | 0 | 46 | 53 | 54 | synthetic-fixture-v1 |
| overlay-dispatch | warm | 200 | 0 | 30 | 40 | 41 | synthetic-fixture-v1 |
| sop-query | cold | 20 | 1 | 245 | 265 | 265 | synthetic-fixture-v1 |
| sop-query | warm | 200 | 0 | 195 | 225 | 245 | synthetic-fixture-v1 |

## Trace status

Ordinary: complete=216, incomplete=1, cancelled=1, failed=2, stale=0, unknown=0

SOP: complete=216, incomplete=2, cancelled=1, failed=1, stale=0, unknown=0

## Evaluations

Ordinary: dataset=ordinary-synthetic-obs-v1, version=1, samples=200, recall@3=0.926

SOP: dataset=sop-synthetic-obs-v1, version=1, samples=200, matched=190, valid-paths=185

## Alerts

- budget_breach
- budget_breach
- budget_breach
- budget_breach
- budget_breach
- unknown_operation
- dead_letter_growth
- stale_release
- release_index_failure
