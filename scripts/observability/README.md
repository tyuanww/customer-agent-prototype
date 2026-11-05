# Observability report

`report.ts` builds the API observability module, validates the generated type snapshots, and rebuilds the synthetic JSON and Markdown report.

```bash
node scripts/observability/report.ts
node scripts/observability/report.ts --check
node --test scripts/observability/report.test.ts
node scripts/observability/sync-contract-types.ts --check
```

The report uses synthetic fixtures only. Its latency values exercise percentile and budget logic. They are not a runtime benchmark or production telemetry.
