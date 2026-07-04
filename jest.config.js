module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  testMatch: ["**/utils/matching/__tests__/**/*.test.ts"],
  moduleNameMapper: { "^@/(.*)$": "<rootDir>/$1" },
};
