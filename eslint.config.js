import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: [
      '**/out/**',
      '**/dist/**',
      'release/**',
      '**/coverage/**',
      '**/playwright-report/**',
      '**/test-results/**',
      '**/node_modules/**',
      'packages/contracts/src/generated/**',
      'packages/database/src/generated/**',
      '.codegraph/**',
      '.gstack/**',
      '**/experiments/**/.generated/**',
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx,js,mjs}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  {
    // Workbench pages and the login window use antd controls only (DESIGN.md §3). Native
    // controls stay legal in the window chrome, which owns drag, collapse and the theme menu,
    // and in the legacy-profile modules that are pending removal (task card D4).
    files: [
      'apps/desktop/src/renderer/LoginApp.tsx',
      'apps/desktop/src/renderer/features/dashboard/*.tsx',
    ],
    ignores: [
      'apps/desktop/src/renderer/features/dashboard/DashboardThemeMenu.tsx',
      'apps/desktop/src/renderer/features/dashboard/AnnounceModule.tsx',
      'apps/desktop/src/renderer/features/dashboard/ContentModule.tsx',
      'apps/desktop/src/renderer/features/dashboard/IterationModule.tsx',
      'apps/desktop/src/renderer/features/dashboard/OverviewModule.tsx',
      'apps/desktop/src/renderer/features/dashboard/WordingLibraryModule.tsx',
    ],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "JSXOpeningElement[name.name=/^(button|select|textarea)$/]",
          message: 'Use the antd control here (DESIGN.md §3). Window chrome is the only exception.',
        },
        {
          selector: "JSXOpeningElement[name.name='input']:not(:has(JSXAttribute[name.name='type'][value.value='file']))",
          message: 'Use the antd Input here (DESIGN.md §3). A hidden file picker is the one native input allowed.',
        },
      ],
    },
  },
);
