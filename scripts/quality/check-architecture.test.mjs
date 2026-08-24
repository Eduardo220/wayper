import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ARCHITECTURE_CATEGORIES,
  analyzeArchitecture,
  evaluateArchitecture,
  parseCliArgs,
} from './check-architecture.mjs';

function baseline(overrides = {}) {
  return {
    version: 1,
    categories: Object.fromEntries(
      ARCHITECTURE_CATEGORIES.map(([id]) => [
        id,
        { legacy: {}, allowed: {}, exceptions: [], ...(overrides[id] ?? {}) },
      ])
    ),
  };
}

function resultFor(sources, overrides, roots) {
  return evaluateArchitecture(analyzeArchitecture(sources, roots), baseline(overrides));
}

function emptyFindings() {
  return Object.fromEntries(ARCHITECTURE_CATEGORIES.map(([id]) => [id, []]));
}

function countedFindings(category, file, count) {
  const findings = emptyFindings();
  findings[category] = Array.from({ length: count }, (_, index) => ({
    path: file,
    line: index + 1,
    source: 'firebase/firestore',
    kind: 'import',
  }));
  return findings;
}

const migrationException = {
  path: 'src/services/migrations/runCompatibility.js',
  max: 1,
  boundary: 'LEGACY_MODULE_ACCESS',
  reason: 'Reads an old payload during migration.',
  owner: 'run migration',
  reviewCondition: 'Remove after the payload migration expires.',
};

test('A1 screen uses an approved repository', () => {
  const result = resultFor({
    'src/screens/A.js': "import repo from '../repositories/aRepository.js';",
    'src/repositories/aRepository.js': 'export default {};',
  });
  assert.equal(result.pass, true);
});

test('A2 new screen cannot import Firestore', () => {
  const result = resultFor({ 'src/screens/A.js': "import { doc } from 'firebase/firestore';" });
  assert.equal(result.pass, false);
  assert.equal(result.failures[0].category, 'uiFirestoreImports');
});

test('A3 service cannot import a screen', () => {
  const result = resultFor({
    'src/services/aService.js': "import A from '../screens/A.js';",
    'src/screens/A.js': 'export default function A() {}',
  });
  assert.equal(result.pass, false);
  assert.equal(result.failures[0].category, 'domainToUiImports');
});

test('A4 screen cannot add direct AsyncStorage', () => {
  const result = resultFor({
    'src/screens/A.js': "import storage from '@react-native-async-storage/async-storage';",
  });
  assert.equal(result.pass, false);
  assert.equal(result.failures[0].category, 'uiLowLevelStorageImports');
});

test('A5 critical runtime cannot import Firestore', () => {
  const root = 'src/services/run/critical.js';
  const result = resultFor({ [root]: "import { doc } from 'firebase/firestore';" }, {}, [root]);
  assert.equal(result.pass, false);
  assert.equal(result.failures[0].category, 'runCriticalFirestoreImports');
});

test('A6 deferred sync may use Firestore after local save', () => {
  const result = resultFor({
    'src/services/run/runSyncQueueService.js': "import { doc } from 'firebase/firestore';",
  }, { firestoreOwnerImports: { allowed: { 'src/services/run/runSyncQueueService.js': 1 } } });
  assert.equal(result.pass, true);
});

test('A7 a new consumer cannot import runService', () => {
  const result = resultFor({
    'src/screens/A.js': "import runService from '../services/runService.js';",
    'src/services/runService.js': 'export default {};',
  });
  assert.equal(result.pass, false);
  assert.equal(result.failures[0].category, 'legacyModuleImports');
});

test('A8 an exact migration exception may import runService', () => {
  const result = resultFor(
    {
      'src/services/migrations/runCompatibility.js': "import runService from '../runService.js';",
      'src/services/runService.js': 'export default {};',
    },
    { legacyModuleImports: { exceptions: [migrationException] } }
  );
  assert.equal(result.pass, true);
});

test('A9 geo UI uses the territory owner', () => {
  const result = resultFor({
    'src/screens/A.js': "import geo from '../services/territory/territoryGeometryService.js';",
    'src/services/territory/territoryGeometryService.js': 'export default {};',
  });
  assert.equal(result.pass, true);
});

test('A10 geo UI cannot add Turf calculations', () => {
  const result = resultFor({ 'src/screens/A.js': "import * as turf from '@turf/turf';" });
  assert.equal(result.pass, false);
  assert.equal(result.failures[0].category, 'uiTurfImports');
});

test('N1 Firestore text in a comment is ignored', () => {
  assert.equal(resultFor({ 'src/screens/A.js': '// firebase/firestore\nexport default 1;' }).pass, true);
});

test('N2 test mocks are outside the production policy', () => {
  assert.equal(
    resultFor({
      'src/screens/__tests__/A.test.js': "jest.mock('firebase/firestore');",
    }).pass,
    true
  );
});

test('N3 repository Firestore access is allowed', () => {
  assert.equal(
    resultFor({
      'src/repositories/aRepository.js': "import { doc } from 'firebase/firestore';",
    }, { firestoreOwnerImports: { allowed: { 'src/repositories/aRepository.js': 1 } } }).pass,
    true
  );
});

test('N4 diagnostics can read a public runtime snapshot', () => {
  assert.equal(
    resultFor({
      'src/services/diagnostics/export.js': "import runtime from '../runTracking/activeRunRuntimeService.js';",
      'src/services/runTracking/activeRunRuntimeService.js': 'export default {};',
    }).pass,
    true
  );
});

test('N5 MapScreen exact storage exception is allowed', () => {
  const exception = { ...migrationException, path: 'src/screens/MapScreen.js', boundary: 'UI_STORAGE' };
  const result = resultFor(
    {
      'src/screens/MapScreen.js': "import sync from '../utils/sync.js';",
      'src/utils/sync.js': 'export default {};',
    },
    { uiLowLevelStorageImports: { exceptions: [exception] } }
  );
  assert.equal(result.pass, true);
});

test('N6 unchanged legacy finding is allowed', () => {
  const result = resultFor(
    { 'src/screens/A.js': "import { doc } from 'firebase/firestore';" },
    {
      uiFirestoreImports: { legacy: { 'src/screens/A.js': 1 } },
      firestoreOwnerImports: { legacy: { 'src/screens/A.js': 1 } },
    }
  );
  assert.equal(result.pass, true);
});

test('N7 static dynamic imports cannot evade the gate', () => {
  const result = resultFor({ 'src/screens/A.js': "const db = import('firebase/firestore');" });
  assert.equal(result.pass, false);
  assert.equal(result.failures[0].category, 'uiFirestoreImports');
});

test('N8 require cannot evade the gate', () => {
  const result = resultFor({
    'src/screens/A.js': "const storage = require('@react-native-async-storage/async-storage');",
  });
  assert.equal(result.pass, false);
  assert.equal(result.failures[0].category, 'uiLowLevelStorageImports');
});

test('R1 baseline 5 to current 5 passes', () => {
  const file = 'src/screens/A.js';
  const result = evaluateArchitecture(
    countedFindings('uiFirestoreImports', file, 5),
    baseline({ uiFirestoreImports: { legacy: { [file]: 5 } } })
  );
  assert.equal(result.pass, true);
});

test('R2 baseline 5 to current 4 passes as an improvement', () => {
  const file = 'src/screens/A.js';
  const result = evaluateArchitecture(
    countedFindings('uiFirestoreImports', file, 4),
    baseline({ uiFirestoreImports: { legacy: { [file]: 5 } } })
  );
  assert.equal(result.pass, true);
  assert.equal(result.improvements.length, 1);
});

test('R3 baseline 5 to current 6 fails', () => {
  const file = 'src/screens/A.js';
  const result = evaluateArchitecture(
    countedFindings('uiFirestoreImports', file, 6),
    baseline({ uiFirestoreImports: { legacy: { [file]: 5 } } })
  );
  assert.equal(result.pass, false);
  assert.equal(result.failures[0].type, 'LEGACY_REGRESSION');
});

test('R4 zero-baseline category rejects its first finding', () => {
  const result = evaluateArchitecture(
    countedFindings('uiTurfImports', 'src/screens/A.js', 1),
    baseline()
  );
  assert.equal(result.pass, false);
  assert.equal(result.failures[0].type, 'NEW_VIOLATION');
});

test('R5 wildcard exceptions are rejected', () => {
  const result = evaluateArchitecture(
    emptyFindings(),
    baseline({ legacyModuleImports: { exceptions: [{ ...migrationException, path: 'src/**' }] } })
  );
  assert.equal(result.pass, false);
  assert.equal(result.failures[0].type, 'INVALID_EXCEPTION');
});

test('R6 baseline auto-update is not a command', () => {
  assert.throws(() => parseCliArgs(['--update-baseline']), /Usage/);
});
