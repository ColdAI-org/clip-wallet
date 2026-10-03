/** Screen tests (jest-expo). Node-side tests run in vitest (test/*.vitest.ts). */
module.exports = {
  preset: "jest-expo/ios",
  testMatch: ["<rootDir>/test/**/*.test.tsx"],
  // Workspace packages use TypeScript's ".js" import specifiers for ".ts" files.
  // One React for the app and the workspace packages (pnpm gives packages/i18n its own dev copy).
  moduleNameMapper: { "^(\\.{1,2}/.*)\\.js$": "$1", "^react$": "<rootDir>/node_modules/react", "^react/(.*)$": "<rootDir>/node_modules/react/$1" },
  setupFiles: ["<rootDir>/test/jest.setup.js"],
  // pnpm keeps packages under node_modules/.pnpm/<name>@<ver>/node_modules/<name>; transform RN, Expo and workspace sources.
  transformIgnorePatterns: [
    "node_modules/(?!(\\.pnpm/[^/]+/node_modules/)?((jest-)?react-native|@react-native(-community)?|@react-native/.*|expo(nent)?|@expo(nent)?/.*|expo-.*|react-native-.*|@clip-wallet/.*|@noble/.*|@scure/.*|zod|@hiero-ledger/.*))",
  ],
};
