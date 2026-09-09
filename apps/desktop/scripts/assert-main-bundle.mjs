import { readFileSync } from 'node:fs';
import path from 'node:path';

const WORKSPACE_BARE_IMPORT = /(?:from|import)\s*['"]@customer-agent\/[^'"]+['"]|require\(\s*['"]@customer-agent\/[^'"]+['"]\s*\)/;

export function mainBundleHasWorkspaceBareImport(source) {
  return WORKSPACE_BARE_IMPORT.test(source);
}

export function assertMainBundleHasNoWorkspaceBareImports(desktopRoot) {
  const mainPath = path.join(desktopRoot, 'out/main/index.js');
  const source = readFileSync(mainPath, 'utf8');
  if (mainBundleHasWorkspaceBareImport(source)) {
    throw new Error(
      `Desktop main bundle still imports @customer-agent/*: ${mainPath}. `
        + 'Windows smoke launches this file without nested workspace node_modules.',
    );
  }
}
