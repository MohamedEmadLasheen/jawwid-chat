/**
 * Jest configuration for @jawwid/api.
 *
 * QA-owned (AI #5). package.json already declared `--selectProjects unit` and
 * `--selectProjects integration`; this file defines those projects.
 *
 *   unit         pure, no I/O. Must stay fast enough to run on every push.
 *   integration  requires a database. Run with --runInBand.
 */
const base = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '.',
  moduleNameMapper: {
    '^@platform/(.*)$': '<rootDir>/src/platform/$1',
    '^@communication/(.*)$': '<rootDir>/src/communication/$1',
  },
  setupFiles: ['<rootDir>/test/setup.ts'],
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json'}],
  },
};

module.exports = {
  projects: [
    { ...base, displayName: 'unit', testMatch: ['<rootDir>/test/unit/**/*.spec.ts'] },
    { ...base, displayName: 'integration', testMatch: ['<rootDir>/test/integration/**/*.spec.ts'] },
    // perf  measures; it does not gate. Deliberately excluded from `npm test`
    // and from CI: a timing assertion on a shared runner is a flaky test, and a
    // flaky test in a security pipeline is one that gets disabled. Run it on
    // purpose -- `npx jest --selectProjects perf` -- and record the output in
    // docs/qa/performance-baseline.md together with the machine it came from.
    //
    // The *.perf.ts suffix is what keeps it out of the two projects above.
    { ...base, displayName: 'perf', testMatch: ['<rootDir>/test/perf/**/*.perf.ts'] },
  ],
};
