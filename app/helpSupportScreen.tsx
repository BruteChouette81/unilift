import { useLanguage } from "@/context/LanguageContext";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import React from "react";
import {
  Linking,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const C = {
  bg:          "#080810",
  surface:     "#0f0f1e",
  surfaceAlt:  "#13132a",
  border:      "rgba(137, 56, 213, 0.22)",
  borderFaint: "rgba(255, 255, 255, 0.06)",
  purple:      "#8938D5",
  purpleLight: "#e09af7",
  text:        "#f3f4f6",
  muted:       "#9ca3af",
  dim:         "#4b5563",
};

export default function HelpSupportScreen() {
  const router = useRouter();
  const { t } = useLanguage();
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <StatusBar style="light" />

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} activeOpacity={0.7}>
          <LinearGradient
            colors={["#FD165A", "#8938D5"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.backBtnGrad}
          >
            <Ionicons name="arrow-back" size={18} color="#fff" />
          </LinearGradient>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{t("profile.settings.helpSupport")}</Text>
        <View style={{ width: 38 }} />
      </View>

      {/* Content */}
      <View style={styles.content}>
        <View style={styles.iconWrap}>
          <Text style={{ fontSize: 36 }}>✉️</Text>
        </View>

        <Text style={styles.title}>{t("profile.support.title")}</Text>
        <Text style={styles.body}>{t("profile.support.body")}</Text>

        <TouchableOpacity
          style={styles.btn}
          onPress={() => void Linking.openURL("mailto:support@unilift.ca")}
          activeOpacity={0.75}
        >
          <LinearGradient
            colors={["#FD165A", "#8938D5"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={styles.btnGrad}
          >
            <Ionicons name="mail-outline" size={18} color="#fff" />
            <View>
              <Text style={styles.btnText}>{t("profile.support.cta")}</Text>
              <Text style={styles.btnEmail}>{t("profile.support.email")}</Text>
            </View>
          </LinearGradient>
        </TouchableOpacity>
      </View>
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
  backBtnGrad: { width: 38, height: 38, alignItems: "center", justifyContent: "center" },
  headerTitle: { color: C.text, fontSize: 17, fontWeight: "700" },

  content: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
    gap: 12,
  },
  iconWrap: {
    width: 80,
    height: 80,
    borderRadius: 20,
    backgroundColor: "rgba(253,22,90,0.1)",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(253,22,90,0.2)",
    marginBottom: 8,
  },
  title: {
    color: C.text,
    fontSize: 20,
    fontWeight: "700",
    textAlign: "center",
  },
  body: {
    color: C.muted,
    fontSize: 14,
    textAlign: "center",
    lineHeight: 21,
  },
  btn: {
    marginTop: 10,
    borderRadius: 12,
    overflow: "hidden",
    alignSelf: "stretch",
  },
  btnGrad: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    paddingVertical: 16,
    paddingHorizontal: 20,
  },
  btnText: {
    color: "#fff",
    fontWeight: "700",
    fontSize: 15,
  },
  btnEmail: {
    color: "rgba(255,255,255,0.65)",
    fontSize: 12,
    marginTop: 1,
  },
});
