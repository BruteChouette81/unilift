import {
  CERTIFICATION_ENABLED,
  CERT_META,
  CERT_ORDER,
  UNCERTIFIED,
  earnedTiers,
  highestTier,
  isSchoolEmail,
  type CertTier,
} from "@/constants/certifications";
import ComingSoon from "@/components/coming-soon";
import { normalizeUserData } from "@/components/userHelper";
import { devLog, devWarn, isDev } from "@/constants/runtime-config";
import { useLanguage } from "@/context/LanguageContext";
import { useUserProfile } from "@/context/UserProfileContext";
import {
  createAdultVerificationSession,
  reconcileAdultVerification,
  requestStudentVerification,
} from "@/services/certificationService";
import { fetchUserDocument } from "@/services/userService";
import { Ionicons } from "@expo/vector-icons";
import { getAuth } from "firebase/auth";
import * as AuthSession from "expo-auth-session";
import * as WebBrowser from "expo-web-browser";
import { LinearGradient } from "expo-linear-gradient";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  BackHandler,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { P } from "@/constants/palette";

const C = {
  bg: P.bg,
  surface: P.surface,
  surfaceAlt: P.surfaceRaised,
  border: "rgba(137, 56, 213, 0.22)",
  borderFaint: "rgba(255,255,255,0.07)",
  purple: P.accent,
  purpleLight: P.accentLight,
  text: P.text,
  muted: P.textMuted,
  dim: P.textDim,
  success: P.success,
};

const REQ_KEY: Record<CertTier, string> = {
  adult: "cert.screen.adultReq",
  student: "cert.screen.studentReq",
};

// Student polling budget: the badge is granted out-of-band (the user opens a
// magic link in their school inbox), so we watch the user document for ~2min.
const STUDENT_POLL_INTERVAL_MS = 5000;
const STUDENT_POLL_ATTEMPTS = 24;

export default function CertificationScreen() {
  const router = useRouter();
  const { t } = useLanguage();
  const { userData, refreshProfile } = useUserProfile();
  const insets = useSafeAreaInsets();

  // Step 4 of account creation routes here with ?mode=signup. The account
  // already exists at that point (the /cert endpoints need an idToken), so the
  // flow is identical — only the chrome changes: signup step dots instead of a
  // back arrow, and a Continue/Skip CTA that hands off to onboarding.
  const signupMode = useLocalSearchParams<{ mode?: string }>().mode === "signup";

  const certifications = userData?.certifications ?? [];
  const earned = earnedTiers(certifications);
  const top = highestTier(certifications);
  const has = (tier: CertTier) => earned.includes(tier);

  const [adultLoading, setAdultLoading] = useState(false);
  const [adultPending, setAdultPending] = useState(false);
  // Most users sign up with their school address — prefill it so the student
  // tier is a single tap when it already qualifies.
  const [studentEmail, setStudentEmail] = useState(() => {
    const signupEmail = getAuth().currentUser?.email ?? "";
    return isSchoolEmail(signupEmail) ? signupEmail : "";
  });
  const [studentSending, setStudentSending] = useState(false);
  const [studentSent, setStudentSent] = useState(false);

  // In signup mode there is nothing to go back to — the account is created and
  // the (auth) stack is already unmounted. Swallow the Android hardware back.
  useFocusEffect(
    useCallback(() => {
      if (!signupMode) return;
      const subscription = BackHandler.addEventListener("hardwareBackPress", () => true);
      return () => subscription.remove();
    }, [signupMode]),
  );

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

  // Unlike the adult tier there is no reconcile endpoint to ask — the Cloud
  // Function writes `certifications` when the emailed link is opened, so watch
  // the user document directly. A hit refreshes the profile, which flips
  // has("student") and swaps the row to the green verified pill on its own.
  const studentEarned = has("student");
  useEffect(() => {
    if (!studentSent || studentEarned) return;
    let cancelled = false;
    let attempts = 0;

    const timer = setInterval(async () => {
      if (attempts++ >= STUDENT_POLL_ATTEMPTS) {
        clearInterval(timer);
        devWarn("[CERT-DEBUG] student poll: gave up waiting for the grant");
        return;
      }
      const current = getAuth().currentUser;
      if (!current) return;
      const token = await current.getIdToken().catch(() => null);
      if (!token || cancelled) return;
      const doc = await fetchUserDocument(current.uid, token);
      if (cancelled) return;
      if (!normalizeUserData(doc).certifications?.includes("student")) return;
      clearInterval(timer);
      devLog("[CERT-DEBUG] student poll: grant landed");
      await refreshProfile();
    }, STUDENT_POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [studentSent, studentEarned, refreshProfile]);

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
    // No production guard needed here any more: this whole tree only renders
    // when CERTIFICATION_ENABLED, and the /cert routes exist wherever that is
    // true. The old `signupMode && !isDev` early-return is gone with it.
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
        {signupMode ? (
          // Signup step dots, mirroring the signup screen header — this is
          // step 4 of 4, and there is no back arrow because the account is
          // already created.
          <View style={styles.dotsRow}>
            <View style={styles.dot} />
            <View style={styles.dot} />
            <View style={styles.dot} />
            <View style={[styles.dot, styles.dotActive]} />
          </View>
        ) : (
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} activeOpacity={0.7}>
            <View style={styles.backBtnGrad}>
              <Ionicons name="arrow-back" size={18} color="#2d0015" />
            </View>
          </TouchableOpacity>
        )}
        <Text style={styles.headerTitle}>
          {signupMode ? t("cert.signup.title") : t("cert.screen.title")}
        </Text>
        {signupMode ? (
          <Text style={styles.stepIndicator}>{t("cert.signup.stepIndicator")}</Text>
        ) : (
          <View style={{ width: 38 }} />
        )}
      </View>

      {!CERTIFICATION_ENABLED ? (
        <ComingSoon
          emoji="🛡️"
          label={t("cert.comingSoon")}
          title={t("cert.screen.title")}
          subtitle={t("cert.comingSoonSub")}
          features={[
            { icon: "🪪", label: t("cert.featureAdult") },
            { icon: "🎓", label: t("cert.featureStudent") },
            { icon: "🛡️", label: t("cert.featureTrust") },
            { icon: "⚡", label: t("cert.featurePriority") },
          ]}
        />
      ) : (
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

        {/* ── Signup step footer ─────────────────────────────────────────────── */}
        {/* Only reachable in dev now: the production signup flow skips this
            screen entirely (see app/(auth)/signup.tsx). Kept so the flow still
            works end-to-end when CERTIFICATION_ENABLED is flipped back on. */}
        {signupMode && (
          <>
            <TouchableOpacity
              style={styles.signupCta}
              onPress={() => router.replace("/onboardingScreen")}
              activeOpacity={0.85}
            >
              <Text style={styles.signupCtaText}>
                {/* Both tiers are optional — the CTA always moves the user on,
                    it only renames itself once something has been earned. */}
                {earned.length > 0 ? t("cert.signup.continueBtn") : t("cert.signup.skipBtn")}
              </Text>
            </TouchableOpacity>
          </>
        )}
      </ScrollView>
      )}
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
  backBtnGrad: { width: 38, height: 38, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: "#e09af7" },
  headerTitle: { color: C.text, fontSize: 18, fontWeight: "800" },

  // ── Signup mode (step 4 of account creation) ──────────────────────────────
  dotsRow: { flexDirection: "row", gap: 6, width: 62, alignItems: "center" },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: "rgba(255,255,255,0.3)" },
  dotActive: { width: 18, backgroundColor: "#fff" },
  stepIndicator: { color: C.muted, fontSize: 13, fontWeight: "600", width: 62, textAlign: "right" },
  signupCta: {
    height: 52,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: C.purpleLight,
    marginTop: 6,
  },
  signupCtaText: { color: "#2d0015", fontSize: 16, fontWeight: "700" },

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
