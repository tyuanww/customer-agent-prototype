# Observability report

`report.ts` builds the API observability module and rebuilds the synthetic JSON and Markdown report. The API, desktop, and their tests import observability types and parsers directly from `@customer-agent/unified-contracts`.

```bash
node scripts/observability/report.ts
node scripts/observability/report.ts --check
node --test scripts/observability/report.test.ts
```

The report uses synthetic fixtures only. Its latency values exercise percentile and budget logic. They are not a runtime benchmark or production telemetry.
