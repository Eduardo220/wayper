import { defineConfig, globalIgnores } from 'eslint/config';
import expoConfig from 'eslint-config-expo/flat.js';
import globals from 'globals';

const legacyModuleRestrictions = [
  {
    regex: '(^|/)(runService|zoneService|zonesStorage|xpService)(\\.js)?$',
    message:
      'Legacy compatibility module: use the current domain repository/service; migration exceptions belong in the architecture baseline.',
  },
];

const domainToUiRestrictions = [
  {
    regex: '^(?:\\.\\.?/)+(?:[^/]+/)*(screens|components|navigation)(/|$)',
    message: 'Domain/data code cannot depend on UI. Move orchestration to the screen/app boundary.',
  },
];

const uiOwnerRestrictions = [
  {
    regex:
      '(^|/)(activeRunState|activeRunLocationTask|expoLocation|pointFilters|runNotificationService)(\\.js)?$',
    message:
      'Use the public active-run/runtime service; state, task and native notification internals stay with RUN_RUNTIME.',
  },
  {
    regex: '^@turf/turf$',
    message: 'Use the existing tracking/territory geometry owner instead of duplicating Turf logic in UI.',
  },
];

const criticalRunRestrictions = [
  {
    regex: '^firebase/firestore$',
    message: 'Firestore is forbidden in the critical run path; minimum local save must remain offline.',
  },
  {
    regex: '(^|/)firebaseConfig(\\.js)?$',
    message: 'Pass local identity/state into RUN_RUNTIME; Firebase config is not a critical-run dependency.',
  },
];

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
    files: ['App.js', 'index.js', 'googleAuth.js', 'src/**/*.{js,jsx,mjs}'],
    ignores: ['src/**/__tests__/**', 'src/**/__fixtures__/**', 'src/**/*.{test,spec}.{js,jsx,mjs}'],
    rules: {
      complexity: ['warn', 50],
      'max-depth': ['warn', 4],
      'max-lines': ['warn', { max: 350, skipBlankLines: true, skipComments: true }],
      'max-lines-per-function': [
        'warn',
        { max: 200, skipBlankLines: true, skipComments: true },
      ],
      'max-params': ['warn', 4],
      'no-restricted-imports': ['error', { patterns: legacyModuleRestrictions }],
    },
  },
  {
    files: ['src/{components,hooks,screens}/**/*.{js,jsx,mjs}'],
    ignores: ['src/**/__tests__/**', 'src/**/__fixtures__/**', 'src/**/*.{test,spec}.{js,jsx,mjs}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'react-native',
              importNames: ['NativeModules'],
              message: 'Use the native owner service; UI must not call bridge internals directly.',
            },
            {
              name: 'expo-task-manager',
              message: 'Headless task registration belongs to src/tasks and RUN_RUNTIME.',
            },
          ],
          patterns: [...legacyModuleRestrictions, ...uiOwnerRestrictions],
        },
      ],
    },
  },
  {
    files: ['src/{config,repositories,services,storage,tasks,utils}/**/*.{js,jsx,mjs}'],
    ignores: ['src/**/__tests__/**', 'src/**/__fixtures__/**', 'src/**/*.{test,spec}.{js,jsx,mjs}'],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: [...legacyModuleRestrictions, ...domainToUiRestrictions] },
      ],
    },
  },
  {
    files: [
      'src/tasks/activeRunLocationTask.js',
      'src/services/runTracking/{activeRunTrackingService,activeRunRuntimeService}.js',
      'src/services/run/{runAutoSaveService,runFinalizationService,runNotificationService,runRecoveryService}.js',
    ],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            ...legacyModuleRestrictions,
            ...domainToUiRestrictions,
            ...criticalRunRestrictions,
          ],
        },
      ],
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
