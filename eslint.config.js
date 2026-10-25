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
    files: [
      'apps/desktop/src/renderer/LoginApp.tsx',
      'apps/desktop/src/renderer/DashboardApp.tsx',
      'apps/desktop/src/renderer/features/dashboard/*.tsx',
    ],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "JSXOpeningElement[name.name=/^(button|select|textarea)$/]",
          message: 'Use the antd control here (DESIGN.md §3).',
        },
        {
          selector: "JSXOpeningElement[name.name='input']:not(:has(JSXAttribute[name.name='type'][value.value='file']):has(JSXAttribute[name.name='hidden']))",
          message: 'Use the antd Input here (DESIGN.md §3). A hidden file picker is the one native input allowed.',
        },
      ],
    },
  },
);
