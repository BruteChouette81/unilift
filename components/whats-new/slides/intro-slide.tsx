import React, { useEffect } from "react";
import { StyleSheet, View } from "react-native";
import Animated, {
  Easing,
  useAnimatedProps,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from "react-native-reanimated";
import Svg, { ClipPath, Defs, LinearGradient, Path, Stop } from "react-native-svg";

import {
  MARK_ARROW_SECTION_T,
  MARK_GRADIENT_STOPS,
  MARK_GRADIENT_Y,
  MARK_STROKE_LENGTH,
  MARK_STROKE_WIDTH,
  MARK_VIEWBOX,
  U_PATH,
  U_STROKE_PATH,
} from "@/constants/brand-mark";
import SlideFrame, { type SlideProps } from "@/components/whats-new/slide-frame";
import { useResponsive } from "@/hooks/use-responsive";

const AnimatedPath = Animated.createAnimatedComponent(Path);

const SIZE = 188;
const SIZE_NARROW = 152;
const DELAY = 120;
const DRAW = 1100;

/** The copy arrives as the drawing head enters the arrow, not after the mark
 *  finishes — overlapping the two makes the opening read as one gesture rather
 *  than as an animation followed by some text. */
const COPY_IN = DELAY + DRAW * MARK_ARROW_SECTION_T;

/**
 * Opens on the mark drawing itself — the same gesture as the launch splash, so
 * the release sequence starts on something the user already recognises as
 * "UniLift is starting".
 *
 * Shorter than the splash (1.1s vs 1.8s): the splash is covering a cold start,
 * this one is covering nothing and only has to register.
 */
export default function IntroSlide({
  active,
  reduceMotion,
  width,
  height,
  topInset,
  eyebrow,
  title,
  body,
}: SlideProps & { eyebrow: string; title: string; body: string }) {
  const { isNarrow, fontScale } = useResponsive();
  const draw = useSharedValue(0);
  const fill = useSharedValue(0);
  const copy = useSharedValue(0);

  useEffect(() => {
    if (!active) {
      draw.value = 0;
      fill.value = 0;
      copy.value = 0;
      return;
    }
    if (reduceMotion) {
      draw.value = 1;
      fill.value = 1;
      copy.value = 1;
      return;
    }
    draw.value = withDelay(
      DELAY,
      withTiming(1, { duration: DRAW, easing: Easing.inOut(Easing.cubic) }),
    );
    // The wings fill as the drawing head enters the arrow, not after it.
    fill.value = withDelay(
      DELAY + DRAW * MARK_ARROW_SECTION_T,
      withTiming(1, {
        duration: DRAW * (1 - MARK_ARROW_SECTION_T),
        easing: Easing.out(Easing.cubic),
      }),
    );
    copy.value = withDelay(
      COPY_IN,
      withTiming(1, { duration: 520, easing: Easing.out(Easing.cubic) }),
    );
  }, [active, reduceMotion, draw, fill, copy]);

  const strokeProps = useAnimatedProps(() => ({
    strokeDashoffset: MARK_STROKE_LENGTH * (1 - draw.value),
  }));
  const fillProps = useAnimatedProps(() => ({ fillOpacity: fill.value }));
  const copyStyle = useAnimatedStyle(() => ({
    opacity: copy.value,
    transform: [{ translateY: (1 - copy.value) * 14 }],
  }));

  // Text scaling grows the headline but not the page, so the mark is what
  // yields: at large accessibility sizes it shrinks rather than pushing the
  // copy off the bottom of the slide.
  const size = Math.round((isNarrow ? SIZE_NARROW : SIZE) / Math.max(1, fontScale));

  return (
    <SlideFrame
      width={width}
      height={height}
      topInset={topInset}
      eyebrow={eyebrow}
      title={title}
      body={body}
      copyStyle={copyStyle}
    >
      <View style={styles.wrap}>
        <Svg width={size} height={size} viewBox={`0 0 ${MARK_VIEWBOX} ${MARK_VIEWBOX}`}>
          <Defs>
            <ClipPath id="introClip">
              <Path d={U_PATH} />
            </ClipPath>
            <LinearGradient
              id="introGrad"
              x1="100"
              y1={MARK_GRADIENT_Y.from}
              x2="100"
              y2={MARK_GRADIENT_Y.to}
              gradientUnits="userSpaceOnUse"
            >
              {MARK_GRADIENT_STOPS.map((s) => (
                <Stop key={s.offset} offset={s.offset} stopColor={s.color} />
              ))}
            </LinearGradient>
          </Defs>

          {/* Unlit base. Lighter than the splash's #383838, which reads as a
              dead grey blob against the app background rather than the black
              the splash sits on. */}
          <Path d={U_PATH} fill="rgba(255,255,255,0.07)" />

          <AnimatedPath
            d={U_STROKE_PATH}
            stroke="url(#introGrad)"
            strokeWidth={MARK_STROKE_WIDTH}
            fill="none"
            strokeLinecap="butt"
            strokeDasharray={MARK_STROKE_LENGTH}
            animatedProps={strokeProps}
            clipPath="url(#introClip)"
          />

          <AnimatedPath d={U_PATH} fill="url(#introGrad)" animatedProps={fillProps} />
        </Svg>
      </View>
    </SlideFrame>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: "center", justifyContent: "center" },
});
