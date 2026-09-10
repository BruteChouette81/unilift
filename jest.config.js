module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  // Any `__tests__` folder, not just utils/matching — the money and parsing
  // logic lives in constants/ and services/ and had no coverage while this glob
  // was scoped to one directory.
  testMatch: ["**/__tests__/**/*.test.ts"],
  moduleNameMapper: { "^@/(.*)$": "<rootDir>/$1" },
};
