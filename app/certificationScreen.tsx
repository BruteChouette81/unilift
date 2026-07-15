import {
  CERT_META,
  CERT_ORDER,
  UNCERTIFIED,
  earnedTiers,
  highestTier,
  isSchoolEmail,
  type CertTier,
} from "@/constants/certifications";
import { devLog, devWarn, isDev } from "@/constants/runtime-config";
import { useLanguage } from "@/context/LanguageContext";
import { useUserProfile } from "@/context/UserProfileContext";
import {
  createAdultVerificationSession,
  reconcileAdultVerification,
  requestStudentVerification,
} from "@/services/certificationService";
import { Ionicons } from "@expo/vector-icons";
import { getAuth } from "firebase/auth";
import * as AuthSession from "expo-auth-session";
import * as WebBrowser from "expo-web-browser";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import React, { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const C = {
  bg: "#080810",
  surface: "#0f0f1e",
  surfaceAlt: "#13132a",
  border: "rgba(137, 56, 213, 0.22)",
  borderFaint: "rgba(255,255,255,0.07)",
  purple: "#8938D5",
  purpleLight: "#e09af7",
  text: "#f3f4f6",
  muted: "#9ca3af",
  dim: "#4b5563",
  success: "#34d399",
};

const REQ_KEY: Record<CertTier, string> = {
  adult: "cert.screen.adultReq",
  student: "cert.screen.studentReq",
};

export default function CertificationScreen() {
  const router = useRouter();
  const { t } = useLanguage();
  const { userData, refreshProfile } = useUserProfile();
  const insets = useSafeAreaInsets();

  const certifications = userData?.certifications ?? [];
  const earned = earnedTiers(certifications);
  const top = highestTier(certifications);
  const has = (tier: CertTier) => earned.includes(tier);

  const [adultLoading, setAdultLoading] = useState(false);
  const [adultPending, setAdultPending] = useState(false);
  const [studentEmail, setStudentEmail] = useState("");
  const [studentSending, setStudentSending] = useState(false);
  const [studentSent, setStudentSent] = useState(false);

  const getToken = async (): Promise<string | null> => {
    const current = getAuth().currentUser;
    if (!current) return null;
    return current.getIdToken();
  };

  const guardDev = (): boolean => {
    if (!isDev) {
      Alert.alert(t("cert.screen.title"), t("cert.screen.unavailable"));
      return false;
    }
    return true;
  };

  // Adult verification runs through Stripe Identity's hosted flow. The badge is
  // granted server-side. After the browser returns we drive the reconcile
  // endpoint, which reads the verification result straight from Stripe and grants
  // on a verified 18+ outcome (independent of the webhook). Stripe may still be
  // `processing` for a few seconds after return, so we retry, then give up
  // gracefully instead of spinning forever.
  const pollForGrant = async () => {
    const token = await getToken();
    if (!token) {
      setAdultPending(false);
      return;
    }
    for (let i = 0; i < 10; i++) {
      await new Promise((r) => setTimeout(r, 3000));
      const res = await reconcileAdultVerification(token);
      devLog(`[CERT-DEBUG] pollForGrant[${i}]`, JSON.stringify(res));
      if (res.ok && res.granted) {
        await refreshProfile();
        setAdultPending(false); // has("adult") now true → renderAction hides the row
        return;
      }
      // A terminal non-granting state: stop polling and surface it.
      if (res.ok && res.status !== "processing" && res.status !== "none") {
        setAdultPending(false);
        Alert.alert(t("cert.screen.title"), t("cert.screen.genericError"));
        return;
      }
    }
    // Timed out while still processing — clear the spinner and let the user retry.
    setAdultPending(false);
    devWarn("[CERT-DEBUG] pollForGrant: timed out waiting for grant");
  };

  const handleAdult = async () => {
    devLog("[CERT-DEBUG] handleAdult: start");
    if (!guardDev()) {
      devWarn("[CERT-DEBUG] handleAdult: blocked by guardDev (isDev=" + isDev + ")");
      return;
    }
    setAdultLoading(true);
    try {
      const token = await getToken();
      devLog("[CERT-DEBUG] handleAdult: token", token ? `len=${token.length}` : "NULL");
      if (!token) throw new Error("no_auth");
      // Same deep-link pattern the OAuth flows use (scheme "unilift"). Stripe
      // redirects here when the hosted verification finishes, which closes the
      // in-app browser.
      const returnUrl = AuthSession.makeRedirectUri({ scheme: "unilift", path: "cert/adult" });
      devLog("[CERT-DEBUG] handleAdult: returnUrl", returnUrl);
      const res = await createAdultVerificationSession(token, returnUrl);
      devLog("[CERT-DEBUG] handleAdult: session result", JSON.stringify(res));
      if (!res.ok || !res.url) throw new Error(res.ok ? "no_url" : res.error);
      devLog("[CERT-DEBUG] handleAdult: opening browser →", res.url);
      const result = await WebBrowser.openAuthSessionAsync(res.url, returnUrl);
      devLog("[CERT-DEBUG] handleAdult: browser result", JSON.stringify(result));
      if (result.type === "success") {
        setAdultPending(true);
        void pollForGrant();
      }
    } catch (e) {
      devWarn("[CERT-DEBUG] handleAdult: FAILED", e instanceof Error ? `${e.name}: ${e.message}` : String(e), e);
      Alert.alert(t("cert.screen.title"), t("cert.screen.genericError"));
    } finally {
      setAdultLoading(false);
    }
  };

  const handleStudent = async () => {
    if (!guardDev()) return;
    const email = studentEmail.trim().toLowerCase();
    if (!isSchoolEmail(email)) {
      Alert.alert(t("cert.screen.title"), t("cert.screen.studentInvalidEmail"));
      return;
    }
    setStudentSending(true);
    try {
      const token = await getToken();
      if (!token) throw new Error("no_auth");
      const res = await requestStudentVerification(token, email);
      if (!res.ok) {
        Alert.alert(
          t("cert.screen.title"),
          res.error === "invalid_school_email"
            ? t("cert.screen.studentInvalidEmail")
            : t("cert.screen.genericError"),
        );
        return;
      }
      setStudentSent(true);
    } catch {
      Alert.alert(t("cert.screen.title"), t("cert.screen.genericError"));
    } finally {
      setStudentSending(false);
    }
  };

  // ── Per-tier action UI ──────────────────────────────────────────────────────
  const renderAction = (tier: CertTier) => {
    if (has(tier)) return null;
    const color = CERT_META[tier].color;

    if (tier === "adult") {
      if (adultPending) {
        return (
          <View style={styles.pendingRow}>
            <ActivityIndicator color={color} />
            <Text style={[styles.pendingText, { color }]}>{t("cert.screen.adultPending")}</Text>
          </View>
        );
      }
      return (
        <TouchableOpacity
          style={[styles.action, { borderColor: color + "80" }]}
          onPress={handleAdult}
          disabled={adultLoading}
          activeOpacity={0.85}
        >
          {adultLoading ? (
            <ActivityIndicator color={color} />
          ) : (
            <>
              <Ionicons name="finger-print-outline" size={17} color={color} />
              <Text style={[styles.actionText, { color }]}>{t("cert.screen.adultCta")}</Text>
            </>
          )}
        </TouchableOpacity>
      );
    }

    // student
    if (studentSent) {
      return (
        <View style={styles.pendingRow}>
          <Ionicons name="mail-unread-outline" size={17} color={color} />
          <Text style={[styles.pendingText, { color }]}>{t("cert.screen.studentSent")}</Text>
        </View>
      );
    }
    return (
      <View style={{ gap: 10 }}>
        <TextInput
          style={styles.input}
          value={studentEmail}
          onChangeText={setStudentEmail}
          placeholder={t("cert.screen.studentPlaceholder")}
          placeholderTextColor={C.dim}
          autoCapitalize="none"
          keyboardType="email-address"
          autoCorrect={false}
        />
        <TouchableOpacity
          style={[styles.action, { borderColor: color + "80" }]}
          onPress={handleStudent}
          disabled={studentSending}
          activeOpacity={0.85}
        >
          {studentSending ? (
            <ActivityIndicator color={color} />
          ) : (
            <>
              <Ionicons name="paper-plane-outline" size={16} color={color} />
              <Text style={[styles.actionText, { color }]}>{t("cert.screen.studentCta")}</Text>
            </>
          )}
        </TouchableOpacity>
      </View>
    );
  };

  // Steps for the hero progress track: a fixed baseline ("Start") that everyone
  // sits on, then the three tiers in ascending rank.
  const trackSteps: { key: string; color: string; label: string; earned: boolean }[] = [
    { key: "base", color: C.dim, label: t("cert.screen.trackBase"), earned: true },
    ...CERT_ORDER.map((tier) => ({
      key: tier,
      color: CERT_META[tier].color,
      label: t(CERT_META[tier].labelKey),
      earned: has(tier),
    })),
  ];

  const heroColor = top ? CERT_META[top].color : UNCERTIFIED.color;
  const heroIcon = top ? CERT_META[top].icon : UNCERTIFIED.icon;
  const heroTitle = top ? t(CERT_META[top].labelKey) : t("cert.screen.statusNoneTitle");
  const heroSub =
    earned.length === 0
      ? t("cert.screen.statusNoneSub")
      : earned.length === CERT_ORDER.length
        ? t("cert.screen.statusMaxSub")
        : t("cert.screen.statusSomeSub");

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <StatusBar style="light" />

      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} activeOpacity={0.7}>
          <LinearGradient colors={["#FD165A", "#8938D5"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.backBtnGrad}>
            <Ionicons name="arrow-back" size={18} color="#fff" />
          </LinearGradient>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{t("cert.screen.title")}</Text>
        <View style={{ width: 38 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 40 }} showsVerticalScrollIndicator={false}>
        {/* ── Hero: current standing ─────────────────────────────────────────── */}
        <View style={styles.hero}>
          <LinearGradient
            colors={["rgba(38,12,62,0.97)", "rgba(11,4,22,0.96)"]}
            style={styles.heroInner}
          >
            <View style={styles.heroTop}>
              <View style={[styles.emblem, { borderColor: heroColor, backgroundColor: heroColor + "1f" }]}>
                <View style={[styles.emblemGlow, { backgroundColor: heroColor + "22" }]} />
                <Ionicons name={heroIcon as keyof typeof Ionicons.glyphMap} size={30} color={heroColor} />
              </View>
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                  <Text style={styles.heroTitle}>{heroTitle}</Text>
                  {top && <Ionicons name="checkmark-circle" size={18} color={heroColor} />}
                </View>
                <Text style={styles.heroSub}>{heroSub}</Text>
              </View>
            </View>

            {/* Progress track: Start → Adult → Student → Woman */}
            <View style={styles.track}>
              {trackSteps.map((step, i) => (
                <React.Fragment key={step.key}>
                  {i > 0 && (
                    <View
                      style={[
                        styles.trackLine,
                        { backgroundColor: step.earned ? step.color : C.borderFaint },
                      ]}
                    />
                  )}
                  <View style={styles.trackStep}>
                    <View
                      style={[
                        styles.trackDot,
                        step.earned
                          ? { backgroundColor: step.color, borderColor: step.color }
                          : { backgroundColor: "transparent", borderColor: C.dim },
                        top && step.key === top && styles.trackDotCurrent,
                      ]}
                    >
                      {step.earned && step.key !== "base" && (
                        <Ionicons name="checkmark" size={11} color="#fff" />
                      )}
                    </View>
                    <Text
                      style={[
                        styles.trackLabel,
                        step.earned && { color: step.color, fontWeight: "700" },
                      ]}
                      numberOfLines={1}
                    >
                      {step.label}
                    </Text>
                  </View>
                </React.Fragment>
              ))}
            </View>
          </LinearGradient>
        </View>

        {/* ── Trust ladder ───────────────────────────────────────────────────── */}
        <Text style={styles.eyebrow}>{t("cert.screen.ladderEyebrow")}</Text>
        <Text style={styles.trustNote}>{t("cert.screen.trustNote")}</Text>

        <View style={styles.ladder}>
          {CERT_ORDER.map((tier, i) => {
            const meta = CERT_META[tier];
            const isEarned = has(tier);
            const isLast = i === CERT_ORDER.length - 1;
            // The connector below this node is "reached" once this tier is earned.
            const connectorColor = isEarned ? meta.color + "66" : C.borderFaint;
            return (
              <View key={tier} style={styles.rung}>
                {/* Left spine + node */}
                <View style={styles.spineCol}>
                  <View
                    style={[
                      styles.node,
                      isEarned
                        ? { backgroundColor: meta.color, borderColor: meta.color }
                        : { backgroundColor: meta.color + "1f", borderColor: meta.color + "99" },
                    ]}
                  >
                    {isEarned ? (
                      <Ionicons name="checkmark" size={20} color="#fff" />
                    ) : (
                      <Text style={[styles.nodeNum, { color: meta.color }]}>{i + 1}</Text>
                    )}
                  </View>
                  {!isLast && <View style={[styles.spine, { backgroundColor: connectorColor }]} />}
                </View>

                {/* Right card */}
                <View style={[styles.rungCard, isEarned && { borderColor: meta.color + "55" }]}>
                  <View style={styles.rungHead}>
                    <View style={[styles.tierIcon, { backgroundColor: meta.color + "22", borderColor: meta.color + "66" }]}>
                      <Ionicons name={meta.icon as keyof typeof Ionicons.glyphMap} size={18} color={meta.color} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <View style={styles.rungTitleRow}>
                        <Text style={[styles.rungTitle, { color: meta.color }]}>{t(meta.labelKey)}</Text>
                        <View style={[styles.levelPill, { backgroundColor: meta.color + "1a", borderColor: meta.color + "44" }]}>
                          <Text style={[styles.levelPillText, { color: meta.color }]}>
                            {t("cert.screen.levelLabel", { n: i + 1 })}
                          </Text>
                        </View>
                      </View>
                      <Text style={styles.rungReq}>{t(REQ_KEY[tier])}</Text>
                    </View>
                    {isEarned && (
                      <View style={styles.verifiedPill}>
                        <Ionicons name="checkmark-circle" size={14} color={C.success} />
                        <Text style={styles.verifiedText}>{t("cert.screen.statusVerified")}</Text>
                      </View>
                    )}
                  </View>

                  {renderAction(tier)}
                </View>
              </View>
            );
          })}
        </View>
      </ScrollView>
    </View>
  );
}

const NODE = 44;

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  backBtn: { width: 38, height: 38 },
  backBtnGrad: { width: 38, height: 38, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  headerTitle: { color: C.text, fontSize: 18, fontWeight: "800" },

  // Hero
  hero: {
    borderRadius: 22,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: C.border,
    marginBottom: 26,
  },
  heroInner: { padding: 18 },
  heroTop: { flexDirection: "row", alignItems: "center", gap: 14 },
  emblem: {
    width: 64,
    height: 64,
    borderRadius: 20,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  emblemGlow: { position: "absolute", width: 64, height: 64, borderRadius: 32, top: 12 },
  heroTitle: { color: C.text, fontSize: 20, fontWeight: "800" },
  heroSub: { color: C.muted, fontSize: 13, lineHeight: 18, marginTop: 3 },

  // Progress track
  track: { flexDirection: "row", alignItems: "flex-start", marginTop: 20 },
  trackStep: { flex: 1, alignItems: "center" },
  trackLine: { width: 16, height: 2, borderRadius: 1, marginTop: 8 },
  trackDot: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  trackDotCurrent: {
    shadowColor: "#fff",
    shadowOpacity: 0.5,
    shadowRadius: 6,
    elevation: 4,
    transform: [{ scale: 1.25 }],
  },
  trackLabel: { color: C.muted, fontSize: 10, marginTop: 7, textAlign: "center" },

  // Ladder
  eyebrow: {
    color: C.purpleLight,
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 1.5,
    textTransform: "uppercase",
  },
  trustNote: { color: C.muted, fontSize: 13, lineHeight: 19, marginTop: 6, marginBottom: 18 },
  ladder: {},

  rung: { flexDirection: "row", alignItems: "stretch" },
  spineCol: { width: NODE, alignItems: "center", marginRight: 14 },
  node: {
    width: NODE,
    height: NODE,
    borderRadius: NODE / 2,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  nodeNum: { fontSize: 18, fontWeight: "900" },
  spine: { width: 3, flex: 1, borderRadius: 2, marginVertical: 4 },

  rungCard: {
    flex: 1,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 16,
    padding: 15,
    marginBottom: 16,
  },
  rungHead: { flexDirection: "row", alignItems: "center", gap: 11 },
  tierIcon: {
    width: 36,
    height: 36,
    borderRadius: 11,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  rungTitleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  rungTitle: { fontSize: 16, fontWeight: "800" },
  levelPill: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6, borderWidth: 1 },
  levelPillText: { fontSize: 10, fontWeight: "800", letterSpacing: 0.3 },
  rungReq: { color: C.muted, fontSize: 12.5, marginTop: 2 },
  verifiedPill: { flexDirection: "row", alignItems: "center", gap: 4 },
  verifiedText: { color: C.success, fontSize: 12, fontWeight: "700" },

  // Actions
  action: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderWidth: 1.5,
    borderRadius: 12,
    paddingVertical: 12,
    marginTop: 13,
    backgroundColor: "rgba(255,255,255,0.03)",
  },
  actionText: { fontSize: 14.5, fontWeight: "800" },
  input: {
    backgroundColor: C.surfaceAlt,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: C.text,
    fontSize: 15,
    marginTop: 13,
  },
  pendingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 13,
    backgroundColor: "rgba(52,211,153,0.08)",
    borderRadius: 12,
    padding: 12,
  },
  pendingText: { fontSize: 13, lineHeight: 18, flex: 1, fontWeight: "600" },
});
