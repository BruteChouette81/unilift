/**
 * Coverage for the shared Firestore REST unwrapping helpers.
 *
 * These were extracted from eight service files that each carried their own
 * copy. That consolidation is a win only if the single implementation is
 * actually correct — every REST read in the app now flows through it, so a
 * regression here is a regression everywhere at once.
 *
 * The contract under test: these are LENIENT. REST responses are external input;
 * a malformed field must degrade to the fallback, never throw.
 */
import {
  isRecord,
  readArray,
  readBoolean,
  readGeoPoint,
  readNumber,
  readString,
} from "../firestore-rest";

describe("isRecord", () => {
  it("accepts plain objects", () => {
    expect(isRecord({})).toBe(true);
    expect(isRecord({ a: 1 })).toBe(true);
  });

  it("rejects null — the case `typeof x === 'object'` alone gets wrong", () => {
    expect(isRecord(null)).toBe(false);
  });

  it("rejects primitives", () => {
    expect(isRecord(undefined)).toBe(false);
    expect(isRecord("x")).toBe(false);
    expect(isRecord(0)).toBe(false);
    expect(isRecord(false)).toBe(false);
  });

  it("accepts arrays, which is intentional (arrayValue.values is indexed)", () => {
    expect(isRecord([])).toBe(true);
  });
});

describe("readString", () => {
  it("passes strings through, including the empty string", () => {
    expect(readString("hello")).toBe("hello");
    expect(readString("")).toBe("");
  });

  it("falls back for every non-string, rather than coercing", () => {
    expect(readString(undefined)).toBe("");
    expect(readString(null)).toBe("");
    expect(readString(42)).toBe("");
    expect(readString({})).toBe("");
  });

  it("honours a custom fallback", () => {
    expect(readString(undefined, "n/a")).toBe("n/a");
  });
});

describe("readNumber", () => {
  it("parses integerValue, which the REST API sends as a STRING", () => {
    expect(readNumber("42")).toBe(42);
    expect(readNumber("-7")).toBe(-7);
  });

  it("passes doubleValue numbers through", () => {
    expect(readNumber(3.5)).toBe(3.5);
    expect(readNumber(0)).toBe(0);
  });

  it("falls back on values that are not finite numbers", () => {
    expect(readNumber(undefined)).toBe(0);
    expect(readNumber(null, 0)).toBe(0);
    expect(readNumber("abc")).toBe(0);
    expect(readNumber(Number.NaN)).toBe(0);
    expect(readNumber(Infinity)).toBe(0);
  });

  it("honours a custom fallback", () => {
    expect(readNumber("abc", -1)).toBe(-1);
    expect(readNumber(undefined, Number.NaN)).toBeNaN();
  });
});

describe("readBoolean", () => {
  it("passes booleans through", () => {
    expect(readBoolean(true)).toBe(true);
    expect(readBoolean(false)).toBe(false);
  });

  it("does NOT coerce truthy/falsy values", () => {
    expect(readBoolean("true")).toBe(false);
    expect(readBoolean(1)).toBe(false);
    expect(readBoolean(undefined)).toBe(false);
  });

  it("honours a custom fallback — the absent-means-true convention", () => {
    expect(readBoolean(undefined, true)).toBe(true);
  });
});

describe("readGeoPoint", () => {
  it("reads a well-formed geoPointValue", () => {
    expect(readGeoPoint({ latitude: 46.8139, longitude: -71.208 })).toEqual({
      latitude: 46.8139,
      longitude: -71.208,
    });
  });

  it("reads coordinates that arrive as strings", () => {
    expect(readGeoPoint({ latitude: "46.8", longitude: "-71.2" })).toEqual({
      latitude: 46.8,
      longitude: -71.2,
    });
  });

  it("accepts the null island rather than treating 0 as missing", () => {
    expect(readGeoPoint({ latitude: 0, longitude: 0 })).toEqual({
      latitude: 0,
      longitude: 0,
    });
  });

  it("returns null when a coordinate is missing or non-numeric", () => {
    expect(readGeoPoint({ latitude: 46.8 })).toBeNull();
    expect(readGeoPoint({ longitude: -71.2 })).toBeNull();
    expect(readGeoPoint({ latitude: "abc", longitude: -71.2 })).toBeNull();
    expect(readGeoPoint({ latitude: 46.8, longitude: undefined })).toBeNull();
  });

  it("PINS a known sharp edge: null/empty coordinates coerce to 0, not null", () => {
    // `Number(null)` is 0, and 0 is finite — so the "both coordinates present"
    // guard does not catch it and the point lands in the Gulf of Guinea.
    //
    // This is pre-existing behaviour inherited from the eight per-service copies
    // this module replaced; it is pinned here so it is visible and so changing
    // it becomes a deliberate decision with a failing test, not a silent drift.
    expect(readGeoPoint({ latitude: 46.8, longitude: null })).toEqual({
      latitude: 46.8,
      longitude: 0,
    });
    expect(readGeoPoint({ latitude: "", longitude: -71.2 })).toEqual({
      latitude: 0,
      longitude: -71.2,
    });
  });

  it("returns null for non-objects", () => {
    expect(readGeoPoint(null)).toBeNull();
    expect(readGeoPoint(undefined)).toBeNull();
    expect(readGeoPoint("46.8,-71.2")).toBeNull();
  });
});

describe("readArray", () => {
  it("passes arrays through", () => {
    expect(readArray([1, 2])).toEqual([1, 2]);
    expect(readArray([])).toEqual([]);
  });

  it("yields [] for anything else, so callers can map without a guard", () => {
    expect(readArray(undefined)).toEqual([]);
    expect(readArray(null)).toEqual([]);
    expect(readArray({})).toEqual([]);
    expect(readArray("abc")).toEqual([]);
  });
});
