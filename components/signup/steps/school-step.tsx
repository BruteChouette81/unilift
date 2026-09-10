import { Ionicons } from "@expo/vector-icons";
import React, { useMemo, useState } from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import Field from "@/components/flow/field";
import StepFrame, { type StepPageProps } from "@/components/flow/step-frame";
import { P } from "@/constants/palette";
import { filterSchools } from "@/constants/schools";
import { FONT_CAP } from "@/constants/typography";
import { useLanguage } from "@/context/LanguageContext";

/**
 * The school page: a field that opens a search sheet rather than a keyboard.
 *
 * The old form put a filtered dropdown directly under the input, which only
 * worked because `keyboardShouldPersistTaps="handled"` delivered the tap before
 * the input's `onBlur` tore the list down. That race has no place in a pager —
 * and a scrolling list living inside a horizontally-paged ScrollView will
 * happily claim a diagonal drag and eat the page turn.
 *
 * A full-screen sheet sidesteps both. It is also just better: the whole list is
 * visible instead of six rows peeking out from under a keyboard.
 */
export default function SchoolStep({
  width,
  height,
  topInset,
  reduceMotion,
  value,
  onChange,
  error,
  editable,
}: StepPageProps & {
  value: string;
  onChange: (school: string) => void;
  error?: string | null;
  editable?: boolean;
}) {
  const { t } = useLanguage();
  const insets = useSafeAreaInsets();

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const results = useMemo(() => filterSchools(query), [query]);

  const close = () => {
    setOpen(false);
    setQuery("");
  };

  return (
    <StepFrame
      width={width}
      height={height}
      topInset={topInset}
      ask={t("auth.signup.schoolAsk")}
      aside={t("auth.signup.schoolAside")}
    >
      <Field
        label={t("auth.signup.schoolLabel")}
        value={value}
        placeholderText={t("auth.signup.schoolChoose")}
        onPress={editable === false ? undefined : () => setOpen(true)}
        error={error}
        valid={Boolean(value)}
        reduceMotion={reduceMotion}
        trailing={
          <Ionicons name="chevron-forward" size={18} color={P.textMuted} />
        }
      />

      <Modal
        visible={open}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={close}
      >
        <View style={[styles.sheet, { paddingTop: insets.top + 8 }]}>
          <View style={styles.sheetHead}>
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder={t("auth.signup.schoolSearchPlaceholder")}
              placeholderTextColor={P.textDim}
              style={styles.search}
              selectionColor={P.accentLight}
              autoFocus
              autoCorrect={false}
              returnKeyType="search"
              maxFontSizeMultiplier={FONT_CAP.body}
            />
            <Pressable
              onPress={close}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel={t("common.close")}
            >
              <Ionicons name="close" size={22} color={P.textMuted} />
            </Pressable>
          </View>

          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
            showsVerticalScrollIndicator={false}
          >
            {results.length === 0 ? (
              <Text style={styles.empty} maxFontSizeMultiplier={FONT_CAP.body}>
                {t("auth.signup.schoolSearchEmpty", { query: query.trim() })}
              </Text>
            ) : (
              results.map((school) => {
                const chosen = school === value;
                return (
                  <Pressable
                    key={school}
                    onPress={() => {
                      onChange(school);
                      close();
                    }}
                    accessibilityRole="button"
                    accessibilityState={{ selected: chosen }}
                    style={({ pressed }) => [
                      styles.row,
                      pressed && styles.rowPressed,
                    ]}
                  >
                    <Text
                      style={[styles.rowText, chosen && styles.rowTextChosen]}
                      maxFontSizeMultiplier={FONT_CAP.body}
                    >
                      {school}
                    </Text>
                    {chosen ? (
                      <Ionicons name="checkmark" size={18} color={P.accentLight} />
                    ) : null}
                  </Pressable>
                );
              })
            )}
          </ScrollView>
        </View>
      </Modal>
    </StepFrame>
  );
}

const styles = StyleSheet.create({
  sheet: { flex: 1, backgroundColor: P.bg },
  sheetHead: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    paddingHorizontal: 20,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.08)",
  },
  search: {
    flex: 1,
    color: P.text,
    fontSize: 17,
    fontWeight: "500",
    paddingVertical: 8,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    paddingHorizontal: 20,
    paddingVertical: 15,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.05)",
  },
  rowPressed: { backgroundColor: "rgba(137,56,213,0.14)" },
  rowText: { flex: 1, color: P.text, fontSize: 15.5, fontWeight: "500" },
  rowTextChosen: { color: P.accentLight, fontWeight: "700" },
  empty: {
    color: P.textMuted,
    fontSize: 15,
    lineHeight: 22,
    paddingHorizontal: 20,
    paddingTop: 28,
  },
});
