import { clampHypeScore, type HypeEvent } from "@/constants/events";
import { useLanguage } from "@/context/LanguageContext";
import { useUserProfile } from "@/context/UserProfileContext";
import { fetchEventById, toggleEventInterest } from "@/services/eventService";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Ionicons } from "@expo/vector-icons";
import { BlurView } from "expo-blur";
import { LinearGradient } from "expo-linear-gradient";
import React, { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Dimensions, Modal, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const countCacheKey = (id: string) => `@hype_count_${id}`;

async function loadCachedCount(id: string): Promise<number | null> {
  try {
    const raw = await AsyncStorage.getItem(countCacheKey(id));
    if (raw === null) return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

async function saveCachedCount(id: string, n: number): Promise<void> {
  try {
    await AsyncStorage.setItem(countCacheKey(id), String(n));
  } catch {
    // cache write failing is non-fatal
  }
}

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
  const { userData, updateUserData } = useUserProfile();
  const isFr = language === "fr";

  const name = event ? (isFr && event.nameFr ? event.nameFr : event.name) : "";
  const description = event ? (isFr && event.descriptionFr ? event.descriptionFr : event.description) : "";
  const tag = event ? (isFr && event.tagFr ? event.tagFr : event.tag) : "";
  const score = event ? clampHypeScore(event.score) : 0;

  // Interest counter — cache is shown instantly; server confirms and detects external changes.
  const [interested, setInterested] = useState(false);
  const [count, setCount] = useState(0);
  const [toggling, setToggling] = useState(false);
  // Tracks the last count we wrote to / confirmed from the server so the poll
  // can tell whether a change came from another device.
  const serverCountRef = useRef<number | null>(null);

  // On new event: show cached count immediately, then let the server confirm.
  useEffect(() => {
    if (!event) return;
    const propCount = event.attendeeCount ?? 0;
    serverCountRef.current = null;
    loadCachedCount(event.id).then((cached) => {
      setCount(cached ?? propCount);
    });
  }, [event?.id]);

  // Sync the interested flag whenever the user's list changes (e.g. opened from profile).
  useEffect(() => {
    if (!event) return;
    setInterested(userData?.interestedEvents?.includes(event.id) ?? false);
  }, [event?.id, userData?.interestedEvents]);

  // Poll the attendee count while the card is open. Only update the display if the
  // server count differs from our last known server value — meaning another device
  // changed it. Skipped while the user's own toggle is in flight.
  useEffect(() => {
    if (!event || toggling) return;
    const id = setInterval(async () => {
      const fresh = await fetchEventById(event.id);
      if (!fresh) return;
      const serverCount = fresh.attendeeCount ?? 0;
      if (serverCountRef.current === null || serverCount !== serverCountRef.current) {
        serverCountRef.current = serverCount;
        setCount(serverCount);
        saveCachedCount(event.id, serverCount);
      }
    }, 5000);
    return () => clearInterval(id);
  }, [event, toggling]);

  const handleToggleInterest = async () => {
    if (!event || toggling) return;
    setToggling(true);
    // Optimistic update.
    const optimistic = !interested;
    setInterested(optimistic);
    setCount((c) => Math.max(0, c + (optimistic ? 1 : -1)));
    try {
      const result = await toggleEventInterest(event.id);
      setInterested(result.interested);
      setCount(result.attendeeCount);
      serverCountRef.current = result.attendeeCount;
      saveCachedCount(event.id, result.attendeeCount);
      // Keep the profile context in sync so the saved-events list updates.
      const current = userData?.interestedEvents ?? [];
      const nextList = result.interested
        ? Array.from(new Set([...current, event.id]))
        : current.filter((id) => id !== event.id);
      updateUserData({ interestedEvents: nextList });
    } catch {
      // Revert on failure.
      setInterested(!optimistic);
      setCount((c) => Math.max(0, c + (optimistic ? -1 : 1)));
    } finally {
      setToggling(false);
    }
  };

  return (
    <Modal visible={event !== null} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.overlay}>
        <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={onClose} />

        <View style={[styles.sheet, { maxHeight: SHEET_MAX_HEIGHT, paddingBottom: Math.max(insets.bottom, 16) + 16 }]}>
          <BlurView intensity={60} tint="dark" experimentalBlurMethod="dimezisBlurView" style={StyleSheet.absoluteFill} pointerEvents="none" />
          <View style={styles.scrim} pointerEvents="none" />

          {event && (
            <View style={styles.content}>
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
              </View>

              {/* Description */}
              {description ? (
                <Text style={styles.desc}>{description}</Text>
              ) : null}

              {/* Interested counter + toggle */}
              <View style={styles.peopleRow}>
                <View style={styles.peopleLeft}>
                  <Ionicons name="people" size={16} color={interested ? C.fire : C.dim} />
                  <Text style={styles.peopleCount}>{count}</Text>
                  <Text style={styles.peopleLabel}>{t("hypeEvent.peopleGoing")}</Text>
                </View>
                <TouchableOpacity
                  onPress={handleToggleInterest}
                  disabled={toggling}
                  activeOpacity={0.8}
                  style={[styles.interestBtn, interested && styles.interestBtnActive]}
                >
                  {toggling ? (
                    <ActivityIndicator size="small" color={interested ? "#fff" : C.fire} />
                  ) : (
                    <>
                      <Ionicons
                        name={interested ? "checkmark-circle" : "add-circle-outline"}
                        size={15}
                        color={interested ? "#fff" : C.fire}
                      />
                      <Text style={[styles.interestBtnText, interested && styles.interestBtnTextActive]}>
                        {interested ? t("hypeEvent.interested") : t("hypeEvent.markInterested")}
                      </Text>
                    </>
                  )}
                </TouchableOpacity>
              </View>

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
            </View>
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

  desc: { color: C.dim, fontSize: 14, lineHeight: 20, marginTop: 14 },

  peopleRow: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    marginTop: 16, backgroundColor: "rgba(255,255,255,0.03)",
    borderWidth: 1, borderColor: "rgba(255,255,255,0.07)", borderRadius: 14,
    paddingHorizontal: 14, paddingVertical: 12,
  },
  peopleLeft: { flexDirection: "row", alignItems: "center", gap: 7 },
  peopleCount: { color: C.text, fontSize: 16, fontWeight: "800" },
  peopleLabel: { color: C.dim, fontSize: 14, fontWeight: "600" },
  interestBtn: {
    flexDirection: "row", alignItems: "center", gap: 6,
    backgroundColor: "rgba(249,115,22,0.12)", borderWidth: 1, borderColor: "rgba(249,115,22,0.4)",
    borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, minWidth: 118, justifyContent: "center",
  },
  interestBtnActive: { backgroundColor: C.fire, borderColor: C.fire },
  interestBtnText: { color: C.fire, fontSize: 13, fontWeight: "800" },
  interestBtnTextActive: { color: "#fff" },

  ctaWrap: { marginTop: 20, borderRadius: 16, overflow: "hidden" },
  ctaGrad: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    paddingVertical: 17,
  },
  ctaText: { color: "#fff", fontSize: 17, fontWeight: "800", letterSpacing: 0.3 },
});
