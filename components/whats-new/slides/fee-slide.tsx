import React, { useEffect } from "react";
import { StyleSheet, Text, View } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSpring,
  withTiming,
} from "react-native-reanimated";

import { type SlideProps } from "@/components/whats-new/slide-frame";
import { FONT_CAP } from "@/constants/typography";
import { useResponsive } from "@/hooks/use-responsive";

/** Ink for text sitting on the brand ramp. The same maroon the app already
 *  pairs with light purple on the active-ride banner. */
const INK = "#2d0015";

/**
 * The finale, and the only inverted screen in the app.
 *
 * The brand ramp has been rationed to a 2pt route line for four slides
 * specifically so that releasing it here — full bleed, type flipped to dark on
 * bright — registers as an event. The shell owns the gradient itself, because
 * it cross-fades in across the last page transition; this slide only owns what
 * sits on top of it.
 *
 * The footnote is not fine print for its own sake. `constants/pricing.ts` has a
 * single fare rate that is both charged and credited, and Stripe's fee is
 * grossed up at settlement rather than deducted — so "no cut" is exactly true,
 * and naming the one thing that *is* added keeps it that way.
 */
export default function FeeSlide({
  active,
  reduceMotion,
  width,
  height,
  topInset,
  eyebrow,
  title,
  body,
  footnote,
}: SlideProps & {
  eyebrow: string;
  title: string;
  body: string;
  footnote: string;
}) {
  const { isNarrow } = useResponsive();
  const pop = useSharedValue(0);
  const copy = useSharedValue(0);

  useEffect(() => {
    if (!active) {
      pop.value = 0;
      copy.value = 0;
      return;
    }
    if (reduceMotion) {
      pop.value = 1;
      copy.value = 1;
      return;
    }
    pop.value = withDelay(160, withSpring(1, { damping: 11, stiffness: 130 }));
    copy.value = withDelay(
      420,
      withTiming(1, { duration: 420, easing: Easing.out(Easing.cubic) }),
    );
  }, [active, reduceMotion, pop, copy]);

  const numeralStyle = useAnimatedStyle(() => ({
    opacity: pop.value,
    transform: [{ scale: 0.82 + pop.value * 0.18 }],
  }));
  const copyStyle = useAnimatedStyle(() => ({
    opacity: copy.value,
    transform: [{ translateY: (1 - copy.value) * 10 }],
  }));

  return (
    <View
      style={[
        styles.page,
        { width, height, paddingTop: topInset, paddingHorizontal: isNarrow ? 22 : 30 },
      ]}
    >
      <View style={styles.numeralBox}>
        <Animated.Text
          style={[styles.numeral, isNarrow && styles.numeralNarrow, numeralStyle]}
          maxFontSizeMultiplier={FONT_CAP.display}
        >
          0%
        </Animated.Text>
      </View>

      <Animated.View style={[styles.copy, copyStyle]}>
        <Text style={styles.eyebrow} maxFontSizeMultiplier={FONT_CAP.chrome}>
          {eyebrow}
        </Text>
        <Text style={styles.title} maxFontSizeMultiplier={FONT_CAP.display}>
          {title}
        </Text>
        <Text style={styles.body} maxFontSizeMultiplier={FONT_CAP.body}>
          {body}
        </Text>
        <Text style={styles.footnote} maxFontSizeMultiplier={FONT_CAP.body}>
          {footnote}
        </Text>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { justifyContent: "flex-end" },
  numeralBox: { flex: 1, alignItems: "center", justifyContent: "center", minHeight: 140 },
  numeral: {
    fontSize: 112,
    lineHeight: 122,
    fontWeight: "900",
    letterSpacing: -5,
    color: INK,
  },
  numeralNarrow: { fontSize: 92, lineHeight: 100, letterSpacing: -4 },
  copy: { gap: 10, paddingBottom: 34 },
  eyebrow: {
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 2,
    textTransform: "uppercase",
    color: "rgba(45,0,21,0.62)",
  },
  title: {
    fontSize: 27,
    lineHeight: 32,
    fontWeight: "800",
    letterSpacing: -0.5,
    color: INK,
  },
  body: { fontSize: 15, lineHeight: 22, fontWeight: "600", color: "rgba(45,0,21,0.82)" },
  footnote: { fontSize: 12, lineHeight: 17, fontWeight: "500", color: "rgba(45,0,21,0.58)" },
});
