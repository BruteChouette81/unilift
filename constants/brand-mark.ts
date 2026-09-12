/**
 * The UniLift mark, as vector data.
 *
 * The logo is a "U" whose right stem terminates in an upward arrow — the
 * "lift". It is drawn, not imported: `assets/images/icon.png` is the raster
 * app icon, but every in-app appearance of the mark is this SVG so it can be
 * animated (the splash draws it stroke-first) and tinted.
 *
 * Both the launch splash (`components/SplashAnimation.tsx`) and the release
 * takeover (`components/whats-new/`) render from these constants. They lived
 * inline in the splash first; they moved here the moment a second caller
 * appeared, because 40 lines of hand-tuned path data is exactly the kind of
 * thing that silently drifts once it is duplicated.
 *
 * All coordinates are in a 200×200 viewBox.
 */

/** viewBox side length. Every coordinate below assumes this. */
export const MARK_VIEWBOX = 200;

/**
 * The filled outline of the mark.
 *
 * Arrow side vector AB=(32,-40), len≈51.23, unit≈(0.6247,-0.7809).
 * Wing corners are rounded at r=6, the tip at r=10.
 */
export const U_PATH =
  'M 40,40 ' +
  'L 78,40 ' +                                    // flat top on left arm
  'L 78,122 ' +                                   // down inner-left
  'A 22,22 0 0,0 122,122 ' +                     // inner arc
  'L 122,69 ' +                                   // up inner-right to arrow base
  'L 115,69 ' +                                   // stop 6 before left wing corner
  'Q 109,69 112.75,64.31 ' +                     // round left wing corner (r=6)
  'L 134.75,36.81 ' +                             // stop 10 before tip
  'Q 141,29 147.25,36.81 ' +                     // round tip (r=10)
  'L 169.25,64.31 ' +                             // stop 6 before right wing corner
  'Q 173,69 167,69 ' +                            // round right wing corner (r=6)
  'L 160,69 ' +                                   // back to outer-right arm
  'L 160,122 ' +                                  // down outer-right
  'A 60,60 0 0,1 40,122 ' +                      // outer arc
  'Z';

/**
 * The centreline of the mark: top of the left arm, down, around the bowl, up
 * the right arm and out through the arrow tip. Stroking this at
 * `MARK_STROKE_WIDTH` and clipping to `U_PATH` reproduces the filled shape,
 * which is what lets the logo draw itself via `strokeDashoffset`.
 */
export const U_STROKE_PATH =
  'M 59,40 ' +
  'L 59,122 ' +
  'A 41,41 0 0,0 141,122 ' +
  'L 141,29';   // all the way to arrow tip

/**
 * Just the arrowhead — the wings and tip lifted out of `U_PATH` unchanged, so
 * it stays pixel-identical to the top of the full mark.
 *
 * As authored it points **up**, like the logo. To point it along a route
 * running left-to-right, render it with `ARROW_HEAD_RIGHT_VIEWBOX` and apply
 * `ARROW_HEAD_RIGHT_TRANSFORM`.
 */
export const ARROW_HEAD_PATH =
  'M 115,69 ' +
  'Q 109,69 112.75,64.31 ' +
  'L 134.75,36.81 ' +
  'Q 141,29 147.25,36.81 ' +
  'L 169.25,64.31 ' +
  'Q 173,69 167,69 ' +
  'Z';

/** Square viewBox framing the arrowhead once rotated to point right. */
export const ARROW_HEAD_RIGHT_VIEWBOX = '111 19 68 68';

/** Rotation that turns the up-pointing arrowhead into a right-pointing one,
 *  about the centre of the unrotated glyph. */
export const ARROW_HEAD_RIGHT_TRANSFORM = 'rotate(90 141 53)';

/** Total length of `U_STROKE_PATH`: left arm 82 + semi-arc π×41≈129 + right
 *  arm & arrow 93 ≈ 304, rounded up so the dash fully clears the tip. */
export const MARK_STROKE_LENGTH = 315;

/** Stroke width that makes `U_STROKE_PATH` fill `U_PATH`. */
export const MARK_STROKE_WIDTH = 38;

/**
 * Fraction of the stroke animation at which the drawing head enters the arrow.
 *
 * Path distance to the arrow base is 82+129+53 = 264 of 315 ≈ 83.8%. Under
 * `Easing.inOut(cubic)` that lands at t≈0.657; 0.66 is used so the wings fill
 * in step with the stroke arriving rather than a frame after it.
 */
export const MARK_ARROW_SECTION_T = 0.66;

/** The grey the mark sits on before it is drawn. */
export const MARK_BASE_COLOUR = '#383838';

/**
 * The brand ramp: purple → magenta → hot pink, top to bottom.
 *
 * This is the fullest statement of the brand and it is deliberately rationed —
 * `#C428C0` appears nowhere else in the app. Spend it on moments, not chrome.
 */
export const MARK_GRADIENT_STOPS = [
  { offset: '0', color: '#8938D5' },
  { offset: '0.5', color: '#C428C0' },
  { offset: '1', color: '#FD165A' },
] as const;

/** Vertical extent of the gradient in viewBox units, matching the mark's own
 *  top (y=40) and bottom (y=163) so the ramp spans exactly the glyph. */
export const MARK_GRADIENT_Y = { from: 40, to: 163 } as const;
