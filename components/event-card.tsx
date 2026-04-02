import type { PromotedEvent } from "@/constants/events";
import { useLanguage } from "@/context/LanguageContext";
import { LinearGradient } from "expo-linear-gradient";
import React from "react";
import { Alert, StyleSheet, Text, TouchableOpacity, View } from "react-native";

const FIRE = "#f97316";
const FIRE_DIM = "rgba(249,115,22,0.15)";
const CARD_GRAD = ["#080810", "#0f0f1e"] as const //["#0d0d0d", "#1a1a1a"] as const;

export default function EventCard({
  event,
  onPress,
}: {
  event: PromotedEvent;
  onPress: () => void;
}) {
  const { t, language } = useLanguage();

  const isFr = language === "fr";
  const name = isFr ? event.nameFr : event.name;
  const tag = isFr ? event.tagFr : event.tag;
  const description = isFr ? event.descriptionFr : event.description;

  const ticketLabel =
    event.ticketPrice !== undefined
      ? t("events.ticketPrice", { price: (event.ticketPrice / 100).toFixed(2) })
      : t("events.freeEntry");

  const handleBuyTicket = () => {
    Alert.alert(t("events.comingSoon"), t("events.comingSoonTicket"));
  };

  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.82} style={s.wrap}>
      <LinearGradient colors={CARD_GRAD} style={s.card}>
        {/* Left fire accent bar */}
        <View style={s.accentBar} />

        <View style={s.body}>
          {/* Top row: name + promoted badge */}
          <View style={s.topRow}>
            <View style={s.nameRow}>
              <Text style={{fontSize: 13}}>🔥</Text>
              <Text style={s.name} numberOfLines={1}>{name}</Text>
            </View>
            <View style={s.promotedBadge}>
              <Text style={s.promotedText}>{t("events.promoted")}</Text>
            </View>
          </View>

          {/* Tag pill */}
          <View style={s.tagPill}>
            <Text style={s.tagText}>{tag}</Text>
          </View>

          {/* Venue + date */}
          <View style={s.metaRow}>
            <Text style={{fontSize: 10}}>📍</Text>
            <Text style={s.metaText} numberOfLines={1}>{event.venue}</Text>
          </View>
          <View style={[s.metaRow, { marginTop: 3 }]}>
            <Text style={{fontSize: 10}}>📅</Text>
            <Text style={s.metaText}>{event.date}</Text>
          </View>

          {/* Description */}
          <Text style={s.desc} numberOfLines={2}>{description}</Text>

          {/* Bottom row: find ride + buy ticket */}
          <View style={s.bottomRow}>
            <TouchableOpacity onPress={onPress} style={s.rideCta} activeOpacity={0.75}>
              <Text style={s.rideCtaText}>{t("events.findRideNearby")}</Text>
              <Text style={{fontSize: 11, color: FIRE}}>→</Text>
            </TouchableOpacity>

            {/*<TouchableOpacity onPress={handleBuyTicket} style={s.ticketBtn} activeOpacity={0.8}>
              <Text style={s.ticketIcon}>🎟</Text>
              <Text style={s.ticketBtnText}>{ticketLabel}</Text>
            </TouchableOpacity>*/}
          </View>
        </View>
      </LinearGradient>
    </TouchableOpacity>
  );
}

const s = StyleSheet.create({
  wrap: {
    width: 260,
    borderRadius: 16,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOpacity: 0.5,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  card: {
    flexDirection: "row",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(249,115,22,0.18)",
    overflow: "hidden",
  },
  accentBar: {
    width: 4,
    backgroundColor: FIRE,
    borderTopLeftRadius: 16,
    borderBottomLeftRadius: 16,
  },
  body: {
    flex: 1,
    padding: 14,
    gap: 5,
  },
  topRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  nameRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    flex: 1,
  },
  name: {
    color: "#f3f4f6",
    fontSize: 15,
    fontWeight: "700",
    flex: 1,
  },
  promotedBadge: {
    backgroundColor: "rgba(255,255,255,0.05)",
    borderRadius: 5,
    paddingHorizontal: 5,
    paddingVertical: 2,
    marginLeft: 6,
  },
  promotedText: {
    color: "#4b5563",
    fontSize: 8,
    fontWeight: "700",
    letterSpacing: 0.8,
  },
  tagPill: {
    alignSelf: "flex-start",
    backgroundColor: FIRE_DIM,
    borderWidth: 1,
    borderColor: "rgba(249,115,22,0.35)",
    borderRadius: 20,
    paddingHorizontal: 9,
    paddingVertical: 3,
  },
  tagText: {
    color: FIRE,
    fontSize: 11,
    fontWeight: "600",
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  metaText: {
    color: "#6b7280",
    fontSize: 12,
    flex: 1,
  },
  desc: {
    color: "#4b5563",
    fontSize: 11,
    lineHeight: 16,
    marginTop: 2,
  },
  bottomRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 8,
    gap: 8,
  },
  rideCta: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
  },
  rideCtaText: {
    color: FIRE,
    fontSize: 11,
    fontWeight: "600",
  },
  ticketBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "rgba(249,115,22,0.12)",
    borderWidth: 1,
    borderColor: "rgba(249,115,22,0.3)",
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  ticketIcon: {
    fontSize: 11,
  },
  ticketBtnText: {
    color: FIRE,
    fontSize: 11,
    fontWeight: "700",
  },
});
