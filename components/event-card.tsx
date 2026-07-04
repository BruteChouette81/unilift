import type { PromotedEvent } from "@/constants/events";
import { useLanguage } from "@/context/LanguageContext";
import { LinearGradient } from "expo-linear-gradient";
import React from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";

// ─── Color palette ────────────────────────────────────────────────────────────
const FIRE        = "#f97316";
const FIRE_DIM    = "rgba(249,115,22,0.15)";
const GOLD        = "#fbbf24";
const GOLD_DIM    = "rgba(251,191,36,0.15)";
const PURPLE      = "#8938D5";
const PURPLE_DIM  = "rgba(137,56,213,0.15)";
const CARD_GRAD   = ["#080810", "#0f0f1e"] as const;
const FEAT_GRAD   = ["#130820", "#0a0514"] as const;

// ─── Helpers ──────────────────────────────────────────────────────────────────
function priceLabel(ticketPrice: number | undefined, free: string, paid: string): string {
  if (ticketPrice === undefined) return free;
  return paid.replace("{{price}}", (ticketPrice / 100).toFixed(2));
}

function useEventStrings(event: PromotedEvent) {
  const { t, language } = useLanguage();
  const isFr = language === "fr";
  return {
    name:        isFr ? event.nameFr        : event.name,
    tag:         isFr ? event.tagFr         : event.tag,
    description: isFr ? event.descriptionFr : event.description,
    ticketLabel: priceLabel(event.ticketPrice, t("events.freeEntry"), t("events.ticketPrice")),
    findRide:    t("events.findRideNearby"),
  };
}

// ─── Standard Card (260px) ────────────────────────────────────────────────────
function StandardCard({ event, onPress, name, tag, description, ticketLabel, findRide }: CardInnerProps) {
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.82} style={s.standardWrap}>
      <LinearGradient colors={CARD_GRAD} style={s.standardCard}>
        <View style={s.accentBar} />
        <View style={s.body}>
          <View style={s.topRow}>
            <View style={s.nameRow}>
              <Text style={{ fontSize: 13 }}>🔥</Text>
              <Text style={s.name} numberOfLines={1}>{name}</Text>
            </View>
            <View style={s.promotedBadge}>
              <Text style={s.promotedText}>AD</Text>
            </View>
          </View>

          <View style={s.tagPill}>
            <Text style={s.tagText}>{tag}</Text>
          </View>

          <View style={s.metaRow}>
            <Text style={{ fontSize: 10 }}>📍</Text>
            <Text style={s.metaText} numberOfLines={1}>{event.venue}</Text>
          </View>
          <View style={s.metaRow}>
            <Text style={{ fontSize: 10 }}>📅</Text>
            <Text style={s.metaText}>{event.date}</Text>
            <Text style={s.metaSep}>·</Text>
            <Text style={{ fontSize: 10 }}>🕙</Text>
            <Text style={s.metaText}>{event.time}</Text>
          </View>

          <View style={s.metaRow}>
            <Text style={{ fontSize: 10 }}>🎟</Text>
            <Text style={[s.metaText, { color: FIRE }]}>{ticketLabel}</Text>
          </View>

          <Text style={s.desc} numberOfLines={2}>{description}</Text>

          <TouchableOpacity onPress={onPress} style={s.rideCta} activeOpacity={0.75}>
            <Text style={s.rideCtaText}>{findRide} →</Text>
          </TouchableOpacity>
        </View>
      </LinearGradient>
    </TouchableOpacity>
  );
}

// ─── Premium Card (310px) ─────────────────────────────────────────────────────
function PremiumCard({ event, onPress, name, tag, description, ticketLabel, findRide }: CardInnerProps) {
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.82} style={s.premiumWrap}>
      <LinearGradient colors={CARD_GRAD} style={s.premiumCard}>
        <View style={[s.accentBar, { backgroundColor: GOLD, width: 5 }]} />
        <View style={s.body}>
          <View style={s.topRow}>
            <View style={s.nameRow}>
              <Text style={{ fontSize: 14 }}>⭐</Text>
              <Text style={[s.name, { fontSize: 16 }]} numberOfLines={1}>{name}</Text>
            </View>
            <View style={[s.promotedBadge, { backgroundColor: GOLD_DIM, borderColor: "rgba(251,191,36,0.4)", borderWidth: 1 }]}>
              <Text style={[s.promotedText, { color: GOLD }]}>PREMIUM</Text>
            </View>
          </View>

          <View style={[s.tagPill, { backgroundColor: GOLD_DIM, borderColor: "rgba(251,191,36,0.4)" }]}>
            <Text style={[s.tagText, { color: GOLD }]}>{tag}</Text>
          </View>

          <View style={s.metaRow}>
            <Text style={{ fontSize: 10 }}>📍</Text>
            <Text style={s.metaText} numberOfLines={1}>{event.venue}</Text>
          </View>
          <View style={s.metaRow}>
            <Text style={{ fontSize: 10 }}>📅</Text>
            <Text style={s.metaText}>{event.date}</Text>
            <Text style={s.metaSep}>·</Text>
            <Text style={{ fontSize: 10 }}>🕙</Text>
            <Text style={s.metaText}>{event.time}</Text>
          </View>

          <View style={[s.priceChip, { backgroundColor: GOLD_DIM, borderColor: "rgba(251,191,36,0.4)" }]}>
            <Text style={{ fontSize: 11 }}>🎟</Text>
            <Text style={[s.priceChipText, { color: GOLD }]}>{ticketLabel}</Text>
          </View>

          <Text style={[s.desc, { fontSize: 12, color: "#9ca3af" }]} numberOfLines={3}>{description}</Text>

          <TouchableOpacity onPress={onPress} style={[s.rideCta, { marginTop: 6 }]} activeOpacity={0.75}>
            <Text style={[s.rideCtaText, { color: GOLD }]}>{findRide} →</Text>
          </TouchableOpacity>
        </View>
      </LinearGradient>
    </TouchableOpacity>
  );
}

// ─── Featured Card (full-width hero) ─────────────────────────────────────────
export function FeaturedEventCard({ event, onPress }: { event: PromotedEvent; onPress: () => void }) {
  const { name, tag, description, ticketLabel, findRide } = useEventStrings(event);

  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.82} style={s.featuredWrap}>
      <LinearGradient colors={FEAT_GRAD} style={s.featuredCard}>
        {/* Top purple gradient bar */}
        <LinearGradient
          colors={[PURPLE, "#f97316"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={s.featuredTopBar}
        />

        <View style={s.featuredBody}>
          {/* Header row */}
          <View style={s.topRow}>
            <View style={[s.promotedBadge, { backgroundColor: PURPLE_DIM, borderColor: "rgba(137,56,213,0.5)", borderWidth: 1 }]}>
              <Text style={[s.promotedText, { color: "#c084fc", fontSize: 9, letterSpacing: 1 }]}>★ FEATURED</Text>
            </View>
            <View style={[s.tagPill, { backgroundColor: PURPLE_DIM, borderColor: "rgba(137,56,213,0.5)", marginLeft: "auto" }]}>
              <Text style={[s.tagText, { color: "#c084fc" }]}>{tag}</Text>
            </View>
          </View>

          {/* Event name */}
          <Text style={s.featuredName}>{name}</Text>

          {/* Full description */}
          <Text style={[s.desc, { color: "#9ca3af", fontSize: 13, lineHeight: 19 }]}>{description}</Text>

          {/* Meta row */}
          <View style={s.featuredMeta}>
            <View style={s.featuredMetaChip}>
              <Text style={{ fontSize: 12 }}>📍</Text>
              <Text style={s.featuredMetaText}>{event.venue}</Text>
            </View>
            <View style={s.featuredMetaChip}>
              <Text style={{ fontSize: 12 }}>📅</Text>
              <Text style={s.featuredMetaText}>{event.date}</Text>
            </View>
            <View style={s.featuredMetaChip}>
              <Text style={{ fontSize: 12 }}>🕙</Text>
              <Text style={s.featuredMetaText}>{event.time}</Text>
            </View>
          </View>

          {/* Price + CTA */}
          <View style={s.featuredBottomRow}>
            <View style={[s.priceChip, { backgroundColor: PURPLE_DIM, borderColor: "rgba(137,56,213,0.5)" }]}>
              <Text style={{ fontSize: 13 }}>🎟</Text>
              <Text style={[s.priceChipText, { color: "#c084fc", fontSize: 14 }]}>{ticketLabel}</Text>
            </View>
            <TouchableOpacity onPress={onPress} style={s.featuredCta} activeOpacity={0.8}>
              <LinearGradient
                colors={[PURPLE, "#f97316"]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={s.featuredCtaGrad}
              >
                <Text style={s.featuredCtaText}>{findRide}</Text>
              </LinearGradient>
            </TouchableOpacity>
          </View>
        </View>
      </LinearGradient>
    </TouchableOpacity>
  );
}

// ─── Public default export — routes to correct tier variant ──────────────────
type CardInnerProps = {
  event: PromotedEvent;
  onPress: () => void;
  name: string;
  tag: string;
  description: string;
  ticketLabel: string;
  findRide: string;
};

export default function EventCard({
  event,
  onPress,
}: {
  event: PromotedEvent;
  onPress: () => void;
}) {
  const { name, tag, description, ticketLabel, findRide } = useEventStrings(event);
  const inner: CardInnerProps = { event, onPress, name, tag, description, ticketLabel, findRide };

  if (event.tier === "premium") return <PremiumCard {...inner} />;
  return <StandardCard {...inner} />;
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  // Standard
  standardWrap: {
    width: 260,
    borderRadius: 16,
    overflow: "hidden",
    shadowColor: FIRE,
    shadowOpacity: 0.25,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 },
    elevation: 6,
  },
  standardCard: {
    flexDirection: "row",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(249,115,22,0.2)",
    overflow: "hidden",
  },

  // Premium
  premiumWrap: {
    width: 310,
    borderRadius: 16,
    overflow: "hidden",
    shadowColor: GOLD,
    shadowOpacity: 0.3,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 4 },
    elevation: 9,
  },
  premiumCard: {
    flexDirection: "row",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(251,191,36,0.3)",
    overflow: "hidden",
  },

  // Featured
  featuredWrap: {
    borderRadius: 18,
    overflow: "hidden",
    shadowColor: PURPLE,
    shadowOpacity: 0.4,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 6 },
    elevation: 12,
    marginBottom: 4,
  },
  featuredCard: {
    borderRadius: 18,
    borderWidth: 1.5,
    borderColor: "rgba(137,56,213,0.45)",
    overflow: "hidden",
  },
  featuredTopBar: {
    height: 4,
    width: "100%",
  },
  featuredBody: {
    padding: 18,
    gap: 10,
  },
  featuredName: {
    color: "#f3f4f6",
    fontSize: 22,
    fontWeight: "800",
    letterSpacing: 0.2,
  },
  featuredMeta: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 2,
  },
  featuredMetaChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "rgba(255,255,255,0.05)",
    borderRadius: 8,
    paddingHorizontal: 9,
    paddingVertical: 5,
  },
  featuredMetaText: {
    color: "#d1d5db",
    fontSize: 13,
    fontWeight: "600",
  },
  featuredBottomRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginTop: 4,
  },
  featuredCta: {
    flex: 1,
    borderRadius: 10,
    overflow: "hidden",
  },
  featuredCtaGrad: {
    paddingVertical: 11,
    alignItems: "center",
    justifyContent: "center",
  },
  featuredCtaText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "700",
  },

  // Shared
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
    paddingHorizontal: 6,
    paddingVertical: 3,
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
    gap: 4,
  },
  metaText: {
    color: "#6b7280",
    fontSize: 12,
  },
  metaSep: {
    color: "#374151",
    fontSize: 12,
    marginHorizontal: 1,
  },
  priceChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    alignSelf: "flex-start",
    backgroundColor: FIRE_DIM,
    borderWidth: 1,
    borderColor: "rgba(249,115,22,0.35)",
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  priceChipText: {
    color: FIRE,
    fontSize: 12,
    fontWeight: "700",
  },
  desc: {
    color: "#4b5563",
    fontSize: 11,
    lineHeight: 16,
    marginTop: 2,
  },
  rideCta: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    marginTop: 6,
  },
  rideCtaText: {
    color: FIRE,
    fontSize: 11,
    fontWeight: "700",
  },
});
