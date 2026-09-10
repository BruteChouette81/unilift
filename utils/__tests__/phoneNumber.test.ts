import {
  autoFormatPhoneInput,
  formatPhoneForDisplay,
  isValidPhoneFormat,
  parsePhoneInput,
  smsUri,
  telUri,
} from "../phoneNumber";

describe("parsePhoneInput", () => {
  it("canonicalises every shape a person might type", () => {
    // All of these are the same number. The stored value must not depend on how
    // it was entered — the driver's dialer gets one form regardless.
    for (const input of [
      "5145550142",
      "514 555 0142",
      "(514) 555-0142",
      "514-555-0142",
      "1 (514) 555-0142",
      "+1 514 555 0142",
      "  514.555.0142  ",
    ]) {
      expect(parsePhoneInput(input)).toBe("+15145550142");
    }
  });

  it("returns an empty string for anything unusable", () => {
    // "" is both "blank" and "invalid" on purpose: the caller treats them the
    // same — not ready to save.
    expect(parsePhoneInput("")).toBe("");
    expect(parsePhoneInput("   ")).toBe("");
    expect(parsePhoneInput("514555014")).toBe("");    // 9 digits
    expect(parsePhoneInput("51455501422")).toBe("");  // 11, not country-coded
    expect(parsePhoneInput("not a phone")).toBe("");
  });

  it("rejects area and exchange codes that cannot start a NANP number", () => {
    // 0 and 1 are the operator and long-distance prefixes; neither can begin an
    // NPA or an NXX. This is what makes a typo visible before the call fails.
    expect(parsePhoneInput("1235550142")).toBe("");  // NPA starts with 1
    expect(parsePhoneInput("0145550142")).toBe("");  // NPA starts with 0
    expect(parsePhoneInput("5141550142")).toBe("");  // NXX starts with 1
    expect(parsePhoneInput("5140550142")).toBe("");  // NXX starts with 0
    expect(parsePhoneInput("2125550142")).toBe("+12125550142"); // valid
  });

  it("accepts a country code only when it is 1", () => {
    expect(parsePhoneInput("15145550142")).toBe("+15145550142");
    // 44 is the UK; those 11 digits are not a NANP number with a country code.
    expect(parsePhoneInput("44514555014")).toBe("");
  });
});

describe("isValidPhoneFormat", () => {
  it("agrees with parsePhoneInput on every input", () => {
    for (const input of ["5145550142", "+1 514 555 0142", "", "123", "1235550142"]) {
      expect(isValidPhoneFormat(input)).toBe(parsePhoneInput(input) !== "");
    }
  });
});

describe("formatPhoneForDisplay", () => {
  it("renders a stored E.164 number for a human", () => {
    expect(formatPhoneForDisplay("+15145550142")).toBe("(514) 555-0142");
    expect(formatPhoneForDisplay("5145550142")).toBe("(514) 555-0142");
  });

  it("round-trips with parsePhoneInput", () => {
    const stored = parsePhoneInput("(514) 555-0142");
    expect(parsePhoneInput(formatPhoneForDisplay(stored))).toBe(stored);
  });

  it("returns unrecognised input untouched rather than blanking it", () => {
    // Whoever has to call the number is better served by seeing something odd
    // than by seeing an empty row.
    expect(formatPhoneForDisplay("+44 20 7946 0958")).toBe("+44 20 7946 0958");
    expect(formatPhoneForDisplay("")).toBe("");
  });
});

describe("autoFormatPhoneInput", () => {
  it("builds the mask one digit at a time", () => {
    expect(autoFormatPhoneInput("")).toBe("");
    expect(autoFormatPhoneInput("5")).toBe("(5");
    expect(autoFormatPhoneInput("51")).toBe("(51");
    expect(autoFormatPhoneInput("514")).toBe("(514");
    expect(autoFormatPhoneInput("5145")).toBe("(514) 5");
    expect(autoFormatPhoneInput("514555")).toBe("(514) 555");
    expect(autoFormatPhoneInput("5145550")).toBe("(514) 555-0");
    expect(autoFormatPhoneInput("5145550142")).toBe("(514) 555-0142");
  });

  it("absorbs a pasted country code and stops at ten digits", () => {
    expect(autoFormatPhoneInput("1-514-555-0142")).toBe("(514) 555-0142");
    expect(autoFormatPhoneInput("+1 (514) 555-0142")).toBe("(514) 555-0142");
    expect(autoFormatPhoneInput("51455501429999")).toBe("(514) 555-0142");
  });

  it("never rejects a half-typed number", () => {
    // Formatting mid-entry is purely cosmetic. An invalid prefix still formats —
    // validation happens on save, not on every keystroke, or the field fights
    // the user as they type.
    expect(autoFormatPhoneInput("123")).toBe("(123");
    expect(autoFormatPhoneInput("1235550142")).toBe("(123) 555-0142");
  });

  it("only treats a leading 1 as a country code once 11 digits exist", () => {
    // Ten digits are a complete national number, so the 1 is an area code.
    expect(autoFormatPhoneInput("1514555014")).toBe("(151) 455-5014");
    // The eleventh digit resolves the ambiguity and the mask re-settles.
    expect(autoFormatPhoneInput("15145550142")).toBe("(514) 555-0142");
  });

  it("is idempotent, so re-formatting its own output is stable", () => {
    // The input's value is fed back through this on every keystroke.
    const once = autoFormatPhoneInput("5145550142");
    expect(autoFormatPhoneInput(once)).toBe(once);
  });
});

describe("telUri / smsUri", () => {
  it("build dialer and messaging links from a stored number", () => {
    expect(telUri("+15145550142")).toBe("tel:+15145550142");
    expect(smsUri("+15145550142")).toBe("sms:+15145550142");
  });

  it("return empty for an unusable number so callers can hide the button", () => {
    expect(telUri("")).toBe("");
    expect(smsUri("nonsense")).toBe("");
  });
});
