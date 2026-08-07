import { clampHypeScore, type HypeEvent } from "@/constants/events";
import { devLog } from "@/constants/runtime-config";
import { useLanguage } from "@/context/LanguageContext";
import { openDirectionsTo } from "@/utils/gmapsHint";
import { Ionicons } from "@expo/vector-icons";
import { BlurView } from "expo-blur";
import { LinearGradient } from "expo-linear-gradient";
import React from "react";
import { Dimensions, Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const C = {
  fire: "#f97316",
  fireDim: "rgba(249,115,22,0.15)",
  purple: "#8938D5",
  purpleLight: "#e09af7",
  gold: "#fbbf24",
  text: "#f3f4f6",
  muted: "#cbd5e1",
  dim: "#9ca3af",
  border: "rgba(255,255,255,0.12)",
  scrim: "rgba(10,8,18,0.82)",
};

const SHEET_MAX_HEIGHT = Dimensions.get("window").height * 0.85;

function ticketLabel(cents: number | undefined, free: string): string {
  if (cents === undefined) return free;
  return `$${(cents / 100).toFixed(2)}`;
}

export default function HypeEventCard({
  event,
  onClose,
  onAccess,
}: {
  event: HypeEvent | null;
  onClose: () => void;
  onAccess: (event: HypeEvent) => void;
}) {
  const { t, language } = useLanguage();
  const insets = useSafeAreaInsets();
  const isFr = language === "fr";

  const name = event ? (isFr && event.nameFr ? event.nameFr : event.name) : "";
  const description = event ? (isFr && event.descriptionFr ? event.descriptionFr : event.description) : "";
  const tag = event ? (isFr && event.tagFr ? event.tagFr : event.tag) : "";
  const score = event ? clampHypeScore(event.score) : 0;

  devLog(`[HYPE-DEBUG] HypeEventCard render — event=${event ? event.id : "null"} score=${score}`);

  return (
    <Modal visible={event !== null} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.overlay}>
        <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={onClose} />

        <View style={[styles.sheet, { maxHeight: SHEET_MAX_HEIGHT, paddingBottom: Math.max(insets.bottom, 16) + 16 }]}>
          <BlurView intensity={60} tint="dark" experimentalBlurMethod="dimezisBlurView" style={StyleSheet.absoluteFill} pointerEvents="none" />
          <View style={styles.scrim} pointerEvents="none" />

          {event && (
            <ScrollView
              style={styles.content}
              contentContainerStyle={{ paddingBottom: 8 }}
              showsVerticalScrollIndicator={false}
            >
              {/* Drag handle */}
              <View style={styles.dragZone}>
                <View style={styles.handle} />
              </View>

              {/* Hype level + eyebrow */}
              <View style={styles.topRow}>
                <View style={styles.hypePill}>
                  <Ionicons name="flame" size={14} color={C.fire} />
                  <Text style={styles.hypePillText}>{t("hypeEvent.hypeLevel", { score })}</Text>
                </View>
                <TouchableOpacity onPress={onClose} hitSlop={8} style={styles.closeIcon}>
                  <Ionicons name="close" size={20} color={C.dim} />
                </TouchableOpacity>
              </View>

              {/* Name */}
              <Text style={styles.name} numberOfLines={2}>{name}</Text>

              {/* Tag */}
              {tag ? (
                <View style={styles.tagPill}>
                  <Text style={styles.tagText}>{tag}</Text>
                </View>
              ) : null}

              {/* Meta rows */}
              <View style={styles.metaCard}>
                <View style={styles.metaRow}>
                  <Ionicons name="location-sharp" size={15} color={C.purpleLight} />
                  <Text style={styles.metaText} numberOfLines={1}>{event.venue}</Text>
                </View>
                {(event.date || event.time) ? (
                  <View style={styles.metaRow}>
                    <Ionicons name="calendar-outline" size={15} color={C.purpleLight} />
                    <Text style={styles.metaText} numberOfLines={1}>
                      {[event.date, event.time].filter(Boolean).join("  ·  ")}
                    </Text>
                  </View>
                ) : null}
                <View style={styles.metaRow}>
                  <Ionicons name="ticket-outline" size={15} color={C.fire} />
                  <Text style={[styles.metaText, { color: C.fire, fontWeight: "700" }]}>
                    {ticketLabel(event.ticketPriceCents, t("events.freeEntry"))}
                  </Text>
                </View>
                {event.attendeeCount !== undefined && event.attendeeCount > 0 ? (
                  <View style={styles.metaRow}>
                    <Ionicons name="people" size={15} color={C.purpleLight} />
                    <Text style={styles.metaText}>
                      {event.attendeeCount} {t("hypeEvent.peopleGoing")}
                    </Text>
                  </View>
                ) : null}
              </View>

              {/* Get directions */}
              <TouchableOpacity
                activeOpacity={0.8}
                onPress={() => void openDirectionsTo({ latitude: event.lat, longitude: event.lng }, t)}
                style={styles.directionsBtn}
              >
                <Ionicons name="navigate-outline" size={16} color={C.purpleLight} />
                <Text style={styles.directionsBtnText}>{t("hypeEvent.getDirections")}</Text>
              </TouchableOpacity>

              {/* Description */}
              {description ? (
                <Text style={styles.desc}>{description}</Text>
              ) : null}

              {/* Access event → normal lift flow */}
              <TouchableOpacity activeOpacity={0.85} onPress={() => onAccess(event)} style={styles.ctaWrap}>
                <LinearGradient
                  colors={[C.purple, C.fire]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={styles.ctaGrad}
                >
                  <Ionicons name="car-sport" size={18} color="#fff" />
                  <Text style={styles.ctaText}>{t("hypeEvent.accessEvent")}</Text>
                </LinearGradient>
              </TouchableOpacity>
            </ScrollView>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.55)" },
  sheet: {
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    overflow: "hidden",
    borderWidth: 1,
    borderBottomWidth: 0,
    borderColor: C.border,
  },
  scrim: { ...StyleSheet.absoluteFillObject, backgroundColor: C.scrim },
  content: { paddingHorizontal: 22 },

  dragZone: { width: "100%", alignItems: "center", paddingVertical: 12 },
  handle: { width: 44, height: 4, borderRadius: 2, backgroundColor: "rgba(255,255,255,0.25)" },

  topRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 },
  hypePill: {
    flexDirection: "row", alignItems: "center", gap: 6,
    backgroundColor: C.fireDim, borderWidth: 1, borderColor: "rgba(249,115,22,0.4)",
    borderRadius: 20, paddingHorizontal: 12, paddingVertical: 6,
  },
  hypePillText: { color: C.fire, fontSize: 13, fontWeight: "800" },
  closeIcon: {
    width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.06)",
  },

  name: { color: C.text, fontSize: 24, fontWeight: "900", lineHeight: 29 },

  tagPill: {
    alignSelf: "flex-start", marginTop: 8,
    backgroundColor: "rgba(137,56,213,0.16)", borderWidth: 1, borderColor: "rgba(137,56,213,0.4)",
    borderRadius: 20, paddingHorizontal: 11, paddingVertical: 4,
  },
  tagText: { color: C.purpleLight, fontSize: 12, fontWeight: "700" },

  metaCard: {
    marginTop: 16, gap: 11,
    backgroundColor: "rgba(255,255,255,0.05)", borderWidth: 1, borderColor: "rgba(255,255,255,0.09)",
    borderRadius: 16, padding: 14,
  },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  metaText: { color: C.muted, fontSize: 14, fontWeight: "600", flex: 1 },

  directionsBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7,
    marginTop: 14, backgroundColor: "rgba(137,56,213,0.10)",
    borderWidth: 1, borderColor: "rgba(137,56,213,0.30)",
    borderRadius: 12, paddingVertical: 11,
  },
  directionsBtnText: { color: C.purpleLight, fontSize: 13.5, fontWeight: "700" },

  desc: { color: C.dim, fontSize: 14, lineHeight: 20, marginTop: 14 },

  ctaWrap: { marginTop: 20, borderRadius: 16, overflow: "hidden" },
  ctaGrad: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    paddingVertical: 17,
  },
  ctaText: { color: "#fff", fontSize: 17, fontWeight: "800", letterSpacing: 0.3 },
});
