import { getLegalTermsText } from "@/constants/legalTerms";
import { useLanguage } from "@/context/LanguageContext";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import React from "react";
import {
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const C = {
  bg:          "#080810",
  surface:     "#0f0f1e",
  borderFaint: "rgba(255, 255, 255, 0.06)",
  text:        "#f3f4f6",
  muted:       "#9ca3af",
  dim:         "#4b5563",
};

export default function PrivacyScreen() {
  const router = useRouter();
  const { t, language } = useLanguage();
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <StatusBar style="light" />

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} activeOpacity={0.7}>
          <View style={styles.backBtnGrad}>
            <Ionicons name="arrow-back" size={18} color="#2d0015" />
          </View>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{t("profile.settings.privacy")}</Text>
        <View style={{ width: 38 }} />
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator
      >
        <Text style={styles.body}>{getLegalTermsText(language)}</Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },

  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: C.borderFaint,
  },
  backBtn:     { borderRadius: 10, overflow: "hidden" },
  backBtnGrad: { width: 38, height: 38, alignItems: "center", justifyContent: "center", backgroundColor: "#e09af7" },
  headerTitle: { color: C.text, fontSize: 17, fontWeight: "700" },

  scroll:        { flex: 1 },
  scrollContent: { padding: 20, paddingBottom: 40 },
  body: {
    color: C.muted,
    fontSize: 13,
    lineHeight: 20,
  },
});
