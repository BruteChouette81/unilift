import { clampHypeScore, type HypeEvent } from "@/constants/events";
import { useLanguage } from "@/context/LanguageContext";
import { useUserProfile } from "@/context/UserProfileContext";
import { fetchHypeEvents, loadCachedHypeEvents, toggleEventInterest } from "@/services/eventService";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from "react-native";

const C = {
  surface: "rgba(255,255,255,0.05)",
  border: "rgba(255,255,255,0.10)",
  fire: "#f97316",
  fireDim: "rgba(249,115,22,0.14)",
  purpleLight: "#e09af7",
  text: "#f3f4f6",
  muted: "#9ca3af",
  dim: "#4b5563",
};

/** Glass list of the events the user marked as interested. Reads the ids from
 *  the profile context, resolves the event details, and lets the user un-save. */
export function InterestedEventsList() {
  const { t, language } = useLanguage();
  const { userData, updateUserData } = useUserProfile();
  const isFr = language === "fr";
  const ids = userData?.interestedEvents ?? [];
  const idsKey = ids.join(",");

  const [events, setEvents] = useState<HypeEvent[]>([]);
  const [loading, setLoading] = useState(false);

  const reload = useCallback(async () => {
    if (ids.length === 0) { setEvents([]); return; }
    setLoading(true);
    try {
      // null = fetch failed; fall back to the cached set rather than showing
      // an empty saved-events list.
      const all = (await fetchHypeEvents()) ?? (await loadCachedHypeEvents());
      const set = new Set(ids);
      setEvents(all.filter((e) => set.has(e.id)));
    } catch {
      /* keep previous */
    } finally {
      setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey]);

  useEffect(() => { void reload(); }, [reload]);

  const removeInterest = async (eventId: string) => {
    // Optimistic: drop from the list + context, then sync the server.
    setEvents((prev) => prev.filter((e) => e.id !== eventId));
    updateUserData({ interestedEvents: ids.filter((id) => id !== eventId) });
    try {
      await toggleEventInterest(eventId);
    } catch {
      void reload();
    }
  };

  if (ids.length === 0) {
    return (
      <View style={styles.empty}>
        <View style={styles.emptyIcon}>
          <Ionicons name="flame-outline" size={22} color={C.purpleLight} />
        </View>
        <Text style={styles.emptyTitle}>{t("hypeEvent.savedEmpty")}</Text>
        <Text style={styles.emptySub}>{t("hypeEvent.savedEmptySub")}</Text>
      </View>
    );
  }

  if (loading && events.length === 0) {
    return <ActivityIndicator color={C.purpleLight} style={{ marginVertical: 18 }} />;
  }

  return (
    <View style={{ gap: 10 }}>
      {events.map((ev) => {
        const name = isFr && ev.nameFr ? ev.nameFr : ev.name;
        const meta = [ev.venue, ev.date, ev.time].filter(Boolean).join("  ·  ");
        return (
          <View key={ev.id} style={styles.card}>
            <LinearGradient
              colors={["rgba(249,115,22,0.16)", "rgba(249,115,22,0.04)"]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.flameWrap}
            >
              <Ionicons name="flame" size={20} color={C.fire} />
              <Text style={styles.scoreText}>{clampHypeScore(ev.score)}</Text>
            </LinearGradient>

            <View style={{ flex: 1 }}>
              <Text style={styles.name} numberOfLines={1}>{name}</Text>
              <Text style={styles.meta} numberOfLines={1}>{meta}</Text>
              {ev.attendeeCount !== undefined && ev.attendeeCount > 0 ? (
                <Text style={styles.attendees}>
                  {ev.attendeeCount} {t("hypeEvent.peopleGoing")}
                </Text>
              ) : null}
            </View>

            <TouchableOpacity
              onPress={() => removeInterest(ev.id)}
              hitSlop={8}
              style={styles.removeBtn}
              activeOpacity={0.7}
            >
              <Ionicons name="bookmark" size={18} color={C.fire} />
            </TouchableOpacity>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: C.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: C.border,
    padding: 12,
  },
  flameWrap: {
    width: 46,
    height: 46,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(249,115,22,0.3)",
  },
  scoreText: { color: C.fire, fontSize: 10, fontWeight: "800", marginTop: -2 },
  name: { color: C.text, fontSize: 15, fontWeight: "700" },
  meta: { color: C.muted, fontSize: 12, marginTop: 2 },
  attendees: { color: C.fire, fontSize: 11, fontWeight: "700", marginTop: 3 },
  removeBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: C.fireDim,
    borderWidth: 1,
    borderColor: "rgba(249,115,22,0.3)",
  },

  empty: {
    alignItems: "center",
    paddingVertical: 26,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: C.border,
    gap: 5,
  },
  emptyIcon: {
    width: 50,
    height: 50,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(137,56,213,0.1)",
    borderWidth: 1,
    borderColor: "rgba(137,56,213,0.25)",
    marginBottom: 4,
  },
  emptyTitle: { color: C.text, fontSize: 14, fontWeight: "700" },
  emptySub: { color: C.dim, fontSize: 12, textAlign: "center", paddingHorizontal: 30, lineHeight: 17 },
});
