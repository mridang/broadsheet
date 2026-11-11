export default {
  preset: 'ts-jest/presets/default-esm',
  transform: {
    '^.+\\.m?[tj]sx?$': [
      'ts-jest',
      {
        useESM: true,
        tsconfig: 'tsconfig.jest.json',
      },
    ],
  },
  testEnvironment: 'node',
  testMatch: ['**/*.+(spec|test).[tj]s?(x)'],
  moduleFileExtensions: [
    'ts',
    'tsx',
    'js',
    'mjs',
    'jsx',
    'mts',
    'json',
    'node',
  ],
  /**
   * Worktrees live under `.claude/` inside the checkout, so they fall inside
   * `rootDir` and are crawled like any other source, which runs every suite
   * again per worktree. This has to be a module path, not a test path:
   * ignoring the tests still indexes the modules.
   */
  modulePathIgnorePatterns: ['<rootDir>/.claude/'],
  testPathIgnorePatterns: [
    '/node_modules/',
    '/frontend/',
    '/dist/',
    '/packages/',
  ],
  resetModules: false,
  globalSetup: './test/setup.ts',
  globalTeardown: './test/teardown.ts',
  collectCoverage: true,
  coverageDirectory: './.out',
  collectCoverageFrom: ['src/**/*.{ts,tsx,js,jsx}', '!src/**/*.d.ts'],
  coverageReporters: ['lcov', 'text'],
  coveragePathIgnorePatterns: ['/dist/', '/node_modules/'],
  testTimeout: 60_000,
  extensionsToTreatAsEsm: ['.ts', '.tsx', '.mts'],
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
    // The app's `@/` alias for src/, so components and pages can be tested.
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  reporters: [
    'default',
    [
      'jest-junit',
      {
        outputDirectory: './.out',
        outputName: 'junit.xml',
      },
    ],
  ],
};
