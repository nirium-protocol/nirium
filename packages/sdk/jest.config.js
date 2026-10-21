/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/*.test.ts'],
  // #126: no test may open a real outbound connection.
  setupFilesAfterEnv: ['<rootDir>/jest.no-network.js'],
};
