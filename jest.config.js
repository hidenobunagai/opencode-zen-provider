/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  roots: ["<rootDir>/tests"],
  testMatch: ["**/*.test.ts"],
  moduleFileExtensions: ["ts", "js"],
  // src/**/*.ts only, on purpose. Adding scripts/**/*.ts would not reach the CLI entries
  // anyway: Jest collects untested files from its haste map, which `roots` scopes to
  // tests, so only scripts a test imports can appear. Re-measured 2026-09-13 with this
  // suite (208 tests): adding the glob moves the totals to 82.39% lines / 81.46%
  // statements from 82.75% / 81.65% and lists just check-changelog.ts and
  // sync-from-pi-core.ts, both pulled in by their tests. smoke.ts is instrumentable but
  // never loaded; sync-from-pi.ts does not even compile under ts-jest (TS1343 import.meta,
  // TS1378 top-level await — bun runs it with tsconfig.scripts.json). Measuring all of
  // scripts for real needs a wider `roots` too, which reports smoke.ts at 0% and drops
  // sync-from-pi.ts with a "Failed to collect coverage" warning: 79.59% lines / 78.71%
  // statements combined. Lint / tsc / sync:pi cover the rest.
  collectCoverageFrom: ["src/**/*.ts"],
  // Same global floor as commandcode-goat-provider (opencode-go-provider raises branches
  // to 65). The suite currently covers src at 85.79% lines / 84.57% statements / 86.59%
  // functions / 72.5% branches, so the floor catches a regression instead of failing on
  // the baseline it was added at.
  coverageThreshold: {
    global: {
      lines: 75,
      branches: 60,
      functions: 75,
      statements: 75,
    },
  },
  moduleNameMapper: {
    "^vscode$": "<rootDir>/__mocks__/vscode.ts",
    "^../package.json$": "<rootDir>/package.json",
  },
};
