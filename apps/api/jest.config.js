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
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json'}],
  },
};

module.exports = {
  projects: [
    { ...base, displayName: 'unit', testMatch: ['<rootDir>/test/unit/**/*.spec.ts'] },
    { ...base, displayName: 'integration', testMatch: ['<rootDir>/test/integration/**/*.spec.ts'] },
  ],
};
