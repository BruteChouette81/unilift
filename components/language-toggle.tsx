import { useLanguage } from "@/context/LanguageContext";
import type { Language } from "@/constants/translations";
import { Pressable, StyleSheet, Text, View } from "react-native";

const OPTIONS: { code: Language; label: string }[] = [
  { code: "en", label: "EN" },
  { code: "fr", label: "FR" },
];

export default function LanguageToggle() {
  const { language, changeLanguage } = useLanguage();

  return (
    <View style={styles.pill}>
      {OPTIONS.map((opt) => {
        const active = language === opt.code;
        return (
          <Pressable
            key={opt.code}
            onPress={() => { if (!active) void changeLanguage(opt.code); }}
            style={[styles.option, active && styles.optionActive]}
            hitSlop={4}
          >
            <Text style={[styles.label, active && styles.labelActive]}>{opt.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: "row",
    backgroundColor: "rgba(15, 15, 30, 0.7)",
    borderWidth: 1,
    borderColor: "rgba(137, 56, 213, 0.35)",
    borderRadius: 14,
    padding: 3,
    gap: 2,
  },
  option: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 11,
  },
  optionActive: {
    backgroundColor: "rgba(137, 56, 213, 0.55)",
  },
  label: {
    color: "rgba(255, 255, 255, 0.55)",
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.6,
  },
  labelActive: {
    color: "#fff",
  },
});
