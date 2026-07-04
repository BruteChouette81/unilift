import { useLanguage } from "@/context/LanguageContext";
import * as Brightness from "expo-brightness";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Pressable, StyleSheet, Text, View } from "react-native";
import QRCode from "react-native-qrcode-svg";

interface Props {
  token: string;
  expiresAt: number;
  onExpired: () => void;
  onClose: () => void;
}

/**
 * Boarding QR shown on the driver's device. The passenger scans it to board.
 *
 * iOS scan reliability: the screen brightness is forced to maximum while the
 * code is visible and restored on close/unmount. iOS dims the screen on
 * auto-brightness (and after returning from the background, e.g. Google Maps),
 * which leaves an otherwise-valid high-contrast QR too dim to scan outdoors.
 * We therefore re-assert max brightness whenever the app returns to the
 * foreground, and expose a manual "tap to re-boost" affordance as a fallback.
 *
 * The QR surface itself stays pure black-on-white with a quiet zone — never
 * tinted or blurred — so scanning is never degraded by styling.
 */
export default function QrCodeDisplay({ token, expiresAt, onExpired, onClose }: Props) {
  const { t } = useLanguage();
  const [secondsLeft, setSecondsLeft] = useState(
    Math.max(0, Math.floor((expiresAt - Date.now()) / 1000)),
  );
  const previousBrightnessRef = useRef<number | null>(null);

  // Force max brightness; remember the prior level so we can restore it.
  const boostBrightness = useCallback(async () => {
    try {
      if (previousBrightnessRef.current === null) {
        previousBrightnessRef.current = await Brightness.getBrightnessAsync();
      }
      await Brightness.setBrightnessAsync(1);
    } catch {
      /* brightness control unavailable — QR still renders */
    }
  }, []);

  const restoreBrightness = useCallback(async () => {
    try {
      if (previousBrightnessRef.current !== null) {
        await Brightness.setBrightnessAsync(previousBrightnessRef.current);
        previousBrightnessRef.current = null;
      }
    } catch {
      /* ignore */
    }
  }, []);

  // Boost on mount, restore on unmount.
  useEffect(() => {
    void boostBrightness();
    return () => { void restoreBrightness(); };
  }, [boostBrightness, restoreBrightness]);

  // iOS resets app brightness when backgrounded — re-assert on foreground.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") void boostBrightness();
    });
    return () => sub.remove();
  }, [boostBrightness]);

  useEffect(() => {
    const interval = setInterval(() => {
      const remaining = Math.max(0, Math.floor((expiresAt - Date.now()) / 1000));
      setSecondsLeft(remaining);
      if (remaining <= 0) {
        clearInterval(interval);
        onExpired();
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [expiresAt, onExpired]);

  const minutes = Math.floor(secondsLeft / 60);
  const seconds = secondsLeft % 60;
  const timeLabel = `${minutes}:${seconds.toString().padStart(2, "0")}`;
  const expired = secondsLeft <= 0;

  const handleClose = useCallback(() => {
    void restoreBrightness();
    onClose();
  }, [onClose, restoreBrightness]);

  return (
    <View style={styles.container}>
      {/* Soft brand glow behind the code (decorative only). */}
      <LinearGradient
        colors={["#1c0b2a", "#080810"]}
        style={StyleSheet.absoluteFill}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 1 }}
      />

      <Text style={styles.title}>{t("qr.boardingTitle")}</Text>
      <Text style={styles.subtitle}>{t("qr.boardingSubtitle")}</Text>

      {/* Max-contrast QR surface — solid white, never tinted/blurred. */}
      <Pressable onPress={boostBrightness} style={styles.qrCardWrap}>
        <View style={styles.qrCard}>
          {expired ? (
            <View style={styles.expiredBox}>
              <Ionicons name="time-outline" size={40} color="#080810" />
              <Text style={styles.expiredText}>{t("qr.expired")}</Text>
            </View>
          ) : (
            <QRCode value={token} size={232} backgroundColor="#ffffff" color="#000000" quietZone={16} />
          )}
        </View>
      </Pressable>

      {/* Brightness affordance */}
      <View style={styles.brightnessPill}>
        <Ionicons name="sunny" size={14} color="#fbbf24" />
        <Text style={styles.brightnessText}>{t("qr.brightnessBoosted")}</Text>
      </View>

      {expired ? (
        <Pressable style={styles.primaryBtn} onPress={onExpired}>
          <Ionicons name="refresh" size={18} color="#fff" />
          <Text style={styles.primaryBtnText}>{t("qr.regenerate")}</Text>
        </Pressable>
      ) : (
        <Text style={styles.timer}>{t("qr.expiresIn", { time: timeLabel })}</Text>
      )}

      <Pressable style={styles.closeBtn} onPress={handleClose}>
        <Text style={styles.closeBtnText}>{t("qr.close")}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#080810",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  title: {
    color: "#fff",
    fontSize: 24,
    fontWeight: "800",
    marginBottom: 6,
  },
  subtitle: {
    color: "#e09af7",
    fontSize: 14,
    marginBottom: 30,
    textAlign: "center",
  },
  qrCardWrap: {
    borderRadius: 28,
    marginBottom: 18,
    shadowColor: "#8938D5",
    shadowOpacity: 0.5,
    shadowRadius: 28,
    shadowOffset: { width: 0, height: 8 },
    elevation: 16,
  },
  qrCard: {
    padding: 20,
    backgroundColor: "#ffffff",
    borderRadius: 28,
    alignItems: "center",
    justifyContent: "center",
  },
  expiredBox: {
    width: 232,
    height: 232,
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  },
  expiredText: {
    color: "#080810",
    fontSize: 16,
    fontWeight: "700",
  },
  brightnessPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "rgba(251,191,36,0.12)",
    borderWidth: 1,
    borderColor: "rgba(251,191,36,0.3)",
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 6,
    marginBottom: 22,
  },
  brightnessText: {
    color: "#fbbf24",
    fontSize: 12,
    fontWeight: "600",
  },
  timer: {
    color: "#fbbf24",
    fontSize: 18,
    fontWeight: "700",
    marginBottom: 28,
  },
  primaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#8938D5",
    paddingHorizontal: 28,
    paddingVertical: 14,
    borderRadius: 14,
    marginBottom: 16,
  },
  primaryBtnText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "700",
  },
  closeBtn: {
    backgroundColor: "rgba(255,255,255,0.08)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.16)",
    paddingHorizontal: 48,
    paddingVertical: 14,
    borderRadius: 14,
  },
  closeBtnText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
});
