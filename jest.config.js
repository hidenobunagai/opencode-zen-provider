/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  roots: ["<rootDir>/tests"],
  testMatch: ["**/*.test.ts"],
  moduleFileExtensions: ["ts", "js"],
  // scripts/**/*.ts stays out on purpose: smoke.ts and sync-from-pi.ts are CLI entry
  // points Jest never loads, so the glob would measure scaffolding rather than shipped
  // code. Re-measured 2026-09-13 with this suite: adding it reports 76.8% lines / 75.9%
  // statements, so the exclusion is about scope, not about clearing the floor below.
  // check-changelog.ts and sync-from-pi-core.ts are unit-tested; lint / tsc / sync:pi
  // cover the rest.
  collectCoverageFrom: ["src/**/*.ts"],
  // Same global floor as commandcode-goat-provider (opencode-go-provider raises branches
  // to 65). The suite currently covers src at 76.6% lines / 75.5% statements / 83.2%
  // functions / 61.1% branches, so the floor catches a regression instead of failing on
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
