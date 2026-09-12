import React, { useEffect } from 'react';
import { StyleSheet } from 'react-native';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedProps,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';
import Svg, { ClipPath, Defs, LinearGradient, Path, Stop } from 'react-native-svg';

import {
  MARK_ARROW_SECTION_T as ARROW_SECTION_T,
  MARK_BASE_COLOUR,
  MARK_GRADIENT_STOPS,
  MARK_GRADIENT_Y,
  MARK_STROKE_LENGTH as STROKE_LENGTH,
  MARK_STROKE_WIDTH as STROKE_WIDTH,
  MARK_VIEWBOX,
  U_PATH,
  U_STROKE_PATH,
} from '@/constants/brand-mark';

const AnimatedPath = Animated.createAnimatedComponent(Path);

const SIZE = 200;
const INITIAL_DELAY = 300;
const STROKE_DURATION = 1800;
const HOLD_AFTER = 500;
const FADE_DURATION = 400;

interface Props {
  onFinish: () => void;
}

export default function SplashAnimation({ onFinish }: Props): React.JSX.Element {
  const progress      = useSharedValue(0);
  const fillOpacity   = useSharedValue(0);
  const logoOpacity   = useSharedValue(0);
  const screenOpacity = useSharedValue(1);

  useEffect(() => {
    logoOpacity.value = withTiming(1, { duration: 400, easing: Easing.out(Easing.ease) });

    progress.value = withDelay(
      INITIAL_DELAY,
      withTiming(1, { duration: STROKE_DURATION, easing: Easing.inOut(Easing.cubic) })
    );

    // Wings fill in sync with the stroke entering the arrow section
    fillOpacity.value = withDelay(
      INITIAL_DELAY + STROKE_DURATION * ARROW_SECTION_T,
      withTiming(1, {
        duration: STROKE_DURATION * (1 - ARROW_SECTION_T),
        easing: Easing.out(Easing.cubic),
      })
    );

    // Fill ends at same time as stroke (INITIAL_DELAY + STROKE_DURATION)
    screenOpacity.value = withDelay(
      INITIAL_DELAY + STROKE_DURATION + HOLD_AFTER,
      withTiming(0, { duration: FADE_DURATION, easing: Easing.in(Easing.ease) }, (finished) => {
        if (finished) runOnJS(onFinish)();
      })
    );
  }, []);

  const screenStyle = useAnimatedStyle(() => ({ opacity: screenOpacity.value }));
  const logoStyle   = useAnimatedStyle(() => ({ opacity: logoOpacity.value }));

  const strokeProps = useAnimatedProps(() => ({
    strokeDashoffset: STROKE_LENGTH * (1 - progress.value),
  }));

  const gradFillProps = useAnimatedProps(() => ({
    fillOpacity: fillOpacity.value,
  }));

  return (
    <Animated.View style={[styles.screen, screenStyle]}>
      <Animated.View style={[styles.logoWrapper, logoStyle]}>
        <Svg width={SIZE} height={SIZE} viewBox={`0 0 ${MARK_VIEWBOX} ${MARK_VIEWBOX}`}>
          <Defs>
            {/* Clip the stroke to the exact U shape so it never overflows the logo */}
            <ClipPath id="uClip">
              <Path d={U_PATH} />
            </ClipPath>
            <LinearGradient
              id="uGrad"
              x1="100" y1={MARK_GRADIENT_Y.from} x2="100" y2={MARK_GRADIENT_Y.to}
              gradientUnits="userSpaceOnUse"
            >
              {MARK_GRADIENT_STOPS.map((s) => (
                <Stop key={s.offset} offset={s.offset} stopColor={s.color} stopOpacity={1} />
              ))}
            </LinearGradient>
          </Defs>

          {/* Gray base — always visible */}
          <Path d={U_PATH} fill={MARK_BASE_COLOUR} />

          {/* Gradient stroke following centerline from top-left to arrow tip, clipped to U shape */}
          <AnimatedPath
            d={U_STROKE_PATH}
            stroke="url(#uGrad)"
            strokeWidth={STROKE_WIDTH}
            fill="none"
            strokeLinecap="butt"
            strokeDasharray={STROKE_LENGTH}
            animatedProps={strokeProps}
            clipPath="url(#uClip)"
          />

          {/* Full gradient fill fades in when stroke finishes — covers arrow wings */}
          <AnimatedPath
            d={U_PATH}
            fill="url(#uGrad)"
            animatedProps={gradFillProps}
          />
        </Svg>
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  screen: {
    ...StyleSheet.absoluteFill,
    backgroundColor: '#000000',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 999,
  },
  logoWrapper: {
    width: SIZE,
    height: SIZE,
  },
});
