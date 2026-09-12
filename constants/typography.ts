/**
 * Type + layout scaling tokens.
 *
 * The ride screens were laid out against one reference device (iPhone 15 Plus at
 * the default text size), so every dense row assumed it had ~430pt of width and
 * that a 12pt badge would stay 12pt. Neither holds on a 390pt iPhone 14 with
 * Larger Text on, and the French strings — 20-30% longer than the English ones —
 * make it worse.
 *
 * Uniform font scaling preserves type *ratios* but not readability, because the
 * containers don't grow with the text. Capping dense chrome harder than display
 * text actually widens the hierarchy at large sizes, which is what keeps a
 * scaled-up screen reading as designed rather than as crammed. So the ceilings
 * below are assigned by role, not by one global number.
 */

/** Ceilings for system font scaling, by text role. Applied per-element via
 *  `<Text maxFontSizeMultiplier={...}>`. */
export const FONT_CAP = {
  /** Badges, pills, chips, captions, stat labels — fixed-shape containers that
   *  cannot reflow, so their text has to stop growing early. */
  chrome: 1.35,
  /** Card labels, list rows, subtitles — containers reflow, so there is room. */
  body: 1.6,
  /** Button and CTA labels. Slightly tighter than body: buttons keep a fixed
   *  footprint at the bottom of a panel and every extra line pushes content off. */
  action: 1.5,
  /** Screen titles and large numeric values. Already large; scaling them the
   *  full amount overwhelms everything around them. */
  display: 1.5,
} as const;


/** Below this width the layout is on an iPhone SE / mini / 8-class screen and
 *  the standard 16-22pt horizontal padding costs more than it buys. */
export const NARROW_WIDTH = 380;

/** Above this font scale a label-plus-badge row has no honest way to stay a row;
 *  it stacks instead. Roughly the first iOS Accessibility text size. */
export const STACK_THRESHOLD = 1.35;
