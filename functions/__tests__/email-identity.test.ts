/**
 * The two email canonicalisers must agree, always.
 *
 * `utils/emailIdentity.ts` runs in the app; `functions/email-identity.js` runs
 * in the `beforeUserCreated` blocking function. They exist separately only
 * because Cloud Functions cannot import the TypeScript module — and if they
 * ever disagree, the "one mailbox, one account" guarantee silently stops
 * holding: the client canonicalises an address one way, the server records the
 * index entry another, and the next alias slips through.
 *
 * So this is not a test of either implementation's correctness. It is a test
 * that they are the same implementation. Change one, and this fails until you
 * change the other.
 */
import { normalizeEmail as clientNormalize } from "@/utils/emailIdentity";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { normalizeEmail: serverNormalize, emailIndexKey } = require("../email-identity");

/**
 * Every shape that has ever mattered, plus the edges the client tests pin.
 * Add a case here when you add one to `utils/__tests__/emailIdentity.test.ts`.
 */
const FIXTURES = [
  // Plain
  "johndoe@gmail.com",
  "  John.Doe@Ulaval.CA ",
  "JOHN@ULAVAL.CA",
  // Gmail alias forms
  "john.doe@gmail.com",
  "j.o.h.n.d.o.e@gmail.com",
  "JohnDoe+unilift@gmail.com",
  "j.o.h.n.d.o.e+2@googlemail.com",
  "john.doe@googlemail.com",
  // Providers that do implement sub-addressing
  "john+1+2@outlook.com",
  "john+uni@icloud.com",
  "john+uni@proton.me",
  "john+x@hotmail.com",
  "john+x@fastmail.com",
  // Providers that do not — the tag must survive
  "john+doe@ulaval.ca",
  "john+1@usherbrooke.ca",
  "john+2@umontreal.ca",
  "etudiant+test@cegepsherbrooke.qc.ca",
  // Dots outside gmail are significant
  "john.doe@ulaval.ca",
  // Degenerate / unparseable
  "",
  "   ",
  "NotAnEmail",
  "john@",
  "@gmail.com",
  "+tag@gmail.com",
  "...@gmail.com",
  "a@b+c@gmail.com",
  "john@@gmail.com",
  // Case and whitespace
  "\tJohn@Gmail.Com\n",
];

describe("client and server canonicalisers agree", () => {
  it.each(FIXTURES)("agrees on %j", (raw) => {
    expect(serverNormalize(raw)).toBe(clientNormalize(raw));
  });

  it("agrees that every alias of one gmail mailbox is one string", () => {
    const aliases = [
      "johndoe@gmail.com",
      "john.doe@gmail.com",
      "JohnDoe+unilift@gmail.com",
      "j.o.h.n.d.o.e+2@googlemail.com",
    ];
    const canonical = aliases.map(serverNormalize);
    expect(new Set(canonical).size).toBe(1);
    expect(canonical[0]).toBe(clientNormalize(aliases[0]));
  });

  it("agrees that a tagged address on a plain domain is its own mailbox", () => {
    expect(serverNormalize("john+doe@ulaval.ca")).not.toBe(
      serverNormalize("john@ulaval.ca"),
    );
    expect(serverNormalize("john+doe@ulaval.ca")).toBe(
      clientNormalize("john+doe@ulaval.ca"),
    );
  });
});

describe("emailIndexKey", () => {
  it("leaves an ordinary address untouched, so index keys stay readable", () => {
    expect(emailIndexKey("johndoe@gmail.com")).toBe("johndoe@gmail.com");
  });

  it("escapes the one character Firestore forbids in a document id", () => {
    // A slash is legal in a quoted local part and would otherwise create a
    // subcollection path instead of a document.
    expect(emailIndexKey('a/b@ulaval.ca')).toBe("a%2Fb@ulaval.ca");
    expect(emailIndexKey('a/b@ulaval.ca')).not.toContain("/");
  });

  it("stays inside Firestore's document-id length limit", () => {
    const long = "a".repeat(2000) + "@ulaval.ca";
    expect(emailIndexKey(long).length).toBeLessThanOrEqual(1000);
  });
});
