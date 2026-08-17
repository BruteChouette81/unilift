export const PASSWORD_MIN_LENGTH = 8;

export type PasswordRequirementKey = "minLength" | "upper" | "lower" | "number" | "special";

export type PasswordRequirement = {
  key: PasswordRequirementKey;
  met: boolean;
};

// Any keyboard character that isn't a letter, digit, or whitespace — e.g.
// !@#$%^&*()_+-=[]{};':"\|,.<>/?`~
const SPECIAL_CHAR_REGEX = /[^A-Za-z0-9\s]/;

/** Signup password policy, checked client-side so users see what's missing
 *  before submitting — Firebase's own weak-password rule only rejects
 *  passwords under 6 characters, which is too permissive on its own. */
export function getPasswordRequirements(password: string): PasswordRequirement[] {
  return [
    { key: "minLength", met: password.length >= PASSWORD_MIN_LENGTH },
    { key: "upper", met: /[A-Z]/.test(password) },
    { key: "lower", met: /[a-z]/.test(password) },
    { key: "number", met: /[0-9]/.test(password) },
    { key: "special", met: SPECIAL_CHAR_REGEX.test(password) },
  ];
}

export function isPasswordValid(password: string): boolean {
  return getPasswordRequirements(password).every((r) => r.met);
}
