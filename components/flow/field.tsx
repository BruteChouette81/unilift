import React, { useEffect, useRef, useState } from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
} from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import Svg, { Line } from "react-native-svg";

import { P } from "@/constants/palette";
import { FONT_CAP } from "@/constants/typography";

/** Focus sweep duration. Long enough to read as a stroke being drawn, short
 *  enough that it has finished before the keyboard has. */
const SWEEP_MS = 220;

/** Reserved height for the message line, so the layout does not jump the moment
 *  a field goes invalid. One line at 12.5/17 plus its top margin. */
const MESSAGE_SLOT = 23;

export type FieldProps = Omit<TextInputProps, "style" | "placeholderTextColor"> & {
  /** Sits above the field, always visible — there is only one field per page,
   *  so there is room, and a label that never leaves beats a placeholder that
   *  vanishes the moment you start typing. */
  label: string;
  /** Shown under the rule, in red. Takes precedence over `valid`. */
  error?: string | null;
  /** Draws the rule in green once the field is filled in and correct. */
  valid?: boolean;
  /** Hold the end state instead of sweeping. */
  reduceMotion?: boolean;
  /** Rendered inside the field row, after the input — the password eye. */
  trailing?: React.ReactNode;
  /**
   * Makes the whole field a button instead of an input.
   *
   * The school page needs a field that opens a search sheet rather than a
   * keyboard. It gets the same lane line and the same label so it reads as one
   * of the family, and `value` renders as the chosen school.
   */
  onPress?: () => void;
  /** Shown in place of `value` when it is empty and `onPress` is set. */
  placeholderText?: string;
};

/**
 * The signup field: one line of text sitting on a rule that behaves like road
 * marking.
 *
 * Dashed at rest — a road not yet driven. On focus the dash resolves into a
 * solid brand-coloured rule that sweeps in from the left. Green once the answer
 * is good, red when it is not.
 *
 * That sweep is the only decoration on the page, which is the point: with one
 * question per screen there is nothing else competing, so the field can carry
 * the whole state of the interaction and everything around it stays quiet.
 *
 * ## Why the rule animates `width` rather than `scaleX`
 *
 * React Native has no `transformOrigin`, so a `scaleX` sweep grows from the
 * centre and needs a compensating `translateX` that has to be re-derived every
 * time the layout changes. Animating a measured width is origin-left by
 * construction and survives rotation and text scaling without any arithmetic.
 */
export default function Field({
  label,
  error,
  valid,
  reduceMotion,
  trailing,
  onPress,
  placeholderText,
  value,
  onFocus,
  onBlur,
  ...inputProps
}: FieldProps) {
  const [focused, setFocused] = useState(false);
  const [ruleWidth, setRuleWidth] = useState(0);

  const inputRef = useRef<TextInput>(null);
  const sweep = useSharedValue(0);

  const lit = focused || Boolean(error) || Boolean(valid);

  useEffect(() => {
    sweep.value = reduceMotion
      ? (lit ? 1 : 0)
      : withTiming(lit ? 1 : 0, { duration: SWEEP_MS });
  }, [lit, reduceMotion, sweep]);

  // Colour is decided in JS and applied instantly. Animating it too would be a
  // second accessory competing with the sweep for the same 220ms.
  const ruleColor = error ? P.danger : valid && !focused ? P.success : P.accentLight;

  const ruleStyle = useAnimatedStyle(() => ({
    width: sweep.value * ruleWidth,
  }));

  const showPlaceholderText = Boolean(onPress) && !value;

  const body = (
    <>
      <Text style={styles.label} maxFontSizeMultiplier={FONT_CAP.chrome}>
        {label}
      </Text>

      <View
        style={styles.row}
        onLayout={(e) => setRuleWidth(e.nativeEvent.layout.width)}
      >
        {onPress ? (
          <Text
            style={[styles.input, showPlaceholderText && styles.inputPlaceholder]}
            numberOfLines={1}
            maxFontSizeMultiplier={FONT_CAP.body}
          >
            {showPlaceholderText ? placeholderText : value}
          </Text>
        ) : (
          <TextInput
            {...inputProps}
            ref={inputRef}
            value={value}
            style={styles.input}
            placeholderTextColor={P.textDim}
            selectionColor={P.accentLight}
            accessibilityLabel={label}
            maxFontSizeMultiplier={FONT_CAP.body}
            onFocus={(e) => {
              setFocused(true);
              onFocus?.(e);
            }}
            onBlur={(e) => {
              setFocused(false);
              onBlur?.(e);
            }}
          />
        )}

        {trailing}

        {/* The road ahead: always drawn, always dashed.
            Drawn in SVG rather than with `borderStyle: "dashed"`, which React
            Native renders inconsistently when only one edge has a width — most
            often as a solid line on Android, which loses the whole idea. */}
        <View style={styles.ruleRest} pointerEvents="none">
          {ruleWidth > 0 ? (
            <Svg width={ruleWidth} height={2}>
              <Line
                x1={0}
                y1={1}
                x2={ruleWidth}
                y2={1}
                stroke="rgba(255,255,255,0.18)"
                strokeWidth={1.5}
                strokeDasharray="5 6"
                strokeLinecap="round"
              />
            </Svg>
          ) : null}
        </View>
        {/* The road behind: sweeps in over it. */}
        <Animated.View
          style={[styles.ruleLive, { backgroundColor: ruleColor }, ruleStyle]}
          pointerEvents="none"
        />
      </View>

      <View style={styles.messageSlot}>
        {error ? (
          <Text
            style={styles.error}
            accessibilityLiveRegion="polite"
            maxFontSizeMultiplier={FONT_CAP.chrome}
          >
            {error}
          </Text>
        ) : null}
      </View>
    </>
  );

  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityValue={{ text: value || placeholderText }}
        style={styles.wrap}
      >
        {body}
      </Pressable>
    );
  }

  // The whole block is the target, not just the glyphs.
  //
  // A `TextInput` is only as tall as its own line of text, so on a page this
  // sparse most of what reads as "the field" — the label, the gap above the
  // rule, the rule itself — was dead space, and a tap that looked well aimed
  // did nothing. `accessible={false}` keeps this wrapper out of the
  // accessibility tree so VoiceOver still lands on the input rather than on a
  // button wrapping it.
  return (
    <Pressable
      onPress={() => inputRef.current?.focus()}
      accessible={false}
      style={styles.wrap}
    >
      {body}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { alignSelf: "stretch" },
  // Sentence case, not the tracked-out caps this app uses for eyebrows: eight
  // pages in a row of the same all-caps label would read as chrome rather than
  // as a name for the thing below it.
  label: {
    color: P.textMuted,
    fontSize: 12.5,
    fontWeight: "600",
    marginBottom: 8,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingBottom: 12,
    // Taller than the text it holds, so the input itself — not just the
    // wrapper — catches a tap aimed a few points high or low.
    minHeight: 46,
  },
  input: {
    flex: 1,
    alignSelf: "stretch",
    color: P.text,
    fontSize: 22,
    fontWeight: "600",
    // Zero out the platform's own padding so the text sits on the rule at the
    // same distance on both, which is the whole illusion. `alignSelf: stretch`
    // then lets the input fill the row's height for hit-testing without
    // shifting the baseline.
    paddingVertical: 0,
  },
  inputPlaceholder: { color: P.textDim, fontWeight: "500" },
  ruleRest: { position: "absolute", left: 0, right: 0, bottom: 0, height: 2 },
  ruleLive: {
    position: "absolute",
    left: 0,
    bottom: 0,
    height: 2,
    borderRadius: 1,
  },
  messageSlot: { minHeight: MESSAGE_SLOT, justifyContent: "flex-start" },
  error: {
    color: P.danger,
    fontSize: 12.5,
    lineHeight: 17,
    fontWeight: "600",
    marginTop: 6,
  },
});
