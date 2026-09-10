import { Ionicons } from "@expo/vector-icons";
import React, { useEffect } from "react";
import { StyleSheet, View } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSpring,
  withTiming,
} from "react-native-reanimated";

import SlideFrame, { type SlideProps } from "@/components/whats-new/slide-frame";
import { P } from "@/constants/palette";

const BAR_W = 216;
const BAR_H = 34;
const GAP = 12;

const COLLAPSE_DELAY = 320;
const COLLAPSE = 620;

/**
 * The change, shown rather than described: the ride flow used to be a stack of
 * fields across several screens, and now it is one destination and one button.
 *
 * The two upper bars fold down into the third, which then lights up as the
 * destination pill and grows a send button. It is the diff, animated.
 */
export default function RidesSlide({
  active,
  reduceMotion,
  width,
  height,
  topInset,
  eyebrow,
  title,
  body,
}: SlideProps & { eyebrow: string; title: string; body: string }) {
  const collapse = useSharedValue(0);
  const bloom = useSharedValue(0);

  useEffect(() => {
    if (!active) {
      collapse.value = 0;
      bloom.value = 0;
      return;
    }
    if (reduceMotion) {
      collapse.value = 1;
      bloom.value = 1;
      return;
    }
    collapse.value = withDelay(
      COLLAPSE_DELAY,
      withTiming(1, { duration: COLLAPSE, easing: Easing.inOut(Easing.cubic) }),
    );
    bloom.value = withDelay(
      COLLAPSE_DELAY + COLLAPSE - 80,
      withSpring(1, { damping: 12, stiffness: 140 }),
    );
  }, [active, reduceMotion, collapse, bloom]);

  // Rows 0 and 1 drop into row 2's slot as they vanish. Written out rather than
  // generated in a loop so each animated style keeps its own stable hook.
  const row0 = useAnimatedStyle(() => ({
    opacity: 1 - collapse.value,
    transform: [
      { translateY: collapse.value * 2 * (BAR_H + GAP) },
      { scaleY: 1 - collapse.value * 0.85 },
    ],
  }));
  const row1 = useAnimatedStyle(() => ({
    opacity: 1 - collapse.value,
    transform: [
      { translateY: collapse.value * (BAR_H + GAP) },
      { scaleY: 1 - collapse.value * 0.85 },
    ],
  }));

  const pillStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 0.98 + bloom.value * 0.02 }],
    borderColor: `rgba(224, 154, 247, ${0.12 + collapse.value * 0.45})`,
    backgroundColor: `rgba(137, 56, 213, ${0.06 + collapse.value * 0.16})`,
    shadowOpacity: collapse.value * 0.55,
  }));

  const sendStyle = useAnimatedStyle(() => ({
    opacity: bloom.value,
    transform: [{ scale: 0.6 + bloom.value * 0.4 }],
  }));

  const labelStyle = useAnimatedStyle(() => ({ opacity: 0.35 + collapse.value * 0.65 }));

  return (
    <SlideFrame width={width} height={height} topInset={topInset} eyebrow={eyebrow} title={title} body={body}>
      <View style={styles.stack}>
        <Animated.View style={[styles.bar, row0]}>
          <View style={[styles.ghost, { width: 84 }]} />
        </Animated.View>
        <Animated.View style={[styles.bar, row1]}>
          <View style={[styles.ghost, { width: 122 }]} />
        </Animated.View>

        <Animated.View style={[styles.bar, styles.pill, pillStyle]}>
          <Ionicons name="location" size={15} color={P.accentLight} />
          <Animated.View style={[styles.ghost, styles.ghostLit, labelStyle]} />
          <Animated.View style={[styles.send, sendStyle]}>
            <Ionicons name="arrow-forward" size={14} color={P.gradientStart} />
          </Animated.View>
        </Animated.View>
      </View>
    </SlideFrame>
  );
}

const styles = StyleSheet.create({
  stack: { gap: GAP, alignItems: "center" },
  bar: {
    width: BAR_W,
    height: BAR_H,
    borderRadius: 12,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.07)",
  },
  pill: {
    shadowColor: P.accent,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  ghost: { height: 7, borderRadius: 4, backgroundColor: "rgba(255,255,255,0.13)" },
  ghostLit: { flex: 1, backgroundColor: "rgba(224, 154, 247, 0.55)" },
  send: {
    width: 24,
    height: 24,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: P.accentLight,
  },
});
