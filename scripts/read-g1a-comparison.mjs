import { compareG1aDeliveries } from '../apps/api/tests/support/g1a-e0/comparison-contract.ts';
try {
  if (process.argv.length !== 4) throw new Error('arguments');
  const chunks = [];
  let bytes = 0;
  for await (const chunk of process.stdin) {
    bytes += chunk.length;
    if (bytes > 4 * 1024 * 1024) throw new Error('size');
    chunks.push(chunk);
  }
  const input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || Object.keys(input).sort().join(',') !== 'baseline,candidate,identity'
    || typeof input.baseline !== 'string' || typeof input.candidate !== 'string'
    || !input.identity || Object.keys(input.identity).sort().join(',') !== 'baseline_commit,candidate_commit') throw new Error('shape');
  process.stdout.write(JSON.stringify(compareG1aDeliveries(input.baseline, input.candidate, process.argv[2], input.identity, process.argv[3])) + '\n');
} catch {
  // Reject untrusted process output without echoing its content.
  process.stderr.write('G1A_COMPARISON_INVALID\n');
  process.exitCode = 1;
}
