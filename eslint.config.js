// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

// Directories that make up the shipped app bundle. Everything here must route
// logging through the isDev-gated helpers in constants/runtime-config.ts so a
// production build stays silent — see the `no-console` block below.
const APP_SOURCE = [
  'app/**/*.{ts,tsx}',
  'components/**/*.{ts,tsx}',
  'services/**/*.{ts,tsx}',
  'hooks/**/*.{ts,tsx}',
  'utils/**/*.{ts,tsx}',
  'constants/**/*.{ts,tsx}',
  'context/**/*.{ts,tsx}',
  'types/**/*.{ts,tsx}',
];

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['dist/*'],
  },
  {
    // Ban raw console in app code. Use devLog / devWarn / devError from
    // constants/runtime-config.ts, or rideLog from utils/ride-logger.ts — all of
    // which no-op unless EXPO_PUBLIC_APP_ENV=dev, so debug output disappears in
    // production and comes back in dev builds automatically.
    //
    // Scoped to APP_SOURCE deliberately: this config also traverses functions/
    // and functions-sandbox/, whose console output goes to Google Cloud Logging
    // and is legitimate production observability. An unscoped rule would flag
    // ~97 server lines that must stay.
    files: APP_SOURCE,
    rules: {
      'no-console': 'error',
    },
  },
  {
    // The two modules that legitimately own console output: they ARE the gated
    // helpers, so their console calls are the implementation, not a leak.
    files: ['constants/runtime-config.ts', 'utils/ride-logger.ts'],
    rules: {
      'no-console': 'off',
    },
  },
]);
