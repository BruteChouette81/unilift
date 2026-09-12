import { Ionicons } from "@expo/vector-icons";
import React, { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import Svg, { Rect } from "react-native-svg";

import SlideFrame, { type SlideProps } from "@/components/whats-new/slide-frame";
import { CERT_META, type CertTier } from "@/constants/certifications";
import { FONT_CAP } from "@/constants/typography";

const RUNG = 26;

/**
 * The trust ladder, climbing: Adult first, Student above it.
 *
 * Both chips are drawn with a **dashed** border and no fill. That is not a
 * style choice — certification is not live (`CERTIFICATION_ENABLED` is false,
 * and the `/cert/*` routes exist only on the sandbox server), so the badges are
 * outlines of something to earn rather than something earned. The eyebrow says
 * "coming next" and the visual has to agree with it.
 *
 * This slide deliberately SHIPS while the feature does not: it is a roadmap
 * teaser, and the dashed treatment plus the eyebrow are what keep it honest. If
 * the copy is ever changed to imply badges are available now, pull the slide
 * instead.
 *
 * Colours and icons come from `CERT_META` so the preview here cannot drift from
 * the badges the app will actually render.
 */
export default function CertificationSlide({
  active,
  reduceMotion,
  width,
  height,
  topInset,
  eyebrow,
  title,
  body,
  adultLabel,
  studentLabel,
}: SlideProps & {
  eyebrow: string;
  title: string;
  body: string;
  adultLabel: string;
  studentLabel: string;
}) {
  const adult = useSharedValue(0);
  const rung = useSharedValue(0);
  const student = useSharedValue(0);

  useEffect(() => {
    if (!active) {
      adult.value = 0;
      rung.value = 0;
      student.value = 0;
      return;
    }
    if (reduceMotion) {
      adult.value = 1;
      rung.value = 1;
      student.value = 1;
      return;
    }
    const stamp = { damping: 9, stiffness: 175 };
    adult.value = withDelay(260, withSpring(1, stamp));
    rung.value = withDelay(
      560,
      withTiming(1, { duration: 300, easing: Easing.out(Easing.cubic) }),
    );
    student.value = withDelay(780, withSpring(1, stamp));
  }, [active, reduceMotion, adult, rung, student]);

  const studentStyle = useAnimatedStyle(() => ({
    opacity: student.value,
    transform: [{ scale: 0.72 + student.value * 0.28 }],
  }));
  const rungStyle = useAnimatedStyle(() => ({ transform: [{ scaleY: rung.value }] }));
  const adultStyle = useAnimatedStyle(() => ({
    opacity: adult.value,
    transform: [{ scale: 0.72 + adult.value * 0.28 }],
  }));

  return (
    <SlideFrame width={width} height={height} topInset={topInset} eyebrow={eyebrow} title={title} body={body}>
      <View style={styles.ladder}>
        <Animated.View style={studentStyle}>
          <Chip tier="student" label={studentLabel} />
        </Animated.View>

        <Animated.View style={[styles.rung, rungStyle]} />

        <Animated.View style={adultStyle}>
          <Chip tier="adult" label={adultLabel} />
        </Animated.View>
      </View>
    </SlideFrame>
  );
}

function Chip({ tier, label }: { tier: CertTier; label: string }) {
  const meta = CERT_META[tier];
  const [size, setSize] = useState({ w: 0, h: 0 });

  return (
    <View
      style={styles.chip}
      onLayout={(e) =>
        setSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })
      }
    >
      {/* Drawn as SVG rather than `borderStyle: "dashed"`, which iOS silently
          renders solid as soon as the border is rounded. */}
      {size.w > 0 && (
        <Svg width={size.w} height={size.h} style={StyleSheet.absoluteFill}>
          <Rect
            x={0.75}
            y={0.75}
            width={size.w - 1.5}
            height={size.h - 1.5}
            rx={(size.h - 1.5) / 2}
            fill="none"
            stroke={meta.color + "99"}
            strokeWidth={1.5}
            strokeDasharray="5 4"
          />
        </Svg>
      )}
      <Ionicons
        name={meta.icon as keyof typeof Ionicons.glyphMap}
        size={16}
        color={meta.color}
      />
      <Text
        style={[styles.chipLabel, { color: meta.color }]}
        maxFontSizeMultiplier={FONT_CAP.chrome}
      >
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  ladder: { alignItems: "center" },
  rung: {
    width: 2,
    height: RUNG,
    borderRadius: 1,
    backgroundColor: "rgba(255,255,255,0.16)",
  },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 18,
    paddingVertical: 11,
  },
  chipLabel: { fontSize: 13, fontWeight: "700", letterSpacing: 0.2 },
});
