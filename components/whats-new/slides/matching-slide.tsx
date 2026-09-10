import { Ionicons } from "@expo/vector-icons";
import React, { useEffect } from "react";
import { StyleSheet, View } from "react-native";
import Animated, {
  Easing,
  useAnimatedProps,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSpring,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";
import Svg, { Defs, LinearGradient, Line, Stop } from "react-native-svg";

import SlideFrame, { type SlideProps } from "@/components/whats-new/slide-frame";
import { MARK_GRADIENT_STOPS } from "@/constants/brand-mark";
import { P } from "@/constants/palette";

const AnimatedLine = Animated.createAnimatedComponent(Line);

const AVATAR = 62;
const LINE_W = 104;

/**
 * Matching is mutual, and that is the whole point of the slide.
 *
 * A driver accepting only puts the passenger in `pendingConfirmation[]` — the
 * ride cannot start until the passenger swipes to confirm. So the visual is two
 * confirmations, not a search: the driver's check lands, then yours, and only
 * once both are in does the line between you connect.
 *
 * Deliberately not a radar. The radar already means something specific in this
 * app (`findingDriverScreen` — you are waiting), and reusing it here would say
 * the opposite of "you both choose".
 */
export default function MatchingSlide({
  active,
  reduceMotion,
  width,
  height,
  topInset,
  eyebrow,
  title,
  body,
}: SlideProps & { eyebrow: string; title: string; body: string }) {
  const driverCheck = useSharedValue(0);
  const youCheck = useSharedValue(0);
  const connect = useSharedValue(0);

  useEffect(() => {
    if (!active) {
      driverCheck.value = 0;
      youCheck.value = 0;
      connect.value = 0;
      return;
    }
    if (reduceMotion) {
      driverCheck.value = 1;
      youCheck.value = 1;
      connect.value = 1;
      return;
    }
    const stamp = { damping: 9, stiffness: 190 };
    driverCheck.value = withDelay(280, withSpring(1, stamp));
    youCheck.value = withDelay(760, withSpring(1, stamp));
    connect.value = withDelay(
      1080,
      withTiming(1, { duration: 480, easing: Easing.out(Easing.cubic) }),
    );
  }, [active, reduceMotion, driverCheck, youCheck, connect]);

  const lineProps = useAnimatedProps(() => ({
    strokeDashoffset: LINE_W * (1 - connect.value),
  }));

  return (
    <SlideFrame width={width} height={height} topInset={topInset} eyebrow={eyebrow} title={title} body={body}>
      <View style={styles.row}>
        <Party icon="car-sport" check={driverCheck} />

        <View style={styles.link}>
          <Svg width={LINE_W} height={4}>
            <Defs>
              <LinearGradient id="linkGrad" x1="0" y1="0" x2={LINE_W} y2="0" gradientUnits="userSpaceOnUse">
                {MARK_GRADIENT_STOPS.map((s) => (
                  <Stop key={s.offset} offset={s.offset} stopColor={s.color} />
                ))}
              </LinearGradient>
            </Defs>
            <Line
              x1={0}
              y1={2}
              x2={LINE_W}
              y2={2}
              stroke="rgba(255,255,255,0.12)"
              strokeWidth={2}
              strokeDasharray="4 5"
              strokeLinecap="round"
            />
            <AnimatedLine
              x1={0}
              y1={2}
              x2={LINE_W}
              y2={2}
              stroke="url(#linkGrad)"
              strokeWidth={3}
              strokeLinecap="round"
              strokeDasharray={LINE_W}
              animatedProps={lineProps}
            />
          </Svg>
        </View>

        <Party icon="person" check={youCheck} />
      </View>
    </SlideFrame>
  );
}

function Party({
  icon,
  check,
}: {
  icon: React.ComponentProps<typeof Ionicons>["name"];
  /** 0 → 1 as this party's confirmation lands. */
  check: SharedValue<number>;
}) {
  const badgeStyle = useAnimatedStyle(() => ({
    opacity: check.value,
    transform: [{ scale: check.value }],
  }));

  return (
    <View style={styles.party}>
      <View style={styles.avatar}>
        <Ionicons name={icon} size={26} color={P.accentLight} />
      </View>
      <Animated.View style={[styles.check, badgeStyle]}>
        <Ionicons name="checkmark" size={13} color={P.gradientStart} />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center" },
  link: { width: LINE_W, alignItems: "center", justifyContent: "center" },
  party: { width: AVATAR, height: AVATAR },
  avatar: {
    width: AVATAR,
    height: AVATAR,
    borderRadius: AVATAR / 2,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(137, 56, 213, 0.14)",
    borderWidth: 1,
    borderColor: "rgba(137, 56, 213, 0.38)",
  },
  check: {
    position: "absolute",
    right: -2,
    bottom: -2,
    width: 23,
    height: 23,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: P.success,
    borderWidth: 2,
    borderColor: P.bg,
  },
});
