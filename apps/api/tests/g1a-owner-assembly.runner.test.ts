import path from 'node:path';
import { expect, it } from 'vitest';
import { assembleG1aOwnerPackage } from './support/g1a-e0/assemble-package.js';

// Explicit operator-only entry; never participates in normal CI or opens PostgreSQL.
it.skipIf(process.env.CUSTOMER_AGENT_G1A_ASSEMBLE !== '1')('assemble an independently anchored external owner package', async () => {
  const required = (name: string): string => {
    const value = process.env[name];
    if (!value) throw new Error('G1A_ASSEMBLY_ENV_MISSING');
    return value;
  };
  let result;
  try {
    result = await assembleG1aOwnerPackage({ repositoryRoot: path.resolve(import.meta.dirname, '../../..'),
      inputRoot: required('CUSTOMER_AGENT_G1A_ASSEMBLY_INPUT'),
      outputParent: required('CUSTOMER_AGENT_G1A_ASSEMBLY_OUTPUT_PARENT'),
      expectedAssemblySha256: required('CUSTOMER_AGENT_G1A_ASSEMBLY_SHA256'),
      expectedOwnerAcceptanceSha256: required('CUSTOMER_AGENT_G1A_OWNER_ACCEPTANCE_SHA256'),
      expectedOwnerSubjectHash: required('CUSTOMER_AGENT_G1A_OWNER_SUBJECT_HASH') });
  } catch {
    // Test framework must never print input objects or parser snippets from an external package.
    throw new Error('G1A_ASSEMBLY_FAILED_CHECK_LOCAL_INPUT_AND_ANCHORS');
  }
  expect(result.expectedManifestSha256).toMatch(/^[0-9a-f]{64}$/);
  console.info(JSON.stringify({ status: 'ASSEMBLED_NOT_EVALUATED', ...result }));
});
