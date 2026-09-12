/**
 * The recurring UniLift colour tokens, in one place.
 *
 * ## Why this exists, and what it does NOT replace
 *
 * Screens keep their own local `const C = { ... }` token object — that per-screen
 * convention is deliberate and stays. What changed is where the *values* come
 * from: a screen's `C` should reference these tokens rather than repeat a raw hex
 * literal, so a brand tweak is a one-file change instead of a 38-file one.
 *
 *   const C = {
 *     bg: P.bg,
 *     surface: P.surface,
 *     accent: P.accent,
 *     screenSpecificThing: "#123456",   // still fine — local additions belong here
 *   };
 *
 * Only colours that appeared in several screens are listed. A one-off shade used
 * by a single screen belongs in that screen's `C`, not here.
 *
 * Casing is preserved exactly as the codebase already wrote it, so migrating a
 * screen is a value-preserving substitution rather than a visual change.
 */
export const P = {
  // ── Surfaces (darkest → lightest) ──────────────────────────────────────────
  /** App background. */
  bg: "#080810",
  /** Card / sheet surface. */
  surface: "#0f0f1e",
  /** Raised surface — rows, inputs, chips on top of `surface`. */
  surfaceRaised: "#13132a",
  /** Deep navy used by a few map/overlay panels. */
  surfaceDeep: "#0d1224",
  /** Indigo backdrop for highlighted blocks. */
  surfaceIndigo: "#1e1b4b",

  // ── Brand ─────────────────────────────────────────────────────────────────
  /** Primary purple — buttons, active states. */
  accent: "#8938D5",
  /** Light purple — links, emphasis text on dark. */
  accentLight: "#e09af7",
  /** Mid purple — secondary emphasis. */
  accentSoft: "#a78bfa",
  /** Deep violet — gradient partner / pressed states. */
  accentDeep: "#7C3AED",
  /** Hot pink — the Hype accent. */
  hype: "#FD165A",

  // ── Gradient stops ────────────────────────────────────────────────────────
  /** Auth/hero gradient start (maroon). */
  gradientStart: "#2d0015",
  /** Auth/hero gradient end (indigo). */
  gradientEnd: "#1c0038",

  // ── Text ──────────────────────────────────────────────────────────────────
  /** Primary text on dark. */
  text: "#f3f4f6",
  /** Secondary / muted text. */
  textMuted: "#9ca3af",
  /** Tertiary / disabled text and hairlines. */
  textDim: "#4b5563",
  /** Pure white — used where the design wants no warmth at all. */
  white: "#ffffff",

  // ── Status ────────────────────────────────────────────────────────────────
  /** Success / earnings green. */
  success: "#34d399",
  /** Warning / XP amber. */
  warning: "#fbbf24",
  /** Soft red — non-blocking errors, cancel affordances. */
  danger: "#f87171",
  /** Strong red — destructive confirmation. */
  dangerStrong: "#ef4444",
  /** Orange — flames / hype intensity. */
  flame: "#f97316",
  /** Info blue. */
  info: "#60a5fa",

  // ── Contact ───────────────────────────────────────────────────────────────
  /**
   * Electric cyan — the phone-number surfaces, and nothing else.
   *
   * Every other hue here is already spoken for: purple is brand chrome, pink is
   * Hype, green is driver mode, gold is XP, red is danger, orange is flame, blue
   * is info. Cyan was the one gap, which is why a card wearing it is legible as
   * a different object across a screenful of purple before you read a word of
   * it. It is also the right hue for the job — a lit phone screen at night, and
   * the colour every interface reaches for to say a line is open.
   *
   * Reserved. Using it for anything but contact costs the card its whole
   * identity.
   */
  signal: "#2DE2F0",
} as const;

export type PaletteToken = keyof typeof P;
