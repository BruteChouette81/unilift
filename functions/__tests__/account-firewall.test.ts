/**
 * Regression tests for the account-creation firewall.
 *
 * Same approach as the other two suites here: the transaction bodies in
 * `functions/index.js` and `functions/identity.js` cannot be imported without
 * booting firebase-admin, so the decision logic is mirrored as small pure
 * functions and the *decisions* are pinned. What is tested is the rule, not the
 * plumbing — each case below is an abuse that would otherwise be live.
 */

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { normalizeEmail, emailIndexKey } = require("../email-identity");

const MAX_ACCOUNTS_PER_DEVICE = 5;

// ─────────────────────────────────────────────────────────────────────────────
// The device-id guard. `deviceId` becomes a Firestore document id, so anything
// that is not one of our own hashes has to be refused before it gets there — a
// path separator would silently create a subcollection, and "." / ".." are not
// legal ids at all.
// ─────────────────────────────────────────────────────────────────────────────
function validDeviceId(value: unknown): boolean {
  return typeof value === "string" && /^[a-f0-9]{64}$/i.test(value);
}

describe("validDeviceId", () => {
  const good = "a".repeat(64);

  it("accepts a sha-256 hex digest", () => {
    expect(validDeviceId(good)).toBe(true);
    expect(validDeviceId(good.toUpperCase())).toBe(true);
  });

  it.each([
    ["a path separator", "a/b" + "c".repeat(60)],
    ["a parent-directory id", ".."],
    ["a single dot", "."],
    ["something too short", "abc123"],
    ["something too long", "a".repeat(65)],
    ["non-hex characters", "z".repeat(64)],
    ["an empty string", ""],
    ["a number", 12345],
    ["null", null],
    ["undefined", undefined],
    ["an object", { toString: () => "a".repeat(64) }],
  ])("rejects %s", (_label, value) => {
    expect(validDeviceId(value)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The slot decision, mirroring the /device/register transaction.
// ─────────────────────────────────────────────────────────────────────────────
type DeviceDoc = { active?: number; uids?: string[] };

function decideSlot(doc: DeviceDoc | null, uid: string) {
  const data = doc || {};
  const uids = Array.isArray(data.uids) ? data.uids : [];
  if (uids.includes(uid)) return { ok: true, already: true };
  const active = Number(data.active) || 0;
  if (active >= MAX_ACCOUNTS_PER_DEVICE) return { error: "device_account_limit" };
  return { ok: true };
}

describe("per-device account cap", () => {
  it("allows the first account on an unseen device", () => {
    expect(decideSlot(null, "u1")).toEqual({ ok: true });
  });

  it("allows accounts up to the cap", () => {
    for (let active = 0; active < MAX_ACCOUNTS_PER_DEVICE; active++) {
      expect(decideSlot({ active, uids: [] }, "new")).toEqual({ ok: true });
    }
  });

  it("refuses the account that would exceed the cap", () => {
    expect(decideSlot({ active: MAX_ACCOUNTS_PER_DEVICE, uids: [] }, "new")).toEqual({
      error: "device_account_limit",
    });
  });

  it("stays refused above the cap, in case a row ever drifts high", () => {
    expect(decideSlot({ active: 99, uids: [] }, "new")).toEqual({
      error: "device_account_limit",
    });
  });

  // The client retries this call on a flaky network. A retry must not burn a
  // second slot, and must not fail once the device is full.
  it("is idempotent for a uid that already holds a slot", () => {
    const full = { active: MAX_ACCOUNTS_PER_DEVICE, uids: ["u1", "u2", "u3", "u4", "u5"] };
    expect(decideSlot(full, "u3")).toEqual({ ok: true, already: true });
  });

  it("treats a missing or malformed count as zero rather than as unlimited", () => {
    expect(decideSlot({ uids: [] }, "u1")).toEqual({ ok: true });
    expect(decideSlot({ active: NaN, uids: [] }, "u1")).toEqual({ ok: true });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The mailbox claim, mirroring the beforeUserCreated transaction.
// ─────────────────────────────────────────────────────────────────────────────
function decideClaim(row: { uid?: string } | null, uid: string) {
  if (row && row.uid && row.uid !== uid) return { conflictWith: row.uid };
  return { claimed: true };
}

describe("one mailbox, one account", () => {
  it("claims a free mailbox", () => {
    expect(decideClaim(null, "u1")).toEqual({ claimed: true });
  });

  it("refuses a mailbox held by another account", () => {
    expect(decideClaim({ uid: "u1" }, "u2")).toEqual({ conflictWith: "u1" });
  });

  it("lets the same account re-claim, so a retry is not a conflict", () => {
    expect(decideClaim({ uid: "u1" }, "u1")).toEqual({ claimed: true });
  });

  // The whole point of canonicalising before the claim: every alias of one
  // Gmail mailbox has to land on one index key, or the guarantee is decorative.
  it("collapses every gmail alias onto a single index key", () => {
    const keys = [
      "johndoe@gmail.com",
      "john.doe@gmail.com",
      "JohnDoe+unilift@gmail.com",
      "j.o.h.n.d.o.e+2@googlemail.com",
      "  JOHNDOE@GMAIL.COM  ",
    ].map((raw) => emailIndexKey(normalizeEmail(raw)));

    expect(new Set(keys).size).toBe(1);
  });

  // The security half of the provider-gated +tag rule. On a domain with no
  // sub-addressing, collapsing these would mint an account under a mailbox the
  // signer-up does not control.
  it("does not collapse a tagged address onto a stranger's mailbox", () => {
    expect(emailIndexKey(normalizeEmail("john+doe@ulaval.ca"))).not.toBe(
      emailIndexKey(normalizeEmail("john@ulaval.ca")),
    );
  });

  it("produces index keys that are legal Firestore document ids", () => {
    for (const raw of [
      "johndoe@gmail.com",
      "a/b@ulaval.ca",
      "..@ulaval.ca",
      "x".repeat(2000) + "@ulaval.ca",
    ]) {
      const key = emailIndexKey(normalizeEmail(raw));
      expect(key).not.toContain("/");
      expect(key.length).toBeGreaterThan(0);
      expect(key.length).toBeLessThanOrEqual(1000);
    }
  });
});
