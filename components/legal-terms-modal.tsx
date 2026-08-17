import { authColors } from "@/constants/auth-theme";
import { getLegalTermsText } from "@/constants/legalTerms";
import { useLanguage } from "@/context/LanguageContext";
import { Ionicons } from "@expo/vector-icons";
import React, { useEffect, useState } from "react";
import {
  Modal,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

// How close to the bottom (px) counts as "reached the end" — content padding
// and float rounding mean the exact 0 is rarely hit.
const END_THRESHOLD_PX = 24;

/** Full-page, closable presentation of the Terms & Conditions — reused
 *  wherever the app needs to show them (currently: signup). Always renders
 *  the text in the user's current app language.
 *
 *  Acceptance lives here, not in the caller's form: the checkbox at the
 *  bottom stays locked until the user scrolls all the way through the text,
 *  so "accepted" genuinely means "read". */
export default function LegalTermsModal({
  visible,
  accepted,
  onAcceptedChange,
  onClose,
}: {
  visible: boolean;
  accepted: boolean;
  onAcceptedChange: (accepted: boolean) => void;
  onClose: () => void;
}) {
  const { t, language } = useLanguage();
  const insets = useSafeAreaInsets();
  const text = getLegalTermsText(language);

  // Unlocked once the user has scrolled to the end. Already-accepted terms
  // (re-opening after accepting) stay unlocked; otherwise each fresh open
  // requires scrolling again.
  const [hasReachedEnd, setHasReachedEnd] = useState(accepted);
  useEffect(() => {
    if (visible) setHasReachedEnd(accepted);
  }, [visible, accepted]);

  const handleScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (hasReachedEnd) return;
    const { contentOffset, layoutMeasurement, contentSize } = e.nativeEvent;
    const distanceFromBottom = contentSize.height - contentOffset.y - layoutMeasurement.height;
    if (distanceFromBottom < END_THRESHOLD_PX) setHasReachedEnd(true);
  };

  // Edge case: on a tall viewport (tablet) the text may already fit without
  // scrolling at all — nothing would ever fire onScroll, permanently locking
  // the checkbox. Compare the measured viewport/content heights as a fallback.
  const [viewportHeight, setViewportHeight] = useState(0);
  const [contentHeight, setContentHeight] = useState(0);
  useEffect(() => {
    if (hasReachedEnd || viewportHeight === 0 || contentHeight === 0) return;
    if (contentHeight <= viewportHeight + END_THRESHOLD_PX) setHasReachedEnd(true);
  }, [viewportHeight, contentHeight, hasReachedEnd]);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      onRequestClose={onClose}
      presentationStyle={Platform.OS === "ios" ? "pageSheet" : undefined}
    >
      <View style={[styles.root, { paddingTop: Platform.OS === "ios" ? 0 : insets.top }]}>
        <View style={styles.header}>
          <Text style={styles.title} numberOfLines={1}>{t("auth.signup.termsTitle")}</Text>
          <Pressable onPress={onClose} hitSlop={10} style={styles.closeBtn}>
            <Ionicons name="close" size={22} color={authColors.title} />
          </Pressable>
        </View>

        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator
          onScroll={handleScroll}
          scrollEventThrottle={100}
          onLayout={(e) => setViewportHeight(e.nativeEvent.layout.height)}
          onContentSizeChange={(_w, h) => setContentHeight(h)}
        >
          <Text style={styles.body}>{text}</Text>
        </ScrollView>

        <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 14) }]}>
          <Pressable
            disabled={!hasReachedEnd}
            onPress={() => onAcceptedChange(!accepted)}
            style={[styles.checkboxRow, !hasReachedEnd && styles.checkboxRowDisabled]}
          >
            <View style={[styles.checkbox, accepted && styles.checkboxChecked]}>
              {accepted && <Ionicons name="checkmark" size={13} color="#fff" />}
            </View>
            <Text style={styles.checkboxLabel}>{t("auth.signup.termsCheckbox")}</Text>
          </Pressable>
          {!hasReachedEnd && (
            <Text style={styles.scrollHint}>{t("auth.signup.termsScrollHint")}</Text>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: authColors.screenBackground },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.08)",
  },
  title: { flex: 1, color: authColors.title, fontSize: 18, fontWeight: "800" },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  scrollContent: { padding: 20 },
  body: { color: authColors.muted, fontSize: 13.5, lineHeight: 21 },

  footer: {
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.08)",
    paddingHorizontal: 20,
    paddingTop: 14,
    gap: 6,
  },
  checkboxRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  checkboxRowDisabled: {
    opacity: 0.4,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: "rgba(137, 56, 213, 0.5)",
    backgroundColor: "rgba(137, 56, 213, 0.05)",
    alignItems: "center",
    justifyContent: "center",
  },
  checkboxChecked: {
    backgroundColor: "#8938D5",
    borderColor: "#8938D5",
  },
  checkboxLabel: {
    flex: 1,
    color: authColors.muted,
    fontSize: 14,
  },
  scrollHint: {
    color: authColors.dim,
    fontSize: 12,
    marginLeft: 34,
  },
});
