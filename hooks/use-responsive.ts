import { useMemo } from "react";
import { useWindowDimensions } from "react-native";

import { NARROW_WIDTH, STACK_THRESHOLD } from "@/constants/typography";

type Responsive = {
  width: number;
  height: number;
  /** The user's system text-size multiplier. 1 at the default setting. */
  fontScale: number;
  /** iPhone SE / mini / 8-class width — trim horizontal padding. */
  isNarrow: boolean;
  /** The user has pushed text past the standard range: dense label+badge rows
   *  should stop trying to be rows and stack instead. */
  shouldStack: boolean;
  /** Grow a fixed-size box (icon tile, avatar slot) with the text, but
   *  sub-linearly and capped, so a 26pt tile tracks the type without ever
   *  becoming a 52pt tile. */
  scaleBox: (base: number, maxFactor?: number) => number;
  /** Vertical budget for a bottom panel or sheet, as a fraction of the window. */
  panelMaxHeight: (fraction: number) => number;
};

/**
 * Device + text-size facts for layout decisions.
 *
 * Built on `useWindowDimensions` rather than `Dimensions.get()` so the values
 * are reactive: a module-scope `Dimensions.get()` snapshot is captured once at
 * import and misses rotation, split view, and — the case that matters here —
 * the user changing their text size while the app is backgrounded.
 */
export function useResponsive(): Responsive {
  const { width, height, fontScale } = useWindowDimensions();

  return useMemo(() => ({
    width,
    height,
    fontScale,
    isNarrow: width < NARROW_WIDTH,
    shouldStack: fontScale > STACK_THRESHOLD,
    scaleBox: (base: number, maxFactor = 1.4) =>
      Math.round(base * Math.min(1 + (fontScale - 1) * 0.5, maxFactor)),
    panelMaxHeight: (fraction: number) => Math.round(height * fraction),
  }), [width, height, fontScale]);
}
