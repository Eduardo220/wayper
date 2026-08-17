import { defineConfig, globalIgnores } from 'eslint/config';
import expoConfig from 'eslint-config-expo/flat.js';
import globals from 'globals';

export default defineConfig([
  globalIgnores([
    '.expo/**',
    'android/.gradle/**',
    'android/app/build/**',
    'android/build/**',
    'build/**',
    'coverage/**',
    'dist/**',
    'graphify-out/**',
    'node_modules/**',
    'web-build/**',
  ]),
  expoConfig,
  {
    files: ['scripts/**/*.{cjs,js,mjs}', 'plugins/**/*.{cjs,js,mjs}'],
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    files: ['**/__tests__/**/*.{js,jsx}', '**/*.{test,spec}.{js,jsx}'],
    languageOptions: {
      globals: globals.jest,
    },
  },
  {
    rules: {
      // Existing findings are tracked in docs/ai/static-analysis.md.
      'import/export': 'warn',
      'no-constant-binary-expression': 'warn',
      'no-constant-condition': 'warn',
      'no-func-assign': 'error',
      'no-loss-of-precision': 'error',
      'no-self-assign': 'error',
      'no-unreachable': 'error',
      'react-hooks/rules-of-hooks': 'warn',
    },
  },
]);
