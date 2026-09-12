import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import PlaceField, { type Coords } from "@/components/flow/place-field";
import StepFrame, { type StepPageProps } from "@/components/flow/step-frame";
import { P } from "@/constants/palette";
import { FONT_CAP } from "@/constants/typography";
import { useLanguage } from "@/context/LanguageContext";
import type { FavoriteRoute } from "@/types/models";

/**
 * Page 2: the places you go often.
 *
 * The only page in either flow that collects a list rather than a value, so it
 * is the one place the "one element per page" rule bends — the field and the
 * things it has already produced have to be visible together, or you cannot
 * tell whether the last one landed.
 */
export default function FavoritesStep({
  width,
  height,
  topInset,
  reduceMotion,
  favorites,
  onRemove,
  draft,
  onDraftChange,
  onDraftSelect,
  draftCoords,
  onAdd,
  editable,
}: StepPageProps & {
  favorites: readonly FavoriteRoute[];
  onRemove: (index: number) => void;
  draft: string;
  onDraftChange: (text: string) => void;
  onDraftSelect: (name: string, coords: Coords) => void;
  draftCoords: Coords | null;
  onAdd: () => void;
  editable?: boolean;
}) {
  const { t } = useLanguage();
  const canAdd = Boolean(draft.trim() && draftCoords);

  return (
    <StepFrame
      width={width}
      height={height}
      topInset={topInset}
      ask={t("onboarding.favoritesAsk")}
      aside={t("onboarding.favoritesAside")}
    >
      <PlaceField
        label={t("onboarding.favoritesLabel")}
        value={draft}
        placeholder={t("onboarding.favoritesPlaceholder")}
        onChangeText={onDraftChange}
        onSelect={onDraftSelect}
        valid={canAdd}
        reduceMotion={reduceMotion}
        editable={editable}
      />

      <Pressable
        onPress={onAdd}
        disabled={!canAdd}
        accessibilityRole="button"
        style={({ pressed }) => [
          styles.add,
          !canAdd && styles.addOff,
          pressed && styles.pressed,
        ]}
      >
        <Ionicons
          name="add"
          size={17}
          color={canAdd ? P.accentLight : P.textDim}
        />
        <Text
          style={[styles.addText, !canAdd && styles.addTextOff]}
          maxFontSizeMultiplier={FONT_CAP.action}
        >
          {t("onboarding.favoritesAdd")}
        </Text>
      </Pressable>

      <View style={styles.list}>
        {favorites.length === 0 ? (
          <Text style={styles.empty} maxFontSizeMultiplier={FONT_CAP.chrome}>
            {t("onboarding.favoritesEmpty")}
          </Text>
        ) : (
          favorites.map((fav, i) => (
            <View key={`${fav.destination}-${i}`} style={styles.row}>
              <Ionicons name="star" size={14} color={P.warning} />
              <Text
                style={styles.rowText}
                numberOfLines={1}
                maxFontSizeMultiplier={FONT_CAP.body}
              >
                {fav.destination}
              </Text>
              <Pressable
                onPress={() => onRemove(i)}
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel={t("onboarding.favoritesRemove", {
                  place: fav.destination,
                })}
              >
                <Ionicons name="close" size={17} color={P.textMuted} />
              </Pressable>
            </View>
          ))
        )}
      </View>
    </StepFrame>
  );
}

const styles = StyleSheet.create({
  add: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    height: 46,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: "rgba(224,154,247,0.35)",
    backgroundColor: "rgba(137,56,213,0.10)",
  },
  addOff: {
    borderColor: "rgba(255,255,255,0.10)",
    backgroundColor: "transparent",
  },
  pressed: { opacity: 0.7 },
  addText: { color: P.accentLight, fontSize: 14.5, fontWeight: "700" },
  addTextOff: { color: P.textDim },
  list: { marginTop: 22 },
  empty: { color: P.textDim, fontSize: 13, fontWeight: "500" },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 11,
    paddingVertical: 13,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.07)",
  },
  rowText: { flex: 1, color: P.text, fontSize: 15, fontWeight: "600" },
});
