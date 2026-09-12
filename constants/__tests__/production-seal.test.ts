/**
 * Proves the dev-only surface is sealed when `isDev` is false.
 *
 * The dev harness is deliberately KEPT — it is what lets one person drive a full
 * ride end to end in the sandbox, which the cutover checklist depends on. What
 * matters is that none of it can reach a production build. That guarantee
 * currently rests on a handful of scattered `isDev` checks, and this is the
 * mechanical proof that they still hold.
 *
 * `constants/runtime-config` pulls in `expo-constants`, which the node test
 * environment cannot parse, so it is mocked to an empty manifest. The values the
 * module actually reads come from `process.env` first anyway (see the comment on
 * `inlined` there), which is exactly what these tests set.
 */

// Only APP_ENV, API_BASE_URL and FIRESTORE_DATABASE_ID are read from
// `process.env`; everything else comes from the Expo manifest's `extra`. So the
// Firebase keys have to be supplied through this mock, not the environment.
jest.mock("expo-constants", () => ({
  __esModule: true,
  default: {
    expoConfig: {
      extra: {
        EXPO_PUBLIC_FIREBASE_API_KEY: "test-key",
        EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN: "test.firebaseapp.com",
        EXPO_PUBLIC_FIREBASE_PROJECT_ID: "test-project",
        EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET: "test.appspot.com",
        EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: "1234567890",
        EXPO_PUBLIC_FIREBASE_APP_ID: "1:1234567890:web:abc",
        EXPO_PUBLIC_FIREBASE_MEASUREMENT_ID: "G-TEST",
      },
    },
  },
}));

// expo-location ships untranspiled ESM. dev-location only needs the module to
// exist — these tests exercise the override, never a real GPS read.
jest.mock("expo-location", () => ({
  __esModule: true,
  Accuracy: { Balanced: 3, High: 4 },
  getCurrentPositionAsync: jest.fn(),
  getForegroundPermissionsAsync: jest.fn(),
}));

/** Load a module tree fresh under a chosen environment. */
function loadUnderEnv<T>(appEnv: string, load: () => T): T {
  const previous = process.env.EXPO_PUBLIC_APP_ENV;
  process.env.EXPO_PUBLIC_APP_ENV = appEnv;
  let mod!: T;
  jest.isolateModules(() => { mod = load(); });
  process.env.EXPO_PUBLIC_APP_ENV = previous;
  return mod;
}

describe("environment resolution", () => {
  it("is production when APP_ENV says production", () => {
    const rc = loadUnderEnv("production", () => require("@/constants/runtime-config"));
    expect(rc.isDev).toBe(false);
    expect(rc.appEnv).toBe("production");
  });

  it("is dev when APP_ENV says dev", () => {
    const rc = loadUnderEnv("dev", () => require("@/constants/runtime-config"));
    expect(rc.isDev).toBe(true);
  });

  it("points at the live database in production and the dev one in dev", () => {
    // The single most consequential thing this flag decides.
    expect(
      loadUnderEnv("production", () => require("@/constants/runtime-config"))
        .runtimeConfig.firestoreDatabaseId,
    ).toBe("uniliftdefault");
    expect(
      loadUnderEnv("dev", () => require("@/constants/runtime-config"))
        .runtimeConfig.firestoreDatabaseId,
    ).toBe("uniliftdev");
  });

  it("throws rather than guessing when APP_ENV is missing", () => {
    // "Absence means production" was the old behaviour and it meant any config
    // slip silently pointed a test build at real user data.
    expect(() => loadUnderEnv("", () => require("@/constants/runtime-config"))).toThrow(
      /EXPO_PUBLIC_APP_ENV/,
    );
  });

  it("throws on a misspelled value instead of falling back", () => {
    expect(() => loadUnderEnv("prod", () => require("@/constants/runtime-config"))).toThrow(
      /Invalid EXPO_PUBLIC_APP_ENV/,
    );
  });
});

describe("the dev ride harness cannot run in production", () => {
  it("refuses every call when isDev is false", async () => {
    const svc = loadUnderEnv("production", () => require("@/services/devRideService"));
    // Whatever the harness exposes, none of it may reach the server.
    const callables = Object.entries(svc as Record<string, unknown>)
      .filter(([, v]) => typeof v === "function");
    expect(callables.length).toBeGreaterThan(0);
    for (const [name, fn] of callables) {
      await expect(
        Promise.resolve().then(() => (fn as (...a: unknown[]) => unknown)("x", "y")),
      ).rejects.toThrow(/dev/i);
      expect(name).toBeTruthy();
    }
  });
});

describe("the GPS override cannot displace a real position in production", () => {
  it("ignores an override that was somehow set", () => {
    const dev = loadUnderEnv("production", () => require("@/utils/dev-location"));
    dev.setDevLocationOverride({ latitude: 1, longitude: 2 });
    expect(dev.getDevLocationOverride()).toBeNull();
  });

  it("honours one in dev, so the harness still works", () => {
    const dev = loadUnderEnv("dev", () => require("@/utils/dev-location"));
    dev.setDevLocationOverride({ latitude: 1, longitude: 2 });
    expect(dev.getDevLocationOverride()).toEqual({ latitude: 1, longitude: 2 });
    dev.setDevLocationOverride(null);
  });
});

describe("certification is inert regardless of build type", () => {
  it("stays off even on a dev build", () => {
    // The point of moving off `= isDev`: a dev build pointed at live data must
    // not switch the feature on for everyone.
    for (const env of ["dev", "production"]) {
      const certs = loadUnderEnv(env, () => require("@/constants/certifications"));
      expect(certs.CERTIFICATION_ENABLED).toBe(false);
    }
  });
});
