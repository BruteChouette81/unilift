import {
  emailSignInCandidates,
  isValidEmailFormat,
  normalizeEmail,
} from "../emailIdentity";

describe("normalizeEmail", () => {
  it("trims and lowercases", () => {
    expect(normalizeEmail("  John.Doe@Ulaval.CA ")).toBe("john.doe@ulaval.ca");
  });

  it("strips the +tag sub-address on providers that implement it", () => {
    expect(normalizeEmail("john+uni@gmail.com")).toBe("john@gmail.com");
    expect(normalizeEmail("john+1+2@outlook.com")).toBe("john@outlook.com");
    expect(normalizeEmail("john+uni@icloud.com")).toBe("john@icloud.com");
    expect(normalizeEmail("john+uni@proton.me")).toBe("john@proton.me");
  });

  // The security half of the rule. On a domain with no sub-addressing,
  // `john+doe@ulaval.ca` is undeliverable — stripping the tag would mint an
  // account under `john@ulaval.ca`, a real mailbox belonging to someone else.
  it("leaves +tags alone on domains that do not implement sub-addressing", () => {
    expect(normalizeEmail("john+doe@ulaval.ca")).toBe("john+doe@ulaval.ca");
    expect(normalizeEmail("john+1@usherbrooke.ca")).toBe("john+1@usherbrooke.ca");
  });

  it("never canonicalises a tagged address onto someone else's mailbox", () => {
    expect(normalizeEmail("john+doe@ulaval.ca")).not.toBe(normalizeEmail("john@ulaval.ca"));
  });

  it("ignores dots on gmail only", () => {
    expect(normalizeEmail("j.o.h.n.doe@gmail.com")).toBe("johndoe@gmail.com");
    expect(normalizeEmail("john.doe@ulaval.ca")).toBe("john.doe@ulaval.ca");
  });

  it("folds googlemail onto gmail", () => {
    expect(normalizeEmail("john.doe@googlemail.com")).toBe("johndoe@gmail.com");
  });

  it("collapses every alias of one mailbox to one string", () => {
    const canonical = "johndoe@gmail.com";
    for (const alias of [
      "johndoe@gmail.com",
      "john.doe@gmail.com",
      "JohnDoe+unilift@gmail.com",
      "j.o.h.n.d.o.e+2@googlemail.com",
    ]) {
      expect(normalizeEmail(alias)).toBe(canonical);
    }
  });

  it("keeps distinct mailboxes distinct", () => {
    expect(normalizeEmail("john@gmail.com")).not.toBe(normalizeEmail("jhon@gmail.com"));
    expect(normalizeEmail("john@gmail.com")).not.toBe(normalizeEmail("john@ulaval.ca"));
  });

  it("never invents an empty local part", () => {
    expect(normalizeEmail("+tag@gmail.com")).toBe("+tag@gmail.com");
    expect(normalizeEmail("...@gmail.com")).toBe("...@gmail.com");
  });

  it("passes unparseable input through for Firebase to reject", () => {
    expect(normalizeEmail(" NotAnEmail ")).toBe("notanemail");
    expect(normalizeEmail("john@")).toBe("john@");
    expect(normalizeEmail("@gmail.com")).toBe("@gmail.com");
  });

  it("splits on the last @", () => {
    expect(normalizeEmail("a@b+c@gmail.com")).toBe("a@b@gmail.com");
  });
});

describe("emailSignInCandidates", () => {
  it("returns a single attempt when the address is already canonical", () => {
    expect(emailSignInCandidates("johndoe@gmail.com")).toEqual(["johndoe@gmail.com"]);
  });

  it("tries the typed address before the canonical one", () => {
    expect(emailSignInCandidates("John.Doe+uni@gmail.com")).toEqual([
      "john.doe+uni@gmail.com",
      "johndoe@gmail.com",
    ]);
  });
});

describe("isValidEmailFormat", () => {
  it.each(["a@b.ca", "john.doe+uni@ulaval.ca", " john@gmail.com "])(
    "accepts %s",
    (value) => expect(isValidEmailFormat(value)).toBe(true),
  );

  it.each(["", "john", "john@", "@gmail.com", "john@gmail", "jo hn@gmail.com", "john@@gmail.com"])(
    "rejects %s",
    (value) => expect(isValidEmailFormat(value)).toBe(false),
  );
});
