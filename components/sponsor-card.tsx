import { getSponsorRewards, type Reward } from "@/constants/rewards";
import { isDev } from "@/constants/runtime-config";
import { categoryIcon, tierRingColor, type Sponsor, type SponsorTier } from "@/constants/sponsors";
import { useLanguage } from "@/context/LanguageContext";
import { useUserProfile } from "@/context/UserProfileContext";
import { Ionicons } from "@expo/vector-icons";
import { BlurView } from "expo-blur";
import { LinearGradient } from "expo-linear-gradient";
import React, { useState } from "react";
import { Alert, Dimensions, Image, Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import RewardCard from "./reward-card";

const C = {
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

export default function SponsorCard({
  sponsor,
  onClose,
  onHeadThere,
}: {
  sponsor: Sponsor | null;
  onClose: () => void;
  onHeadThere: (sponsor: Sponsor) => void;
}) {
  const { t } = useLanguage();
  const insets = useSafeAreaInsets();
  const { userData } = useUserProfile();
  const [logoFailed, setLogoFailed] = useState(false);

  const xp = userData?.xp ?? 0;
  const sponsorRewards = sponsor ? getSponsorRewards(sponsor.id) : [];

  const handleRedeem = (reward: Reward) => {
    Alert.alert(t("rewards.redeemedTitle"), t("rewards.redeemedBody", { title: reward.title }));
  };

  const TIER_LABEL: Record<SponsorTier, string> = {
    gold: t("sponsor.featuredPartner"),
    silver: t("sponsor.partner"),
    bronze: t("sponsor.partner"),
  };

  const ring = sponsor ? tierRingColor(sponsor.tier) : C.gold;
  const accent = sponsor?.brandColor || ring;
  const showLogo = !!sponsor?.logoUrl && !logoFailed;

  return (
    <Modal visible={sponsor !== null} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.overlay}>
        <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={onClose} />

        <View style={[styles.sheet, { maxHeight: SHEET_MAX_HEIGHT, paddingBottom: Math.max(insets.bottom, 16) + 16 }]}>
          <BlurView intensity={60} tint="dark" experimentalBlurMethod="dimezisBlurView" style={StyleSheet.absoluteFill} pointerEvents="none" />
          <View style={styles.scrim} pointerEvents="none" />

          {sponsor && (
            <ScrollView
              style={styles.content}
              contentContainerStyle={{ paddingBottom: 8 }}
              showsVerticalScrollIndicator={false}
            >
              {/* Drag handle */}
              <View style={styles.dragZone}>
                <View style={styles.handle} />
              </View>

              {/* Tier badge + close */}
              <View style={styles.topRow}>
                <View style={[styles.tierPill, { backgroundColor: `${ring}22`, borderColor: `${ring}66` }]}>
                  <Ionicons name={sponsor.tier === "gold" ? "star" : "ribbon"} size={13} color={ring} />
                  <Text style={[styles.tierPillText, { color: ring }]}>{TIER_LABEL[sponsor.tier]}</Text>
                </View>
                <TouchableOpacity onPress={onClose} hitSlop={8} style={styles.closeIcon}>
                  <Ionicons name="close" size={20} color={C.dim} />
                </TouchableOpacity>
              </View>

              {/* Header — logo + name */}
              <View style={styles.header}>
                <View style={[styles.logoTile, { borderColor: ring }]}>
                  {showLogo ? (
                    <Image source={{ uri: sponsor.logoUrl }} style={styles.logoImg} onError={() => setLogoFailed(true)} />
                  ) : (
                    <Ionicons name={categoryIcon(sponsor.category)} size={30} color={accent} />
                  )}
                </View>
                <View style={styles.headerText}>
                  {sponsor.tagline ? <Text style={styles.eyebrow} numberOfLines={1}>{sponsor.tagline}</Text> : null}
                  <Text style={styles.name} numberOfLines={2}>{sponsor.name}</Text>
                </View>
              </View>

              {/* Meta card */}
              <View style={styles.metaCard}>
                {sponsor.address ? (
                  <View style={styles.metaRow}>
                    <Ionicons name="location-sharp" size={15} color={C.purpleLight} />
                    <Text style={styles.metaText} numberOfLines={2}>{sponsor.address}</Text>
                  </View>
                ) : null}
                {sponsor.category ? (
                  <View style={styles.metaRow}>
                    <Ionicons name={categoryIcon(sponsor.category)} size={15} color={C.purpleLight} />
                    <Text style={styles.metaText} numberOfLines={1}>{sponsor.category}</Text>
                  </View>
                ) : null}
              </View>

              {/* Offers */}
              <Text style={styles.sectionTitle}>{t("sponsor.offers")}</Text>
              {sponsor.offers.length > 0 ? (
                <View style={styles.offersWrap}>
                  {sponsor.offers.map((offer, i) => (
                    <View key={`${offer.title}-${i}`} style={styles.offerCard}>
                      {offer.discount ? (
                        <View style={[styles.discountChip, { backgroundColor: `${accent}22`, borderColor: `${accent}66` }]}>
                          <Text style={[styles.discountText, { color: accent }]}>{offer.discount.toUpperCase()}</Text>
                        </View>
                      ) : null}
                      <Text style={styles.offerTitle}>{offer.title}</Text>
                      {offer.description ? <Text style={styles.offerDesc}>{offer.description}</Text> : null}
                    </View>
                  ))}
                </View>
              ) : (
                <View style={styles.emptyOffers}>
                  <Text style={styles.emptyOffersText}>{t("sponsor.noOffers")}</Text>
                </View>
              )}

              {/* Your rewards (dev demo) — falls back to "coming soon" in prod */}
              {isDev ? (
                <>
                  <Text style={styles.sectionTitle}>{t("sponsor.yourRewards")}</Text>
                  {sponsorRewards.length > 0 ? (
                    <View style={styles.rewardsList}>
                      {sponsorRewards.map((reward) => (
                        <RewardCard key={reward.id} reward={reward} xp={xp} onRedeem={handleRedeem} compact />
                      ))}
                    </View>
                  ) : (
                    <View style={styles.emptyOffers}>
                      <Text style={styles.emptyOffersText}>{t("rewards.noSponsorRewards")}</Text>
                    </View>
                  )}
                </>
              ) : (
                <View style={styles.rewardsRow}>
                  <Ionicons name="gift-outline" size={16} color={C.dim} />
                  <Text style={styles.rewardsText}>{t("sponsor.rewardsComingSoon")}</Text>
                </View>
              )}

              {/* Head there → normal lift flow */}
              <TouchableOpacity activeOpacity={0.85} onPress={() => onHeadThere(sponsor)} style={styles.ctaWrap}>
                <LinearGradient
                  colors={[C.purple, accent]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={styles.ctaGrad}
                >
                  <Ionicons name="car-sport" size={18} color="#fff" />
                  <Text style={styles.ctaText}>{t("sponsor.headThere")}</Text>
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

  topRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 14 },
  tierPill: {
    flexDirection: "row", alignItems: "center", gap: 6,
    borderWidth: 1, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 6,
  },
  tierPillText: { fontSize: 13, fontWeight: "800" },
  closeIcon: {
    width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.06)",
  },

  header: { flexDirection: "row", alignItems: "center", gap: 14 },
  logoTile: {
    width: 60, height: 60, borderRadius: 16, borderWidth: 2,
    alignItems: "center", justifyContent: "center", overflow: "hidden",
    backgroundColor: "rgba(255,255,255,0.05)",
  },
  logoImg: { width: 56, height: 56, borderRadius: 14 },
  headerText: { flex: 1 },
  eyebrow: { color: C.purpleLight, fontSize: 12, fontWeight: "700", marginBottom: 2 },
  name: { color: C.text, fontSize: 23, fontWeight: "900", lineHeight: 27 },

  metaCard: {
    marginTop: 16, gap: 11,
    backgroundColor: "rgba(255,255,255,0.05)", borderWidth: 1, borderColor: "rgba(255,255,255,0.09)",
    borderRadius: 16, padding: 14,
  },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  metaText: { color: C.muted, fontSize: 14, fontWeight: "600", flex: 1 },

  sectionTitle: { color: C.text, fontSize: 15, fontWeight: "800", marginTop: 20, marginBottom: 10 },
  offersWrap: { gap: 10 },
  offerCard: {
    backgroundColor: "rgba(255,255,255,0.04)", borderWidth: 1, borderColor: "rgba(255,255,255,0.08)",
    borderRadius: 14, padding: 14,
  },
  discountChip: {
    alignSelf: "flex-start", borderWidth: 1, borderRadius: 8,
    paddingHorizontal: 9, paddingVertical: 4, marginBottom: 8,
  },
  discountText: { fontSize: 12, fontWeight: "900", letterSpacing: 0.5 },
  offerTitle: { color: C.text, fontSize: 15, fontWeight: "800" },
  offerDesc: { color: C.dim, fontSize: 13, lineHeight: 19, marginTop: 4 },

  emptyOffers: {
    backgroundColor: "rgba(255,255,255,0.03)", borderWidth: 1, borderColor: "rgba(255,255,255,0.07)",
    borderRadius: 14, padding: 16, alignItems: "center",
  },
  emptyOffersText: { color: C.dim, fontSize: 14, fontWeight: "600" },

  rewardsList: { gap: 10 },
  rewardsRow: {
    flexDirection: "row", alignItems: "center", gap: 8,
    marginTop: 14, backgroundColor: "rgba(255,255,255,0.03)",
    borderWidth: 1, borderColor: "rgba(255,255,255,0.07)", borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 12,
  },
  rewardsText: { color: C.dim, fontSize: 13, fontWeight: "600" },

  ctaWrap: { marginTop: 20, borderRadius: 16, overflow: "hidden" },
  ctaGrad: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    paddingVertical: 17,
  },
  ctaText: { color: "#fff", fontSize: 17, fontWeight: "800", letterSpacing: 0.3 },
});
