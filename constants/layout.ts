/**
 * Geometry of the custom tab bar in `app/(tabs)/_layout.tsx`.
 *
 * The bar FLOATS — it is absolutely positioned above the bottom edge rather than
 * occupying layout space — so scrollable tab screens render underneath it and
 * must pad their own content to clear it. Without that padding the last item on
 * the screen sits behind the bar and cannot be read or tapped.
 *
 * These live here rather than in the layout file so a screen can import them
 * without importing a route module, and so the bar and the screens padding
 * around it can never drift apart.
 */

/** Height of the floating bar itself. */
export const TAB_BAR_HEIGHT = 68;

/** Gap between the bottom safe-area edge and the underside of the bar. */
export const TAB_BAR_GAP = 10;

/** Minimum bottom inset assumed on devices that report none (e.g. older Androids). */
const MIN_BOTTOM_INSET = 8;

/**
 * Vertical space the floating tab bar occupies, measured from the bottom of the
 * screen — pass `useSafeAreaInsets().bottom`.
 *
 * Use as `paddingBottom` on a tab screen's scroll content. `extra` adds
 * breathing room so the last row does not sit flush against the bar.
 */
export function tabBarClearance(insetBottom: number, extra = 16): number {
  return Math.max(insetBottom, MIN_BOTTOM_INSET) + TAB_BAR_GAP + TAB_BAR_HEIGHT + extra;
}
