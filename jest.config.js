/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  roots: ["<rootDir>/tests"],
  testMatch: ["**/*.test.ts"],
  moduleFileExtensions: ["ts", "js"],
  // scripts/**/*.ts stays out on purpose: sync-from-pi.ts and smoke.ts are CLI entry
  // points Jest never loads, so adding the glob would mix them into the src figure
  // (74.7% -> 72.3% lines, past the 75% sibling repos gate at) and measure scaffolding
  // rather than code. check-changelog.ts and sync-from-pi-core.ts are unit-tested;
  // lint / tsc / sync:pi cover the rest.
  collectCoverageFrom: ["src/**/*.ts"],
  moduleNameMapper: {
    "^vscode$": "<rootDir>/__mocks__/vscode.ts",
    "^../package.json$": "<rootDir>/package.json",
  },
};
