import Constants from "expo-constants";

type ExtraConfig = {
  EXPO_PUBLIC_FIREBASE_API_KEY?: string;
  EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN?: string;
  EXPO_PUBLIC_FIREBASE_PROJECT_ID?: string;
  EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET?: string;
  EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID?: string;
  EXPO_PUBLIC_FIREBASE_APP_ID?: string;
  EXPO_PUBLIC_FIREBASE_MEASUREMENT_ID?: string;
  EXPO_PUBLIC_FIRESTORE_DATABASE_ID?: string;
  EXPO_PUBLIC_APP_ENV?: string;
  EXPO_PUBLIC_API_BASE_URL?: string;
  EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY?: string;
  EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY_TEST?: string;
};

const extra = (Constants.expoConfig?.extra ?? {}) as ExtraConfig;

// Expo inlines every `EXPO_PUBLIC_*` var into the bundle at build time, so
// `process.env` is a second, independent source for the same values. Reading it
// first means a missing or partially-resolved manifest (`Constants.expoConfig`
// null, an OTA bundle whose manifest didn't carry `extra`) can no longer change
// which environment the app resolves to.
const inlined: Record<string, string | undefined> = {
  EXPO_PUBLIC_APP_ENV: process.env.EXPO_PUBLIC_APP_ENV,
  EXPO_PUBLIC_API_BASE_URL: process.env.EXPO_PUBLIC_API_BASE_URL,
  EXPO_PUBLIC_FIRESTORE_DATABASE_ID: process.env.EXPO_PUBLIC_FIRESTORE_DATABASE_ID,
};

// A blank env var (`EXPO_PUBLIC_API_BASE_URL=` in .env, or an unset key in an
// eas.json profile) must read as "absent", not as the empty string — every
// consumer below defaults with `??`, which only falls through on null/undefined.
// Returning "" would silently win over the default and, for apiBaseUrl, turn
// every Cloud Function call into an unfetchable relative URL.
const fromEnv = (key: keyof ExtraConfig): string | undefined => {
  const clean = (value: unknown): string | undefined =>
    (typeof value === "string" ? value.trim() : "") || undefined;
  return clean(inlined[key]) ?? clean(extra[key]);
};

const required = (key: keyof ExtraConfig): string => {
  const value = fromEnv(key);
  if (!value) {
    throw new Error(`Missing required runtime config: ${key}`);
  }
  return value;
};

// The environment must be DECLARED, never inferred from absence. This value
// selects the Firestore database, the API server, and the Stripe key set, so a
// missing or misspelled value previously meant "silently talk to production with
// real user data" — the worst possible default. Every eas.json profile and .env
// now sets it explicitly; anything else is a configuration bug, and throwing at
// import is strictly safer than starting up pointed at the wrong environment.
const APP_ENVS = ["dev", "production"] as const;
type AppEnv = (typeof APP_ENVS)[number];

const resolveAppEnv = (): AppEnv => {
  const raw = fromEnv("EXPO_PUBLIC_APP_ENV");
  if (!raw) {
    throw new Error(
      "Missing required runtime config: EXPO_PUBLIC_APP_ENV (expected \"dev\" or \"production\"). " +
        "Set it in .env for local runs, or in the eas.json build profile.",
    );
  }
  if (!(APP_ENVS as readonly string[]).includes(raw)) {
    throw new Error(
      `Invalid EXPO_PUBLIC_APP_ENV: "${raw}". Expected "dev" or "production".`,
    );
  }
  return raw as AppEnv;
};

export const appEnv: AppEnv = resolveAppEnv();
export const isDev = appEnv === "dev";

export const runtimeConfig = {
  firebaseApiKey: required("EXPO_PUBLIC_FIREBASE_API_KEY"),
  firebaseAuthDomain: required("EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN"),
  firebaseProjectId: required("EXPO_PUBLIC_FIREBASE_PROJECT_ID"),
  firebaseStorageBucket: required("EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET"),
  firebaseMessagingSenderId: required(
    "EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID",
  ),
  firebaseAppId: required("EXPO_PUBLIC_FIREBASE_APP_ID"),
  firebaseMeasurementId: required("EXPO_PUBLIC_FIREBASE_MEASUREMENT_ID"),
  firestoreDatabaseId: isDev
    ? "uniliftdev"
    : (fromEnv("EXPO_PUBLIC_FIRESTORE_DATABASE_ID") ?? "uniliftdefault"),
  // Initial Stripe publishable key used before the /config response arrives.
  // In dev mode, the test key is used immediately so Stripe is never initialized
  // with a live key that mismatches the test secret key on the server.
  stripePublishableKey: isDev
    ? (fromEnv("EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY_TEST") ?? "")
    : (fromEnv("EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY") ?? ""),
};

export const firestoreBaseUrl = `https://firestore.googleapis.com/v1/projects/${runtimeConfig.firebaseProjectId}/databases/${encodeURIComponent(
  runtimeConfig.firestoreDatabaseId,
)}/documents`;

export const firestoreCollectionUrl = (collection: string) =>
  `${firestoreBaseUrl}/${collection}`;

export const firestoreDocumentUrl = (collection: string, id: string) =>
  `${firestoreCollectionUrl(collection)}/${id}`;

export const withFirebaseApiKey = (url: string) => {
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}key=${runtimeConfig.firebaseApiKey}`;
};

export const firebaseStorageBaseUrl = `https://firebasestorage.googleapis.com/v0/b/${runtimeConfig.firebaseStorageBucket}/o`;

// Two independently-deployed Cloud Functions codebases:
//   • LIVE  — frozen at the last App Store build (functions/, exports `api`),
//     prod-pinned (uniliftdefault + Stripe live). The shipped binary targets this.
//   • SANDBOX — new features (functions-sandbox/, exports `apiSandbox`),
//     hardwired to the dev data environment (uniliftdev + Stripe test).
// Dev builds hit the sandbox; production/preview builds hit live. Overridable per
// build via EXPO_PUBLIC_API_BASE_URL (set in eas.json / .env).
const LIVE_API_BASE_URL = "https://api-qsxtpust2a-uc.a.run.app";
// gen1 HTTPS functions are always reachable at this deterministic URL, so it is
// stable without needing the run.app hash assigned on first deploy.
const SANDBOX_API_BASE_URL =
  "https://us-central1-unilift-6e756.cloudfunctions.net/apiSandbox";

export const apiBaseUrl =
  fromEnv("EXPO_PUBLIC_API_BASE_URL") ??
  (isDev ? SANDBOX_API_BASE_URL : LIVE_API_BASE_URL);

// The sandbox function is dev-pinned server-side and ignores this header — it is
// kept only as a harmless belt-and-suspenders signal for dev builds.
export function apiFetch(url: string, init: RequestInit = {}): Promise<Response> {
  if (!isDev) return fetch(url, init);
  const headers = new Headers(init.headers as HeadersInit | undefined);
  headers.set("X-App-Env", "dev");
  return fetch(url, { ...init, headers });
}

// Debug logging that is a no-op outside dev. Use for temporary `[RIDE-DEBUG]`
// style diagnostics so production builds stay silent.
//
// Gating is on `isDev` (i.e. EXPO_PUBLIC_APP_ENV), NOT on __DEV__ or NODE_ENV.
// That distinction matters: the `development` and `testflight` EAS profiles ship
// release bundles (NODE_ENV=production) while declaring APP_ENV=dev, so keying
// off the build mode would silence exactly the builds used for testing.
//
// These are the only sanctioned console entry points in app code — the
// `no-console` rule in eslint.config.js enforces that everywhere else.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const devLog = (...args: any[]): void => { if (isDev) console.log(...args); };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const devWarn = (...args: any[]): void => { if (isDev) console.warn(...args); };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const devError = (...args: any[]): void => {
  if (isDev) console.error(...args);
  // FUTURE (crash reporting): there is no Sentry/Bugsnag in this app yet, so a
  // production error currently goes nowhere — that is deliberate, since several
  // call sites pass raw Firebase errors and Firestore response bodies that can
  // carry emails/uids, and device logs are readable via Xcode / adb logcat.
  // When a reporter is added, capture here instead of dropping: this is the one
  // chokepoint every app-side error path flows through, so wiring it in this
  // function covers all call sites at once.
};
