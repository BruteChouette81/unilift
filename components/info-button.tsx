import { useLanguage } from "@/context/LanguageContext";
import { Ionicons } from "@expo/vector-icons";
import { BlurView } from "expo-blur";
import React, { useState } from "react";
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  type ViewStyle,
} from "react-native";

interface InfoButtonProps {
  title: string;
  body: string;
  style?: ViewStyle;
}

export default function InfoButton({ title, body, style }: InfoButtonProps) {
  const [visible, setVisible] = useState(false);
  const { t } = useLanguage();

  return (
    <>
      <TouchableOpacity
        style={[styles.trigger, style]}
        onPress={() => setVisible(true)}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        activeOpacity={0.7}
      >
        <Ionicons name="information-circle-outline" size={16} color="#e09af7" />
      </TouchableOpacity>

      <Modal visible={visible} transparent animationType="fade" onRequestClose={() => setVisible(false)}>
        <Pressable style={styles.backdrop} onPress={() => setVisible(false)}>
          <Pressable onPress={() => {}} style={styles.cardWrap}>
            <BlurView intensity={70} tint="dark" experimentalBlurMethod="dimezisBlurView" style={styles.blur}>
              <Text style={styles.title}>{title}</Text>
              <Text style={styles.body}>{body}</Text>
              <TouchableOpacity onPress={() => setVisible(false)} activeOpacity={0.85} style={styles.closeBtn}>
                <View style={styles.closeBtnGrad}>
                  <Text style={styles.closeBtnText}>{t("common.done")}</Text>
                </View>
              </TouchableOpacity>
            </BlurView>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  trigger: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: "rgba(137, 56, 213, 0.22)",
    alignItems: "center",
    justifyContent: "center",
    marginLeft: 6,
  },
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.55)",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 28,
  },
  cardWrap: {
    width: "100%",
    borderRadius: 20,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(137, 56, 213, 0.30)",
  },
  blur: {
    padding: 24,
    gap: 12,
  },
  title: {
    color: "#f3f4f6",
    fontSize: 16,
    fontWeight: "700",
    marginBottom: 2,
  },
  body: {
    color: "#9ca3af",
    fontSize: 14,
    lineHeight: 22,
  },
  closeBtn: {
    marginTop: 8,
    borderRadius: 12,
    overflow: "hidden",
  },
  closeBtnGrad: {
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#e09af7",
  },
  closeBtnText: {
    color: "#2d0015",
    fontSize: 15,
    fontWeight: "700",
  },
});
