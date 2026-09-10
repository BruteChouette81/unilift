import { Ionicons } from "@expo/vector-icons";
import React, { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import Field from "@/components/flow/field";
import { P } from "@/constants/palette";
import { FONT_CAP } from "@/constants/typography";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { geoSuggestion, type LocationResult } from "@/services/rideServices";

/** First chunk of a place name (street + city), which is what gets stored. */
export function shortenPlace(displayName: string): string {
  const parts = displayName.split(",");
  return (parts[0] + (parts[1] ? " " + parts[1] : "")).trim();
}

export type Coords = { latitude: number; longitude: number };

/**
 * An address field with autocomplete, wearing the flow's lane line.
 *
 * Behaviourally this is the `PlaceField` that lived inside `onboardingScreen`,
 * kept intact — the debounce and the `suppressRef` guard below are load-bearing
 * and were not obvious. What changed is only the dressing.
 *
 * The suggestion list is a plain column of at most five rows, not a
 * `FlatList`: it sits inside a horizontally paged ScrollView, where a nested
 * virtualised list will happily claim a diagonal drag and eat the page turn.
 */
export default function PlaceField({
  label,
  value,
  placeholder,
  onChangeText,
  onSelect,
  valid,
  error,
  reduceMotion,
  editable,
}: {
  label: string;
  value: string;
  placeholder: string;
  onChangeText: (text: string) => void;
  onSelect: (name: string, coords: Coords) => void;
  valid?: boolean;
  error?: string | null;
  reduceMotion?: boolean;
  editable?: boolean;
}) {
  const [suggestions, setSuggestions] = useState<LocationResult[]>([]);
  const [show, setShow] = useState(false);
  // Set just before a programmatic change, so choosing a suggestion does not
  // immediately re-query for the text it just wrote.
  const suppressRef = useRef(false);
  const debounced = useDebouncedValue(value, 400);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (suppressRef.current) {
        suppressRef.current = false;
        return;
      }
      if (debounced.trim().length < 2) {
        setShow(false);
        return;
      }
      const results = await geoSuggestion(debounced.trim());
      if (cancelled) return;
      setSuggestions(results ?? []);
      setShow((results?.length ?? 0) > 0);
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [debounced]);

  return (
    <View>
      <Field
        label={label}
        value={value}
        placeholder={placeholder}
        onChangeText={(text) => {
          suppressRef.current = false;
          onChangeText(text);
        }}
        valid={valid}
        error={error}
        reduceMotion={reduceMotion}
        editable={editable}
        autoCorrect={false}
        trailing={
          value.length > 0 ? (
            <Pressable
              onPress={() => {
                suppressRef.current = true;
                onChangeText("");
                setShow(false);
              }}
              hitSlop={10}
              accessibilityRole="button"
            >
              <Ionicons name="close-circle" size={20} color={P.textMuted} />
            </Pressable>
          ) : null
        }
      />

      {show && suggestions.length > 0 ? (
        <View style={styles.list}>
          {suggestions.slice(0, 5).map((item, i) => (
            <Pressable
              key={`${item.placeId ?? item.displayName}-${i}`}
              onPress={() => {
                suppressRef.current = true;
                onSelect(shortenPlace(item.displayName), {
                  latitude: parseFloat(item.lat),
                  longitude: parseFloat(item.lon),
                });
                setShow(false);
              }}
              accessibilityRole="button"
              style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
            >
              <Ionicons name="location-outline" size={15} color={P.accentLight} />
              <Text
                style={styles.rowText}
                numberOfLines={1}
                maxFontSizeMultiplier={FONT_CAP.body}
              >
                {item.displayName}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { marginTop: -6 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 13,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.06)",
  },
  rowPressed: { opacity: 0.6 },
  rowText: { flex: 1, color: P.text, fontSize: 14.5, fontWeight: "500" },
});
