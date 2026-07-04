import React, { useCallback, useMemo, useState } from "react";
import { FlatList, StyleSheet, Text, View, Pressable } from "react-native";
import type { Ride } from "@/types/models";
import { useLanguage } from "@/context/LanguageContext";
import type { Language } from "@/constants/translations";

const C = {
  bg:          "#080810",
  surface:     "#0f0f1e",
  surfaceAlt:  "#13132a",
  border:      "rgba(124, 58, 237, 0.22)",
  borderFaint: "rgba(255, 255, 255, 0.06)",
  purple:      "#7C3AED",
  purpleLight: "#a78bfa",
  purpleFaint: "rgba(124,58,237,0.12)",
  green:       "#10b981",
  greenFaint:  "rgba(16,185,129,0.12)",
  gold:        "#fbbf24",
  text:        "#f3f4f6",
  muted:       "#9ca3af",
  dim:         "#4b5563",
};

type PassengerRidesListProps = {
  rides: Ride[];
  userId: string;
};

function formatDate(iso: string, language: Language): { weekday: string; date: string; time: string } {
  const locale = language === "fr" ? "fr-CA" : "en-CA";
  const d = new Date(iso);
  return {
    weekday: d.toLocaleDateString(locale, { weekday: "short" }),
    date:    d.toLocaleDateString(locale, { month: "short", day: "numeric" }),
    time:    d.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" }),
  };
}

export function PassengerRidesList({ rides, userId }: PassengerRidesListProps) {
  const { t, language } = useLanguage();
  const [expanded, setExpanded] = useState(false);

  const passengerRides = useMemo(
    () =>
      rides
        .filter(
          (ride) =>
            ride.passengers.includes(userId) &&
            ride.driverId !== userId &&
            ride.status === "completed",
        )
        .sort((a, b) => {
          const dateA = a.date ?? a.startedAt ?? "";
          const dateB = b.date ?? b.startedAt ?? "";
          return dateB.localeCompare(dateA);
        }),
    [rides, userId],
  );

  const displayedRides = expanded ? passengerRides : passengerRides.slice(0, 3);

  const keyExtractor = useCallback((item: Ride) => item.id, []);

  const renderItem = useCallback(
    ({ item, index }: { item: Ride; index: number }) => {
      const formatted = item.date ? formatDate(item.date, language) : null;
      const isFirst = index === 0;
      const passengerCount = item.passengers?.length ?? 0;
      const totalSeats = passengerCount + item.seatsAvailable;

      return (
        <View style={styles.row}>
          {/* Timeline dot */}
          <View style={styles.timeline}>
            <View style={[styles.dot, styles.dotCompleted]} />
            <View style={styles.line} />
          </View>

          {/* Card */}
          <View style={[styles.card, isFirst && styles.cardFirst]}>
            {/* Header row */}
            <View style={styles.cardHeader}>
              <View style={styles.dateBadge}>
                {formatted ? (
                  <>
                    <Text style={styles.dateBadgeWeekday}>{formatted.weekday}</Text>
                    <Text style={styles.dateBadgeDate}>{formatted.date}</Text>
                  </>
                ) : (
                  <Text style={styles.dateBadgeDate}>—</Text>
                )}
              </View>

              <View style={styles.completedBadge}>
                <Text style={styles.completedBadgeText}>{t("rides.rideCompleted")}</Text>
              </View>
            </View>

            {/* Destination */}
            <View style={styles.destinationRow}>
              <View style={styles.destIconWrap}>
                <Text style={{ fontSize: 12 }}>📍</Text>
              </View>
              <Text style={styles.destination} numberOfLines={1}>
                {item.destination}
              </Text>
            </View>

            {/* Meta */}
            <View style={styles.metaRow}>
              {formatted && (
                <View style={styles.metaChip}>
                  <Text style={{ fontSize: 10 }}>⏱</Text>
                  <Text style={styles.metaText}>{formatted.time}</Text>
                </View>
              )}
              <View style={styles.metaChip}>
                <Text style={{ fontSize: 10 }}>🚗</Text>
                <Text style={styles.metaText}>{item.driverName ?? t("rides.unknownDriver")}</Text>
              </View>
              <View style={styles.metaChip}>
                <Text style={{ fontSize: 10 }}>👥</Text>
                <Text style={styles.metaText}>
                  {t("rides.passengersCount", { current: passengerCount, total: totalSeats })}
                </Text>
              </View>
            </View>
          </View>
        </View>
      );
    },
    [t, language],
  );

  if (passengerRides.length === 0) {
    return (
      <View style={styles.empty}>
        <View style={styles.emptyIconWrap}>
          <Text style={{ fontSize: 22 }}>🎒</Text>
        </View>
        <Text style={styles.emptyTitle}>{t("rides.noPassengerRides")}</Text>
        <Text style={styles.emptySubtext}>{t("rides.noPassengerRidesSub")}</Text>
      </View>
    );
  }

  return (
    <View>
      <FlatList
        data={displayedRides}
        keyExtractor={keyExtractor}
        renderItem={renderItem}
        contentContainerStyle={{ paddingBottom: 24 }}
        scrollEnabled={false}
        removeClippedSubviews
        initialNumToRender={4}
        maxToRenderPerBatch={8}
        windowSize={5}
      />
      {passengerRides.length > 3 && !expanded && (
        <Pressable
          onPress={() => setExpanded(true)}
          style={styles.seeMoreBtn}
        >
          <Text style={styles.seeMoreText}>
            {t("rides.seeMore", { count: passengerRides.length - 3 })}
          </Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  // ── Timeline layout ──────────────────────────────────────────────────────
  row: {
    flexDirection: "row",
    marginBottom: 12,
  },
  timeline: {
    width: 28,
    alignItems: "center",
    paddingTop: 20,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: C.dim,
    borderWidth: 2,
    borderColor: C.surfaceAlt,
    zIndex: 1,
  },
  dotActive: {
    backgroundColor: C.green,
    borderColor: C.greenFaint,
  },
  dotCompleted: {
    backgroundColor: C.purple,
    borderColor: C.purpleFaint,
  },
  line: {
    flex: 1,
    width: 2,
    backgroundColor: C.border,
    marginTop: 4,
  },

  // ── Card ─────────────────────────────────────────────────────────────────
  card: {
    flex: 1,
    backgroundColor: C.surfaceAlt,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: C.border,
    padding: 14,
    gap: 10,
  },
  cardFirst: {
    borderColor: "rgba(124,58,237,0.4)",
  },

  // ── Card header ──────────────────────────────────────────────────────────
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  dateBadge: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: 5,
  },
  dateBadgeWeekday: {
    color: C.purpleLight,
    fontSize: 12,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  dateBadgeDate: {
    color: C.text,
    fontSize: 14,
    fontWeight: "700",
  },
  completedBadge: {
    backgroundColor: C.purpleFaint,
    borderRadius: 20,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderWidth: 1,
    borderColor: C.border,
  },
  completedBadgeText: {
    color: C.purpleLight,
    fontSize: 11,
    fontWeight: "600",
  },

  // ── Destination ──────────────────────────────────────────────────────────
  destinationRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  destIconWrap: {
    width: 24,
    height: 24,
    borderRadius: 6,
    backgroundColor: C.purpleFaint,
    alignItems: "center",
    justifyContent: "center",
  },
  destination: {
    color: C.text,
    fontSize: 15,
    fontWeight: "600",
    flex: 1,
  },

  // ── Meta chips ───────────────────────────────────────────────────────────
  metaRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  metaChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderRadius: 6,
    paddingHorizontal: 7,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: C.borderFaint,
  },
  metaText: {
    color: C.muted,
    fontSize: 11,
  },

  // ── Empty state ──────────────────────────────────────────────────────────
  empty: {
    alignItems: "center",
    paddingVertical: 32,
    gap: 6,
  },
  emptyIconWrap: {
    width: 48,
    height: 48,
    borderRadius: 14,
    backgroundColor: C.purpleFaint,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
    borderWidth: 1,
    borderColor: C.border,
  },
  emptyTitle: {
    color: C.text,
    fontSize: 15,
    fontWeight: "700",
  },
  emptySubtext: {
    color: C.dim,
    fontSize: 13,
  },

  // ── See More Button ──────────────────────────────────────────────────────
  seeMoreBtn: {
    alignItems: "center",
    paddingVertical: 12,
    paddingHorizontal: 16,
    marginHorizontal: 28,
    marginBottom: 24,
    backgroundColor: C.purpleFaint,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: C.border,
  },
  seeMoreText: {
    color: C.purpleLight,
    fontSize: 13,
    fontWeight: "600",
  },
});
