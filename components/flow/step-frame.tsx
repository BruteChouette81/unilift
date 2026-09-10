import React from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";

import { P } from "@/constants/palette";
import { FONT_CAP } from "@/constants/typography";
import { useResponsive } from "@/hooks/use-responsive";

/** Every page receives the same geometry from the shell. */
export type StepPageProps = {
  /** Page width. Pages are laid out one per page in a paged ScrollView. */
  width: number;
  /**
   * Page height, owned by the shell.
   *
   * Passed explicitly rather than left to `flex: 1`: inside a *horizontal*
   * ScrollView `flex: 1` grows along the main axis, so eight flexing pages
   * would each collapse to an eighth of the viewport instead of filling it.
   * (Same trap as `components/whats-new/slide-frame.tsx`.)
   */
  height: number;
  /** Safe-area inset plus room for the back chevron and language toggle. */
  topInset: number;
  /** Hold end states instead of playing anything. */
  reduceMotion: boolean;
};

/**
 * One question, one answer.
 *
 * The layout is deliberately the same on all eight pages — question, one line
 * of reason, one field — so that moving through the flow feels like one screen
 * changing its mind rather than eight different screens. Nothing here is
 * centred: the questions read as speech, and a ragged right edge makes a
 * two-line headline look intended rather than like a brochure.
 *
 * The CTA is **not** here. It lives in the shell's footer alongside the route
 * progress, because that footer is the one thing that has to move when the
 * keyboard opens — see the note in `app/(auth)/signup.tsx`.
 */
export default function StepFrame({
  width,
  height,
  topInset,
  ask,
  aside,
  children,
}: {
  width: number;
  height: number;
  topInset: number;
  ask: string;
  aside: string;
  children?: React.ReactNode;
}) {
  const { isNarrow } = useResponsive();

  return (
    <View style={[styles.page, { width, height, paddingTop: topInset }]}>
      {/* Scrolls only when it has to — a long French question at the largest
          text size, or a short screen with the keyboard up. At default settings
          there is nothing to scroll and it behaves as a static column. */}
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingHorizontal: isNarrow ? 22 : 28 },
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        // The pager owns horizontal movement; this list must never claim a
        // diagonal drag and swallow the page turn.
        directionalLockEnabled
      >
        <Text
          style={[styles.ask, isNarrow && styles.askNarrow]}
          maxFontSizeMultiplier={FONT_CAP.display}
          accessibilityRole="header"
        >
          {ask}
        </Text>

        <Text style={styles.aside} maxFontSizeMultiplier={FONT_CAP.body}>
          {aside}
        </Text>

        <View style={styles.slot}>{children}</View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flexDirection: "column" },
  content: { flexGrow: 1, paddingBottom: 16 },
  ask: {
    fontSize: 38,
    lineHeight: 42,
    fontWeight: "800",
    letterSpacing: -0.8,
    color: P.text,
  },
  askNarrow: { fontSize: 32, lineHeight: 36 },
  aside: {
    marginTop: 14,
    fontSize: 15,
    lineHeight: 22,
    fontWeight: "500",
    color: P.textMuted,
    // Keeps the reason line short enough to take in at a glance; the question
    // above it is allowed to run the full width.
    maxWidth: 460,
  },
  slot: { marginTop: 36 },
});
