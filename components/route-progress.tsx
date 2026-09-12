import React, { useMemo } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import Animated, {
  Extrapolation,
  interpolate,
  useAnimatedProps,
  useAnimatedStyle,
  type SharedValue,
} from "react-native-reanimated";
import Svg, { Circle, Defs, LinearGradient, Path, Stop } from "react-native-svg";

import {
  ARROW_HEAD_PATH,
  ARROW_HEAD_RIGHT_TRANSFORM,
  ARROW_HEAD_RIGHT_VIEWBOX,
  MARK_GRADIENT_STOPS,
} from "@/constants/brand-mark";
import { P } from "@/constants/palette";

const AnimatedPath = Animated.createAnimatedComponent(Path);
const AnimatedCircle = Animated.createAnimatedComponent(Circle);

/** Half the marker's width — the polyline insets by this so the arrow never
 *  clips the edge of the screen at either end. */
const MARKER = 26;
const STRIP_HEIGHT = 56;

/** Vertical jog per node, cycled. A dead-straight line is a progress bar; these
 *  small irregular offsets are what make it read as a route on a map. */
const JOG = [0, -7, 5, -5, 2, -3];

type Props = {
  /** Current position in the sequence, in slides. Fractional while scrolling. */
  progress: SharedValue<number>;
  /** Number of stops on the route. */
  count: number;
  /** Available width; the strip lays itself out inside this. */
  width: number;
  /**
   * Make the stops tappable, reporting the one the user aimed at.
   *
   * Omit it and the strip is exactly what it has always been: a read-only
   * indicator that ignores touches and stays out of the accessibility tree.
   * That is the release takeover's contract, so it must remain the default.
   *
   * The strip has no idea which stops are reachable — a signup flow can only go
   * back to a step it has already been through. So this reports the *aimed-at*
   * index and the caller decides whether to honour it.
   */
  onSeek?: (index: number) => void;
  /** Accessibility label for each stop, when `onSeek` makes them buttons. */
  seekLabel?: (index: number) => string;
};

/**
 * A sequence drawn as a trip.
 *
 * Standard page dots would be decoration — they say "5 things" and nothing
 * else. A route says what the product is, and it ties swipe direction to travel
 * direction: dragging forward moves the marker forward along the line, and the
 * segment behind it fills with the brand ramp.
 *
 * Every value is derived from `progress`, which the caller drives straight from
 * the scroll offset. That means the strip tracks the finger rather than playing
 * an animation, so it needs no reduced-motion variant.
 *
 * Two callers, deliberately different: the release takeover
 * (`components/whats-new/`) renders it read-only, and signup passes `onSeek` to
 * make the stops tappable so you can go back to an answer. It started life in
 * the whats-new folder and moved here when the second caller appeared.
 */
export default function RouteProgress({
  progress,
  count,
  width,
  onSeek,
  seekLabel,
}: Props) {
  const geom = useMemo(() => {
    const midY = STRIP_HEIGHT / 2;
    const usable = Math.max(width - MARKER * 2, 1);
    const span = Math.max(count - 1, 1);

    const xs: number[] = [];
    const ys: number[] = [];
    for (let i = 0; i < count; i++) {
      xs.push(MARKER + (usable * i) / span);
      ys.push(midY + JOG[i % JOG.length]);
    }

    // Cumulative arc length at each node. Driving the dash offset off these
    // rather than off a uniform fraction keeps the fill head pinned to the
    // marker, which is segment-parameterised.
    const cumulative: number[] = [0];
    for (let i = 1; i < count; i++) {
      const dx = xs[i] - xs[i - 1];
      const dy = ys[i] - ys[i - 1];
      cumulative.push(cumulative[i - 1] + Math.hypot(dx, dy));
    }

    const d = xs.map((x, i) => `${i === 0 ? "M" : "L"} ${x} ${ys[i]}`).join(" ");
    const indices = xs.map((_, i) => i);

    return { xs, ys, cumulative, d, indices, total: cumulative[count - 1] };
  }, [count, width]);

  // The traversed segment, revealed by walking the dash offset back to zero.
  const fillProps = useAnimatedProps(() => {
    const travelled = interpolate(
      progress.value,
      geom.indices,
      geom.cumulative,
      Extrapolation.CLAMP,
    );
    return { strokeDashoffset: geom.total - travelled };
  });

  // Straight-line interpolation between adjacent nodes is the exact point on a
  // polyline, so the marker sits on the route rather than near it.
  const markerStyle = useAnimatedStyle(() => ({
    transform: [
      {
        translateX:
          interpolate(progress.value, geom.indices, geom.xs, Extrapolation.CLAMP) -
          MARKER / 2,
      },
      {
        translateY:
          interpolate(progress.value, geom.indices, geom.ys, Extrapolation.CLAMP) -
          MARKER / 2,
      },
    ],
  }));

  return (
    <View
      style={[styles.wrap, { width, height: STRIP_HEIGHT }]}
      // With no `onSeek` these three are byte-identical to what this component
      // has always rendered, which is what keeps the release takeover unchanged.
      pointerEvents={onSeek ? "box-none" : "none"}
      accessibilityElementsHidden={!onSeek}
      importantForAccessibility={onSeek ? "auto" : "no-hide-descendants"}
    >
      <Svg width={width} height={STRIP_HEIGHT}>
        <Defs>
          <LinearGradient id="routeGrad" x1="0" y1="0" x2={width} y2="0" gradientUnits="userSpaceOnUse">
            {MARK_GRADIENT_STOPS.map((s) => (
              <Stop key={s.offset} offset={s.offset} stopColor={s.color} />
            ))}
          </LinearGradient>
        </Defs>

        {/* The road ahead. */}
        <Path
          d={geom.d}
          stroke="rgba(255,255,255,0.10)"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />

        {/* The road behind. */}
        <AnimatedPath
          d={geom.d}
          stroke="url(#routeGrad)"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
          strokeDasharray={geom.total}
          animatedProps={fillProps}
        />

        {geom.indices.map((i) => (
          <RouteNode
            key={i}
            index={i}
            cx={geom.xs[i]}
            cy={geom.ys[i]}
            progress={progress}
          />
        ))}
      </Svg>

      <Animated.View style={[styles.marker, markerStyle]} pointerEvents="none">
        <Svg width={MARKER} height={MARKER} viewBox={ARROW_HEAD_RIGHT_VIEWBOX}>
          <Path d={ARROW_HEAD_PATH} transform={ARROW_HEAD_RIGHT_TRANSFORM} fill={P.accentLight} />
        </Svg>
      </Animated.View>

      {/*
        Touch targets, when the caller wants them.

        They live out here rather than on the SVG nodes for two reasons: an
        `react-native-svg` element is not pressable, and the nodes are r≈4 —
        far below a usable target. Tiling the full width into `count` equal
        columns means every point on the strip belongs to exactly one stop, the
        nearest one, so there is no overlap and no z-order tie to lose. At eight
        stops on a 375pt screen each column is ~40pt wide and the strip is 56pt
        tall, which clears the 44pt minimum on the axis that is hard to hit.
      */}
      {onSeek
        ? geom.indices.map((i) => (
            <Pressable
              key={i}
              onPress={() => onSeek(i)}
              accessibilityRole="button"
              accessibilityLabel={seekLabel?.(i)}
              style={[
                styles.hit,
                { left: (width * i) / count, width: width / count },
              ]}
            />
          ))
        : null}
    </View>
  );
}

/** One stop on the route. Lit once the marker has reached it — its own
 *  component so each node gets its own animated props hook. */
function RouteNode({
  index,
  cx,
  cy,
  progress,
}: {
  index: number;
  cx: number;
  cy: number;
  progress: SharedValue<number>;
}) {
  const props = useAnimatedProps(() => {
    // Lights over the last third of the approach, so arriving at a stop reads
    // as an event rather than a step function.
    const lit = interpolate(
      progress.value,
      [index - 0.35, index],
      [0, 1],
      Extrapolation.CLAMP,
    );
    return { r: 2.5 + lit * 1.5, fillOpacity: 0.25 + lit * 0.75 };
  });

  return <AnimatedCircle cx={cx} cy={cy} fill={P.accentLight} animatedProps={props} />;
}

const styles = StyleSheet.create({
  wrap: { justifyContent: "center" },
  hit: { position: "absolute", top: 0, bottom: 0 },
  marker: {
    position: "absolute",
    left: 0,
    top: 0,
    width: MARKER,
    height: MARKER,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: P.hype,
    shadowOpacity: 0.6,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 0 },
  },
});
