import { useLanguage } from "@/context/LanguageContext";
import { Ionicons } from "@expo/vector-icons";
import { BlurView } from "expo-blur";
import { CameraView, useCameraPermissions } from "expo-camera";
import React, { useRef } from "react";
import { Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

interface Props {
  onScanned: (payload: string) => void;
  onClose: () => void;
}

export default function QrScanner({ onScanned, onClose }: Props) {
  const { t } = useLanguage();
  const insets = useSafeAreaInsets();
  const [permission, requestPermission] = useCameraPermissions();
  const hasScannedRef = useRef(false);

  if (!permission) {
    return (
      <View style={styles.permContainer}>
        <Ionicons name="camera-outline" size={40} color="#e09af7" />
        <Text style={styles.message}>{t("qr.requestingCamera")}</Text>
      </View>
    );
  }

  if (!permission.granted) {
    // If the OS will no longer surface the prompt, route the user to Settings.
    const canAsk = permission.canAskAgain;
    return (
      <View style={styles.permContainer}>
        <View style={styles.permIconWrap}>
          <Ionicons name="camera" size={34} color="#e09af7" />
        </View>
        <Text style={styles.permTitle}>{t("qr.cameraNeededTitle")}</Text>
        <Text style={styles.message}>{t("qr.cameraNeededMsg")}</Text>
        <Pressable style={styles.permBtn} onPress={canAsk ? requestPermission : () => Linking.openSettings()}>
          <Text style={styles.permBtnText}>{canAsk ? t("qr.grantPermission") : t("qr.openSettings")}</Text>
        </Pressable>
        <Pressable style={styles.closeBtn} onPress={onClose}>
          <Text style={styles.closeBtnText}>{t("qr.cancel")}</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <CameraView
        style={StyleSheet.absoluteFill}
        facing="back"
        autofocus="on"
        barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
        onBarcodeScanned={(result) => {
          if (hasScannedRef.current) return;
          hasScannedRef.current = true;
          onScanned(result.data);
        }}
      />

      {/* Dimmed surround so the clear scan window pops. */}
      <View style={styles.surround} pointerEvents="none">
        <View style={[styles.scanFrame]}>
          <View style={[styles.corner, styles.cornerTL]} />
          <View style={[styles.corner, styles.cornerTR]} />
          <View style={[styles.corner, styles.cornerBL]} />
          <View style={[styles.corner, styles.cornerBR]} />
        </View>
      </View>

      {/* Glass header (chrome only — never over the QR being scanned). */}
      <BlurView intensity={40} tint="dark" experimentalBlurMethod="dimezisBlurView" style={[styles.titleCard, { top: insets.top + 16 }]}>
        <Text style={styles.titleText}>{t("qr.scanTitle")}</Text>
        <Text style={styles.subtitleText}>{t("qr.scanSubtitle")}</Text>
      </BlurView>

      <Pressable style={[styles.cancelBtn, { bottom: insets.bottom + 28 }]} onPress={onClose}>
        <BlurView intensity={50} tint="dark" experimentalBlurMethod="dimezisBlurView" style={styles.cancelBlur}>
          <Ionicons name="close" size={18} color="#fff" />
          <Text style={styles.cancelText}>{t("qr.cancel")}</Text>
        </BlurView>
      </Pressable>
    </View>
  );
}

const SCRIM = "rgba(8,8,16,0.55)";

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#080810" },

  surround: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
  },
  scanFrame: {
    width: 248,
    height: 248,
    borderRadius: 24,
  },
  corner: {
    position: "absolute",
    width: 36,
    height: 36,
    borderColor: "#e09af7",
  },
  cornerTL: { top: 0, left: 0, borderTopWidth: 4, borderLeftWidth: 4, borderTopLeftRadius: 22 },
  cornerTR: { top: 0, right: 0, borderTopWidth: 4, borderRightWidth: 4, borderTopRightRadius: 22 },
  cornerBL: { bottom: 0, left: 0, borderBottomWidth: 4, borderLeftWidth: 4, borderBottomLeftRadius: 22 },
  cornerBR: { bottom: 0, right: 0, borderBottomWidth: 4, borderRightWidth: 4, borderBottomRightRadius: 22 },

  titleCard: {
    position: "absolute",
    left: 24,
    right: 24,
    borderRadius: 18,
    overflow: "hidden",
    paddingVertical: 14,
    paddingHorizontal: 18,
    alignItems: "center",
    backgroundColor: SCRIM,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
  },
  titleText: { color: "#fff", fontSize: 18, fontWeight: "800" },
  subtitleText: { color: "#e5e7eb", fontSize: 13, marginTop: 3, textAlign: "center" },

  cancelBtn: {
    position: "absolute",
    alignSelf: "center",
    borderRadius: 16,
    overflow: "hidden",
  },
  cancelBlur: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 32,
    paddingVertical: 14,
    backgroundColor: SCRIM,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.16)",
  },
  cancelText: { color: "#fff", fontSize: 16, fontWeight: "700" },

  // Permission states
  permContainer: {
    flex: 1,
    backgroundColor: "#080810",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
    gap: 14,
  },
  permIconWrap: {
    width: 72,
    height: 72,
    borderRadius: 22,
    backgroundColor: "rgba(137,56,213,0.15)",
    borderWidth: 1,
    borderColor: "rgba(137,56,213,0.3)",
    alignItems: "center",
    justifyContent: "center",
  },
  permTitle: { color: "#fff", fontSize: 20, fontWeight: "800" },
  message: { color: "#cbd5e1", fontSize: 15, textAlign: "center", lineHeight: 21 },
  permBtn: {
    backgroundColor: "#8938D5",
    paddingHorizontal: 32,
    paddingVertical: 14,
    borderRadius: 14,
    marginTop: 6,
  },
  permBtnText: { color: "#fff", fontSize: 15, fontWeight: "700" },
  closeBtn: {
    paddingHorizontal: 40,
    paddingVertical: 12,
    borderRadius: 14,
    backgroundColor: "rgba(255,255,255,0.08)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
  },
  closeBtnText: { color: "#fff", fontSize: 15, fontWeight: "600" },
});
