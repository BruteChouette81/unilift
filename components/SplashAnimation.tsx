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

const AnimatedPath = Animated.createAnimatedComponent(Path);

const SIZE = 200;
const INITIAL_DELAY = 300;
const STROKE_DURATION = 1800;
const HOLD_AFTER = 500;
const FADE_DURATION = 400;

// Path to arrow base = 82+129+53 = 264 of 315 total = 83.8%
// With inOut(cubic), p=0.838 → t≈0.657. Use 0.66 so wings sync with stroke entering the arrow.
const ARROW_SECTION_T = 0.66;

// left arm (82) + semi-arc π×41≈129 + right arm+arrow (93) ≈ 304 → 315
// Left arm top at y=40 (11 units below arrow tip y=29)
const STROKE_LENGTH = 315;
const STROKE_WIDTH = 38;

// Arrow side vector AB=(32,-40) len≈51.23, unit≈(0.6247,-0.7809)
// Wing corner r=6, tip corner r=10
const U_PATH =
  'M 40,40 ' +
  'L 78,40 ' +                                    // flat top on left arm
  'L 78,122 ' +                                   // down inner-left
  'A 22,22 0 0,0 122,122 ' +                     // inner arc
  'L 122,69 ' +                                   // up inner-right to arrow base
  'L 115,69 ' +                                   // stop 6 before left wing corner
  'Q 109,69 112.75,64.31 ' +                     // round left wing corner (r=6)
  'L 134.75,36.81 ' +                             // stop 10 before tip
  'Q 141,29 147.25,36.81 ' +                     // round tip (r=10)
  'L 169.25,64.31 ' +                             // stop 6 before right wing corner
  'Q 173,69 167,69 ' +                            // round right wing corner (r=6)
  'L 160,69 ' +                                   // back to outer-right arm
  'L 160,122 ' +                                  // down outer-right
  'A 60,60 0 0,1 40,122 ' +                      // outer arc
  'Z';

// Centerline: top of left arm → down → arc → right arm → through arrow tip
const U_STROKE_PATH =
  'M 59,40 ' +
  'L 59,122 ' +
  'A 41,41 0 0,0 141,122 ' +
  'L 141,29';   // all the way to arrow tip

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
        <Svg width={SIZE} height={SIZE} viewBox="0 0 200 200">
          <Defs>
            {/* Clip the stroke to the exact U shape so it never overflows the logo */}
            <ClipPath id="uClip">
              <Path d={U_PATH} />
            </ClipPath>
            <LinearGradient
              id="uGrad"
              x1="100" y1="40" x2="100" y2="163"
              gradientUnits="userSpaceOnUse"
            >
              <Stop offset="0"   stopColor="#8938D5" stopOpacity={1} />
              <Stop offset="0.5" stopColor="#C428C0" stopOpacity={1} />
              <Stop offset="1"   stopColor="#FD165A" stopOpacity={1} />
            </LinearGradient>
          </Defs>

          {/* Gray base — always visible */}
          <Path d={U_PATH} fill="#383838" />

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
    ...StyleSheet.absoluteFillObject,
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
