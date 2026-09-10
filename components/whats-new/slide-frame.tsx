import React from "react";
import { StyleSheet, Text, View } from "react-native";
import Animated from "react-native-reanimated";

import { P } from "@/constants/palette";
import { FONT_CAP } from "@/constants/typography";
import { useResponsive } from "@/hooks/use-responsive";

/** Every slide receives the same three facts from the shell. */
export type SlideProps = {
  /** True while this slide is the one on screen. Visuals play on the rising
   *  edge and reset on the falling one, so going back replays them. */
  active: boolean;
  /** The user has asked the system to reduce motion: hold end states, no
   *  travel, no loops. */
  reduceMotion: boolean;
  /** Page width. Slides are laid out one per page in a paged ScrollView. */
  width: number;
  /**
   * Page height, measured by the shell.
   *
   * Passed explicitly rather than left to `flex: 1`: inside a *horizontal*
   * ScrollView, `flex: 1` grows on the main axis, so five flexing pages would
   * each collapse to a fifth of the viewport instead of filling it.
   */
  height: number;
  /**
   * Top padding: safe-area inset plus room for the skip button.
   *
   * Owned by the page rather than the ScrollView. Padding on a ScrollView's
   * `style` is inconsistent about whether it lands inside or outside the
   * measured frame, and since `height` above comes from that same measurement,
   * getting it wrong pushes the bottom of every page out of sight.
   */
  topInset: number;
};

/**
 * The shared slide layout: an animated visual above, three lines of copy below.
 *
 * The visual gets the flexible space and the copy is bottom-anchored, so the
 * text baseline does not jump between slides as their visuals differ in height.
 */
export default function SlideFrame({
  width,
  height,
  topInset,
  eyebrow,
  title,
  body,
  copyStyle,
  children,
}: {
  width: number;
  height: number;
  topInset: number;
  eyebrow: string;
  title: string;
  body: string;
  /** Optional animated style for the copy block, so a slide can bring its text
   *  in on the beat of its visual instead of having it just be there. */
  copyStyle?: React.ComponentProps<typeof Animated.View>["style"];
  children: React.ReactNode;
}) {
  const { isNarrow } = useResponsive();

  return (
    <View
      style={[
        styles.page,
        { width, height, paddingTop: topInset, paddingHorizontal: isNarrow ? 22 : 30 },
      ]}
    >
      <View
        style={styles.visual}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        {children}
      </View>

      <Animated.View style={[styles.copy, copyStyle]}>
        <Text style={styles.eyebrow} maxFontSizeMultiplier={FONT_CAP.chrome}>
          {eyebrow}
        </Text>
        <Text
          style={[styles.title, isNarrow && styles.titleNarrow]}
          maxFontSizeMultiplier={FONT_CAP.display}
        >
          {title}
        </Text>
        <Text style={styles.body} maxFontSizeMultiplier={FONT_CAP.body}>
          {body}
        </Text>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { justifyContent: "flex-end" },
  // Low minHeight on purpose: the visual is the part that gives up room when a
  // long headline or a large text setting needs it.
  visual: { flex: 1, alignItems: "center", justifyContent: "center", minHeight: 100 },
  // The route strip lives directly below the page. This keeps the last line of
  // body copy clear of the marker as it travels.
  copy: { gap: 10, paddingBottom: 34 },
  // Extends the app's existing eyebrow idiom (see request-lift-sheet), pushed
  // further: 2pt of tracking against a 40pt display line is the widest type
  // contrast in the app, and it is what makes these slides read as an event.
  eyebrow: {
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 2,
    textTransform: "uppercase",
    color: P.accentLight,
  },
  title: {
    fontSize: 40,
    lineHeight: 44,
    fontWeight: "800",
    letterSpacing: -0.8,
    color: P.text,
  },
  titleNarrow: { fontSize: 34, lineHeight: 38 },
  body: {
    fontSize: 15,
    lineHeight: 22,
    fontWeight: "500",
    color: P.textMuted,
  },
});
