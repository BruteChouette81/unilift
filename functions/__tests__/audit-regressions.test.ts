/**
 * Regression tests for the rest of the pre-launch audit fixes.
 *
 * Same approach as fare-guardrails.test.ts: these mirror small pure helpers from
 * functions/index.js, which cannot be imported without booting firebase-admin.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Public profile projection — the allowlist that replaced a world-readable
// users/{uid}. Anything not listed must not survive the projection.
// ─────────────────────────────────────────────────────────────────────────────
function ageFromBirthDate(birthDate: unknown): number | null {
  const birth = new Date(String(birthDate || ""));
  if (isNaN(birth.getTime())) return null;
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const m = today.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age -= 1;
  return age > 0 && age < 130 ? age : null;
}

function publicProfileFrom(uid: string, data: Record<string, any>) {
  const u = data || {};
  const email = typeof u.email === "string" ? u.email : "";
  const sum = Number(u.ratingSum);
  const count = Number(u.ratingCount);
  const hasNewShape = Number.isFinite(sum) && Number.isFinite(count) && count > 0;
  const legacyAvg = Number(u.ratings);
  const legacyWeight = Number(u.ratingWeigth);
  const hasLegacy = Number.isFinite(legacyAvg) && Number.isFinite(legacyWeight) && legacyWeight > 0;

  const ratingSum = hasNewShape ? sum : (hasLegacy ? legacyAvg * legacyWeight : 0);
  const ratingCount = hasNewShape ? count : (hasLegacy ? legacyWeight : 0);
  const rating = ratingCount > 0 ? Math.round((ratingSum / ratingCount) * 100) / 100 : 0;
  const age = ageFromBirthDate(u.birthDate);

  return {
    uid,
    name: (typeof u.name === "string" && u.name) || (email ? email.split("@")[0] : "") || "",
    avatar: typeof u.avatar === "string" ? u.avatar : "",
    xp: Number(u.xp) || 0,
    ridesCompleted: Number(u.ridesCompleted) || 0,
    ratingSum,
    ratingCount,
    rating,
    certifications: Array.isArray(u.certifications) ? u.certifications : [],
    school: typeof u.school === "string" ? u.school : "",
    instagramHandle: typeof u.instagramHandle === "string" ? u.instagramHandle : "",
    ...(age != null ? { age } : {}),
    updatedAt: new Date().toISOString(),
  };
}

const PRIVATE_USER_DOC = {
  name: "Alex Tremblay",
  email: "alex@ulaval.ca",
  avatar: "https://example.com/a.png",
  birthDate: "2000-05-14",
  homeAddress: "1234 Rue Saint-Jean, Québec",
  localisation: { latitude: 46.8, longitude: -71.2 },
  phone: "+15551234567",
  expoPushToken: "ExponentPushToken[xxx]",
  expoPushTokenEnv: "production",
  stripeCustomerId: "cus_123",
  stripePaymentMethodId: "pm_123",
  stripePaymentMethodLast4: "4242",
  stripeConnectAccountId: "acct_123",
  stripeConnectBankLast4: "6789",
  pendingChargeCents: 1250,
  pendingEarningsCents: 800,
  availableEarningsCents: 4500,
  cashoutEligibleSince: "2026-01-01T00:00:00.000Z",
  driverModeEnabled: true,
  xp: 340,
  ridesCompleted: 17,
  ratingSum: 78,
  ratingCount: 17,
  certifications: ["student"],
  school: "Université Laval",
  instagramHandle: "alexdrives",
};

describe("public profile projection", () => {
  const profile = publicProfileFrom("u1", PRIVATE_USER_DOC) as Record<string, unknown>;

  it.each([
    "email", "birthDate", "homeAddress", "localisation", "phone",
    "expoPushToken", "expoPushTokenEnv",
    "stripeCustomerId", "stripePaymentMethodId", "stripePaymentMethodLast4",
    "stripeConnectAccountId", "stripeConnectBankLast4",
    "pendingChargeCents", "pendingEarningsCents", "availableEarningsCents",
    "cashoutEligibleSince", "driverModeEnabled",
  ])("does not leak %s", (field) => {
    expect(profile).not.toHaveProperty(field);
  });

  it("keeps the fields a ride card actually renders", () => {
    expect(profile.name).toBe("Alex Tremblay");
    expect(profile.avatar).toBe("https://example.com/a.png");
    expect(profile.xp).toBe(340);
    expect(profile.ridesCompleted).toBe(17);
    expect(profile.certifications).toEqual(["student"]);
  });

  it("exposes a derived age but never the birth date it came from", () => {
    expect(typeof profile.age).toBe("number");
    expect(profile).not.toHaveProperty("birthDate");
  });

  it("falls back to the email local-part for a nameless account, without the domain", () => {
    const p = publicProfileFrom("u2", { email: "someone@ulaval.ca" });
    expect(p.name).toBe("someone");
    expect(JSON.stringify(p)).not.toContain("ulaval.ca");
  });
});

describe("rating math", () => {
  it("keeps a fractional average instead of rounding to an integer", () => {
    // 4 + 5 + 5 = 14 over 3 -> 4.67, which the old Math.round turned into 5.
    const p = publicProfileFrom("u1", { ratingSum: 14, ratingCount: 3 });
    expect(p.rating).toBeCloseTo(4.67, 2);
  });

  it("migrates a legacy rounded average without losing the driver's reputation", () => {
    const p = publicProfileFrom("u1", { ratings: 4, ratingWeigth: 10 });
    expect(p.ratingSum).toBe(40);
    expect(p.ratingCount).toBe(10);
    expect(p.rating).toBe(4);
  });

  it("does not drift upward as ratings accumulate", () => {
    // The old code fed its own rounded output back in, so a run of 4s crept to 5.
    let sum = 0;
    let count = 0;
    for (let i = 0; i < 20; i++) { sum += 4; count += 1; }
    expect(publicProfileFrom("u1", { ratingSum: sum, ratingCount: count }).rating).toBe(4);
  });

  it("reports 0 for an unrated account rather than dividing by zero", () => {
    const p = publicProfileFrom("u1", {});
    expect(p.rating).toBe(0);
    expect(Number.isNaN(p.rating)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Broadcast de-identification
// ─────────────────────────────────────────────────────────────────────────────
function broadcastSafeName(full: unknown): string {
  return String(full || "").trim().split(/\s+/)[0] || "A passenger";
}

function coarseLabel(label: unknown): string {
  const raw = String(label || "").trim();
  if (!raw) return "";
  const parts = raw.split(",").map((p) => p.trim()).filter(Boolean);
  if (parts.length > 1) return parts[parts.length - 1];
  return /\d/.test(raw) ? "" : raw;
}

describe("broadcast de-identification", () => {
  it("sends a first name, not a full name, to strangers", () => {
    expect(broadcastSafeName("Alex Tremblay")).toBe("Alex");
  });

  it("degrades to a placeholder rather than an empty name", () => {
    expect(broadcastSafeName("")).toBe("A passenger");
    expect(broadcastSafeName(undefined)).toBe("A passenger");
  });

  it("reduces a street address to its locality", () => {
    expect(coarseLabel("1234 Rue Saint-Jean, Québec")).toBe("Québec");
  });

  it("drops a bare street address entirely rather than broadcasting it", () => {
    expect(coarseLabel("1234 Rue Saint-Jean")).toBe("");
  });

  it("keeps a place name that carries no address", () => {
    expect(coarseLabel("Université Laval")).toBe("Université Laval");
  });

  it("never emits a house number", () => {
    for (const label of [
      "1234 Rue Saint-Jean, Québec",
      "5 Avenue des Érables, Lévis",
      "890 Boulevard Charest",
    ]) {
      expect(coarseLabel(label)).not.toMatch(/\d/);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Dropoff telemetry corroboration
// ─────────────────────────────────────────────────────────────────────────────
const DROPOFF_TELEMETRY_TOLERANCE_KM = 10;

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

describe("dropoff fix corroboration", () => {
  const LAVAL = { lat: 46.7817, lng: -71.2747 };
  const MONTREAL = { lat: 45.5019, lng: -73.5674 };

  it("flags a reported fix that contradicts the driver's own telemetry", () => {
    // Driver's app was reporting Laval; they claim they were in Montréal.
    const drift = haversineKm(MONTREAL.lat, MONTREAL.lng, LAVAL.lat, LAVAL.lng);
    expect(drift).toBeGreaterThan(DROPOFF_TELEMETRY_TOLERANCE_KM);
  });

  it("tolerates ordinary telemetry lag", () => {
    // ~2 km apart: throttled telemetry during a short drive.
    const drift = haversineKm(46.7817, -71.2747, 46.7990, -71.2760);
    expect(drift).toBeLessThan(DROPOFF_TELEMETRY_TOLERANCE_KM);
  });
});
