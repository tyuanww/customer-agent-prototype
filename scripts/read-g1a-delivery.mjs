import { readG1aDelivery } from '../apps/api/tests/support/g1a-e0/report-contract.ts';

try {
  if (process.argv.length !== 3) throw new Error('invalid arguments');
  const chunks = [];
  let bytes = 0;
  for await (const chunk of process.stdin) {
    bytes += chunk.length;
    if (bytes > 2 * 1024 * 1024) throw new Error('input too large');
    chunks.push(chunk);
  }
  const delivery = readG1aDelivery(Buffer.concat(chunks).toString('utf8'), process.argv[2]);
  process.stdout.write(`${JSON.stringify(delivery)}\n`);
} catch {
  // Untrusted process output must not enter diagnostics or exception text.
  process.stderr.write('G1A_DELIVERY_INVALID\n');
  process.exitCode = 1;
}
