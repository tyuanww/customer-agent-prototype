import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { beforeAll, describe, expect, it, vi } from 'vitest';

interface SystemCaDependencies {
  platform?: string;
  createTemporaryDirectory?: () => string;
  exportCertificates?: (certificatePath: string) => void;
  removeTemporaryDirectory?: (directory: string) => void;
}

type PrepareNodeSystemCaEnvironment = (
  baseEnvironment?: Record<string, string>,
  dependencies?: SystemCaDependencies,
) => {
  environment: Record<string, string>;
  cleanup: () => void;
};

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let prepareNodeSystemCaEnvironment: PrepareNodeSystemCaEnvironment;

beforeAll(async () => {
  const module = await import(
    pathToFileURL(path.join(root, 'scripts/node-system-ca.mjs')).href
  ) as { prepareNodeSystemCaEnvironment: PrepareNodeSystemCaEnvironment };
  prepareNodeSystemCaEnvironment = module.prepareNodeSystemCaEnvironment;
});

function testDependencies(platform = 'darwin') {
  return {
    platform,
    createTemporaryDirectory: vi.fn(() => '/tmp/customer-agent-system-ca-test'),
    exportCertificates: vi.fn(),
    removeTemporaryDirectory: vi.fn(),
  };
}

describe('Node system CA environment', () => {
  it('exports macOS roots, preserves the caller environment, and cleans up once', () => {
    const dependencies = testDependencies();
    const baseEnvironment = { CUSTOM_VALUE: 'preserved' };

    const prepared = prepareNodeSystemCaEnvironment(baseEnvironment, dependencies);

    const expectedCertificate = path.join(
      '/tmp/customer-agent-system-ca-test',
      'system-roots.pem',
    );
    expect(prepared.environment).not.toBe(baseEnvironment);
    expect(prepared.environment).toMatchObject({
      CUSTOM_VALUE: 'preserved',
      NODE_EXTRA_CA_CERTS: expectedCertificate,
    });
    expect(dependencies.exportCertificates).toHaveBeenCalledWith(expectedCertificate);

    prepared.cleanup();
    prepared.cleanup();
    expect(dependencies.removeTemporaryDirectory).toHaveBeenCalledOnce();
    expect(dependencies.removeTemporaryDirectory).toHaveBeenCalledWith(
      '/tmp/customer-agent-system-ca-test',
    );
  });

  it('respects an existing NODE_EXTRA_CA_CERTS without creating temporary state', () => {
    const dependencies = testDependencies();

    const prepared = prepareNodeSystemCaEnvironment(
      { NODE_EXTRA_CA_CERTS: '/approved/roots.pem' },
      dependencies,
    );

    expect(prepared.environment.NODE_EXTRA_CA_CERTS).toBe('/approved/roots.pem');
    expect(dependencies.createTemporaryDirectory).not.toHaveBeenCalled();
    expect(dependencies.exportCertificates).not.toHaveBeenCalled();
    prepared.cleanup();
    expect(dependencies.removeTemporaryDirectory).not.toHaveBeenCalled();
  });

  it('does nothing on non-macOS hosts', () => {
    const dependencies = testDependencies('win32');

    const prepared = prepareNodeSystemCaEnvironment({}, dependencies);

    expect(prepared.environment.NODE_EXTRA_CA_CERTS).toBeUndefined();
    expect(dependencies.createTemporaryDirectory).not.toHaveBeenCalled();
    expect(dependencies.exportCertificates).not.toHaveBeenCalled();
    prepared.cleanup();
    expect(dependencies.removeTemporaryDirectory).not.toHaveBeenCalled();
  });

  it('removes temporary state before rethrowing an export failure', () => {
    const dependencies = testDependencies();
    const exportError = new Error('security export failed');
    dependencies.exportCertificates.mockImplementation(() => {
      throw exportError;
    });

    expect(() => prepareNodeSystemCaEnvironment({}, dependencies)).toThrow(exportError);
    expect(dependencies.removeTemporaryDirectory).toHaveBeenCalledOnce();
    expect(dependencies.removeTemporaryDirectory).toHaveBeenCalledWith(
      '/tmp/customer-agent-system-ca-test',
    );
  });
});
