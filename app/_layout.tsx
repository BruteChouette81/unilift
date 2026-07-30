// import { runtimeConfig } from "@/constants/runtime-config";
// import { AuthProvider, useAuth } from "@/context/AuthContext";
// import { useColorScheme } from "@/hooks/use-color-scheme";
// import {
//   DarkTheme,
//   DefaultTheme,
//   ThemeProvider,
// } from "@react-navigation/native";
// import { StripeProvider } from "@stripe/stripe-react-native";
// import { Stack } from "expo-router";
// import { StatusBar } from "expo-status-bar";
// import { ActivityIndicator, View } from "react-native";

// export default function RootLayout() {
//   return (
//     <StripeProvider
//       publishableKey={runtimeConfig.stripePublishableKey}
//       merchantIdentifier="merchant.identifier" // required for Apple Pay
//       urlScheme="your-url-scheme" // required for 3D Secure and bank redirects
//     >
//       <AuthProvider>
//         <LayoutContent />
//       </AuthProvider>
//     </StripeProvider>
//   );
// }

// /*<Stack.Screen
//   name="Ride"
//   component={RideScreen}
//   options={{ headerShown: false }} // hide header so back swipe is disabled
// />*/

// function LayoutContent() {
//   const { status } = useAuth();
//   const colorScheme = useColorScheme();
//   const statusBarBackground = "#101010";
//   const statusBarStyle = "light";

//   if (status === "initializing") {
//     return (
//       <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
//         <ActivityIndicator size="large" />
//       </View>
//     );
//   } else {
//     const baseTheme = colorScheme === "dark" ? DarkTheme : DefaultTheme;
//     const theme = {
//       ...baseTheme,
//       colors: {
//         ...baseTheme.colors,
//         background: "#101010",
//         card: "#101010",
//       },
//     };

//     // If the user is not authenticated, only show the auth stack
//     if (status === "unauthenticated") {
//       return (
//         <ThemeProvider value={theme}>
//           <Stack
//             screenOptions={{
//               headerShown: false,
//               animation: "none",
//               contentStyle: { backgroundColor: "#101010" },
//             }}
//           >
//             <Stack.Screen
//               name="(auth)"
//               options={{
//                 headerShown: false,
//               }}
//             />
//           </Stack>
//           <StatusBar
//             style={statusBarStyle}
//             backgroundColor={statusBarBackground}
//             translucent={false}
//           />
//         </ThemeProvider>
//       );
//     }
//     // Authenticated users see the main app
//     return (
//       <ThemeProvider value={theme}>
//         <Stack
//           screenOptions={{
//             animation: "none",
//             contentStyle: { backgroundColor: "#101010" },
//           }}
//         >
//           <Stack.Screen
//             name="(tabs)"
//             options={{
//               headerShown: false,
//               title: "UniLift",
//               headerTitleStyle: {
//                 fontSize: 30,
//                 fontWeight: "bold",
//               },
//             }}
//           />
//           <Stack.Screen name="rideScreen" options={{ headerShown: false }} />
//           <Stack.Screen name="riderScreen" options={{ headerShown: false }} />
//         </Stack>
//         <StatusBar
//           style={statusBarStyle}
//           backgroundColor={statusBarBackground}
//           translucent={false}
//         />
//       </ThemeProvider>
//     );
//   }
// }

import {
  CountdownConfigContext,
  isCountdownActive,
} from "@/constants/countdown-config";
import { isUpdateRequired } from "@/constants/force-update-config";
import { apiFetch, apiBaseUrl, isDev, runtimeConfig } from "@/constants/runtime-config";
import { useForceUpdateConfigFetcher } from "@/hooks/use-force-update-config";
import { useOtaUpdate } from "@/hooks/use-ota-update";
import UpdateRequiredScreen from "@/app/updateRequiredScreen";
import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import { ActiveRideProvider, useActiveRide } from "@/context/ActiveRideContext";
import { fetchRideById } from "@/services/rideServices";
import { fetchRideRequestById } from "@/services/rideRequestService";
import { fetchRidePricing } from "@/services/pricingService";
import { setRidePricing } from "@/constants/pricing";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import { LanguageProvider, useLanguage } from "@/context/LanguageContext";
import { UserProfileProvider } from "@/context/UserProfileContext";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { useCountdown } from "@/hooks/use-countdown";
import { useCountdownConfigFetcher } from "@/hooks/use-countdown-config";
import { usePushNotifications } from "@/hooks/use-push-notifications";
import { useNotificationGate } from "@/hooks/use-notification-gate";
import NotificationGateScreen from "@/components/NotificationGateScreen";
import { useWallet, WalletProvider } from "@/context/WalletContext";
import { useDriverSession } from "@/hooks/use-driver-session";
import SplashAnimation from "@/components/SplashAnimation";
import * as SplashScreen from "expo-splash-screen";
import { DarkTheme, DefaultTheme, ThemeProvider } from "@react-navigation/native";
import { StripeProvider } from "@stripe/stripe-react-native";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { Stack, useRouter, useSegments } from "expo-router";
import { StatusBar } from "expo-status-bar";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { DriverSession } from "@/types/models";

const BG = "#101010";
const STATUS_BAR_STYLE = "light";

const BANNER_BORDER    = "rgba(137, 56, 213, 0.22)";
const PURPLE_LIGHT     = "#e09af7";

export default function RootLayout() {
  // Start with the env-var key (test key) as an instant fallback, then
  // override with whatever the server says its current APP_ENV is using.
  // This keeps client and server always in sync without a full app rebuild.
  const [stripeKey, setStripeKey] = useState(runtimeConfig.stripePublishableKey);
  const [showSplash, setShowSplash] = useState(true);

  useEffect(() => {
    SplashScreen.hideAsync().catch(() => {});
  }, []);

  useEffect(() => {
    apiFetch(`${apiBaseUrl}/config`)
      .then((r) => r.json())
      .then((data) => {
        if (data?.stripePublishableKey) setStripeKey(data.stripePublishableKey);
      })
      .catch(() => {
        // Network failure: keep the env-var fallback key already set above.
      });
  }, []);

  return (
    <StripeProvider
      publishableKey={stripeKey}
      merchantIdentifier="merchant.com.unilift.unilift"
      urlScheme="unilift"
    >
      <>
        <AuthProvider>
          <UserProfileProvider>
            <WalletProvider>
              <LanguageProvider>
                <ActiveRideProvider>
                  <LayoutContent />
                </ActiveRideProvider>
              </LanguageProvider>
            </WalletProvider>
          </UserProfileProvider>
        </AuthProvider>
        {showSplash && <SplashAnimation onFinish={() => setShowSplash(false)} />}
      </>
    </StripeProvider>
  );
}

function AppHeader() {
  const { pendingChargeCents, pendingEarningsCents, loading } = useWallet();
  const { top: safeTop } = useSafeAreaInsets();
  const router = useRouter();

  const earnings = Number(pendingEarningsCents) || 0;
  const pending  = Number(pendingChargeCents)  || 0;
  const hasEarnings = earnings > 0;
  const amountCents = hasEarnings ? earnings : pending;
  const amountColor = hasEarnings ? "#34d399" : "#f3f4f6";

  return (
    <LinearGradient
      colors={["#2d0015", "#1c0038"]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 0 }}
      style={[styles.banner, { paddingTop: safeTop + 7 }]}
    >
      {/* glass top-edge highlight */}
      <View style={styles.bannerHighlight} />
      <View style={styles.bannerRow}>
        <Text style={styles.bannerText}>UniLift</Text>
        {isDev && (
          <Pressable
            onLongPress={() => router.push("/devToolsScreen")}
            delayLongPress={400}
            hitSlop={8}
            style={styles.devBadge}
          >
            <Text style={styles.devBadgeText}>DEV</Text>
          </Pressable>
        )}

        <TouchableOpacity
          style={styles.walletPill}
          activeOpacity={0.75}
          onPress={() => router.push("/(tabs)/wallet")}
        >
          <Ionicons name={hasEarnings ? "cash" : "card-outline"} size={14} color={hasEarnings ? "#34d399" : PURPLE_LIGHT} />
          <Text style={[styles.walletAmount, { color: amountColor }]}>
            {loading ? "$0.00" : `$${(amountCents / 100).toFixed(2)}`}
          </Text>
        </TouchableOpacity>
      </View>
    </LinearGradient>
  );
}

function ActiveRideBanner() {
  const { activeRide } = useActiveRide();
  const { t } = useLanguage();
  const router = useRouter();
  const segments = useSegments();

  // Don't show if no active ride or already on a ride screen
  const onRideScreen = segments.some(
    (s) => s === "riderScreen" || s === "rideScreen",
  );
  if (!activeRide || onRideScreen) return null;

  const label =
    activeRide.role === "driver"
      ? t("activeRide.bannerDriver")
      : t("activeRide.bannerPassenger");

  const screen =
    activeRide.role === "driver" ? "/riderScreen" : "/rideScreen";

  const qs = Object.entries(activeRide.params)
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join("&");

  return (
    <Pressable
      onPress={() => router.push(`${screen}?${qs}` as any)}
      style={styles.rideBanner}
    >
      <LinearGradient
        colors={["#FD165A", "#8938D5"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={styles.rideBannerGrad}
      >
        <View style={styles.rideBannerLeft}>
          <View style={styles.rideBannerDot} />
          <Text style={styles.rideBannerText}>{label}</Text>
        </View>
        <View style={styles.rideBannerBtn}>
          <Text style={styles.rideBannerBtnText}>{t("activeRide.returnBtn")}</Text>
          <Text style={{fontSize: 12}}>→</Text>
        </View>
      </LinearGradient>
    </Pressable>
  );
}

interface DriverBannerProps {
  isOnline: boolean;
  session: DriverSession | null;
  goOffline: () => Promise<void>;
}

function DriverOnlineBanner({ isOnline, session, goOffline }: DriverBannerProps) {
  const { t } = useLanguage();
  const router = useRouter();
  const segments = useSegments();

  const onDriverScreen = (segments as string[]).some(
    (s) => s === "driverRequestsScreen" || s === "riderScreen" || s === "rideScreen",
  );
  if (!isOnline || onDriverScreen) return null;

  return (
    <Pressable onPress={() => router.push("/driverRequestsScreen")} style={styles.rideBanner}>
      <LinearGradient
        colors={["#059669", "#34d399"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={styles.rideBannerGrad}
      >
        <View style={styles.rideBannerLeft}>
          <View style={[styles.rideBannerDot, { backgroundColor: "#fff" }]} />
          <Text style={styles.rideBannerText} numberOfLines={1}>
            {t("driveOnline.bannerOnline")}
            {session?.destination ? ` · ${session.destination}` : ""}
          </Text>
        </View>
        <Pressable
          onPress={(e) => { e.stopPropagation?.(); void goOffline(); }}
          hitSlop={8}
          style={styles.rideBannerBtn}
        >
          <Text style={styles.rideBannerBtnText}>{t("driveOnline.goOffline")}</Text>
        </Pressable>
      </LinearGradient>
    </Pressable>
  );
}

/** Floating banner for non-tab screens. Same green colour as DriverOnlineBanner
 *  (which lives in the tabs header), but rendered as an absolute overlay so it
 *  always appears at the top of any screen while the driver is available. */
function GlobalDriverAvailabilityBanner({ isOnline, session, goOffline }: DriverBannerProps) {
  const { t } = useLanguage();
  const router = useRouter();
  const segments = useSegments();
  const { top: safeTop } = useSafeAreaInsets();

  // Tabs already show DriverOnlineBanner in the header — avoid duplicate.
  const onTabs = (segments as string[])[0] === "(tabs)";
  // Hide where the driver is actively managing their session or in a ride.
  const onExcludedScreen = (segments as string[]).some(
    (s) =>
      s === "driverRequestsScreen" ||
      s === "driveOnlineScreen" ||
      s === "riderScreen" ||
      s === "rideScreen",
  );

  if (onTabs || onExcludedScreen || !isOnline) return null;

  return (
    <View style={[styles.globalBanner, { top: safeTop }]} pointerEvents="box-none">
      <Pressable onPress={() => router.push("/driverRequestsScreen")} style={styles.rideBanner}>
        <LinearGradient
          colors={["#059669", "#34d399"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={styles.rideBannerGrad}
        >
          <View style={styles.rideBannerLeft}>
            <View style={[styles.rideBannerDot, { backgroundColor: "#fff" }]} />
            <Text style={styles.rideBannerText} numberOfLines={1}>
              {t("driveOnline.bannerOnline")}
              {session?.destination ? ` · ${session.destination}` : ""}
            </Text>
          </View>
          <Pressable
            onPress={(e) => { e.stopPropagation?.(); void goOffline(); }}
            hitSlop={8}
            style={styles.rideBannerBtn}
          >
            <Text style={styles.rideBannerBtnText}>{t("driveOnline.goOffline")}</Text>
          </Pressable>
        </LinearGradient>
      </Pressable>
    </View>
  );
}

function LayoutContent() {
  const { status, user } = useAuth();
  const colorScheme = useColorScheme() ?? "dark";
  const router = useRouter();
  const segments = useSegments();
  const {
    activeRide,
    clearActiveRide,
    pendingRequest,
    clearPendingRequest,
    pendingRequestHydrated,
  } = useActiveRide();

  // Single driver-session hook call — shared by DriverOnlineBanner (tabs header)
  // and GlobalDriverAvailabilityBanner (non-tabs overlay) to avoid duplicate fetches.
  const { isOnline, session, goOffline } = useDriverSession(user);

  // When the user becomes authenticated, validate the stored active ride.
  // If the ride no longer exists in Firestore (deleted or expired), or its
  // status is terminal, remove it from local storage so the banner disappears.
  useEffect(() => {
    if (status !== "authenticated" || !activeRide) return;
    let cancelled = false;
    fetchRideById(activeRide.rideId)
      .then((ride) => {
        if (cancelled) return;
        if (!ride || ride.status === "cancelled") {
          clearActiveRide();
        }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, activeRide?.rideId, clearActiveRide]);

  // Resume an in-progress ride search after the app was closed/reopened while
  // the passenger was waiting for a driver (findingDriverScreen persists the
  // request; see ActiveRideContext).
  //
  // This only ever resumes a request *restored from storage at launch*. A request
  // created during this session already pushed findingDriverScreen itself — that
  // screen is what writes the pending record, so reacting to it here would push a
  // second copy of the screen the user is already looking at. Hence the guard is
  // armed as soon as auth + hydration are both ready, whether or not a request
  // exists: everything after that first pass is by definition in-session.
  const resumedPendingRef = useRef(false);

  // Allow one resume per authenticated session (sign out → sign in re-arms).
  useEffect(() => {
    if (status !== "authenticated") resumedPendingRef.current = false;
  }, [status]);

  useEffect(() => {
    if (status !== "authenticated" || !pendingRequestHydrated) return;
    if (resumedPendingRef.current) return;
    resumedPendingRef.current = true;
    if (!pendingRequest) return; // nothing was stored at launch — nothing to resume
    let cancelled = false;

    (async () => {
      // If the app was cold-started by tapping the "driver accepted" push,
      // use-push-notifications already routes to the ride screen — defer to it
      // and just clear the pending record to avoid a double navigation.
      try {
        const lastResponse = await Notifications.getLastNotificationResponseAsync();
        const data = lastResponse?.notification.request.content.data as
          | Record<string, unknown>
          | undefined;
        if (data?.type === "driver_accepted") {
          if (!cancelled) clearPendingRequest();
          return;
        }
      } catch {
        // fall through to status validation
      }

      const request = await fetchRideRequestById(pendingRequest.requestId).catch(() => null);
      if (cancelled) return;

      const p = pendingRequest.params;
      if (request?.status === "open") {
        // Still searching — re-open the radar sheet and re-attach the listener.
        const qs = Object.entries(p)
          .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
          .join("&");
        router.push(`/findingDriverScreen?${qs}` as never);
      } else if (request?.status === "matched" && request.matchedRideId) {
        // Accepted while the app was closed — resume at the swipe-to-confirm
        // screen. It self-forwards to rideScreen if the passenger already
        // confirmed, so this is safe whether or not confirmation happened.
        clearPendingRequest();
        router.replace(
          `/matchDriverScreen?rideId=${request.matchedRideId}&requestId=${pendingRequest.requestId}&originLat=${p.originLat ?? "0"}&originLng=${p.originLng ?? "0"}&destLat=${p.destLat ?? "0"}&destLng=${p.destLng ?? "0"}` as never,
        );
      } else {
        // Gone / cancelled / expired — nothing to resume.
        clearPendingRequest();
      }
    })();

    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, pendingRequestHydrated, pendingRequest?.requestId]);

  // Hydrate live ride pricing from Firestore (config/pricing) once authenticated,
  // so in-app fare estimates match what the server actually charges. Fail-open:
  // leaves the hardcoded defaults in place on any error.
  useEffect(() => {
    if (status !== "authenticated") return;
    let cancelled = false;
    fetchRidePricing()
      .then((pricing) => { if (!cancelled) setRidePricing(pricing); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [status]);

  usePushNotifications();

  const notifGate = useNotificationGate();

  // OTA gate: check/fetch/reload the latest JS bundle before rendering. Fail-open.
  const ota = useOtaUpdate();

  // Fetch live force-update config from Firestore; falls back to disabled locally.
  const forceUpdateConfig = useForceUpdateConfigFetcher();
  const installedVersion = Constants.expoConfig?.version ?? "0.0.0";
  const updateRequired =
    !forceUpdateConfig.loading &&
    forceUpdateConfig.enabled &&
    isUpdateRequired(installedVersion, forceUpdateConfig.minimumVersion);

  // Fetch live countdown config from Firestore; falls back to local constants.
  const remoteConfig = useCountdownConfigFetcher();

  // Tick every second so the gate re-evaluates when the timer hits zero.
  useCountdown(remoteConfig.endMs);
  const countdownActive =
    !remoteConfig.loading &&
    isCountdownActive(remoteConfig.enabled, remoteConfig.endMs);

  // Countdown gate: force the user onto the correct screen when the
  // countdown is active, and off the countdown screens once it elapses.
  useEffect(() => {
    if (status === "initializing" || remoteConfig.loading) return;
    const current = (segments[0] as string | undefined) ?? "";

    if (countdownActive) {
      if (status === "authenticated") {
        // Stay on (auth) while the user is completing the Apple signup step 2.
        if (current !== "countdown-confirmation" && current !== "(auth)") {
          router.replace("/countdown-confirmation");
        }
      } else if (current !== "countdown" && current !== "(auth)") {
        // Safeguard: redirect any unrecognised route to countdown
        router.replace("/countdown");
      }
    } else {
      if (current === "countdown") {
        router.replace("/(auth)/login");
      } else if (current === "countdown-confirmation") {
        router.replace("/(tabs)");
      }
    }
  }, [status, countdownActive, segments, router, remoteConfig.loading]);

  const theme = useMemo(() => {
    const baseTheme = colorScheme === "dark" ? DarkTheme : DefaultTheme;
    return {
      ...baseTheme,
      colors: { ...baseTheme.colors, background: BG, card: BG },
    };
  }, [colorScheme]);

  const commonStackOptions = useMemo(
    () => ({
      animation: "none" as const,
      headerShown: false,
      contentStyle: { backgroundColor: BG },
    }),
    [],
  );

  if (status === "initializing" || remoteConfig.loading || forceUpdateConfig.loading || ota.checking) {
    return (
      <View style={styles.loader}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  if (updateRequired) {
    return (
      <UpdateRequiredScreen
        minimumVersion={forceUpdateConfig.minimumVersion}
        iosStoreUrl={forceUpdateConfig.iosStoreUrl}
        androidStoreUrl={forceUpdateConfig.androidStoreUrl}
      />
    );
  }

  if (status === "authenticated" && !notifGate.loading && !notifGate.permissionGranted) {
    return (
      <>
        <NotificationGateScreen
          permissionDenied={notifGate.permissionDenied}
          requesting={notifGate.requesting}
          onEnable={notifGate.requestPermission}
          onOpenSettings={notifGate.openSettings}
        />
        <StatusBar style={STATUS_BAR_STYLE} backgroundColor={BG} translucent={false} />
      </>
    );
  }

  const tabsHeaderShown = !countdownActive;

  return (
    <CountdownConfigContext.Provider value={remoteConfig}>
    <ThemeProvider value={theme}>
      {status === "unauthenticated" ? (
        // When countdown is active, declare `countdown` first so expo-router
        // starts there on cold open. `(auth)` is still registered so the user
        // can reach signup/login by tapping the CTA on the countdown screen.
        <Stack screenOptions={commonStackOptions}>
          {countdownActive ? (
            <>
              <Stack.Screen name="countdown" />
              <Stack.Screen name="(auth)" />
            </>
          ) : (
            <Stack.Screen name="(auth)" />
          )}
        </Stack>
      ) : (
        <>
          <Stack screenOptions={commonStackOptions}>
            <Stack.Screen
              name="(tabs)"
              options={{
                headerShown: tabsHeaderShown,
                header: () => (
                  <>
                    <AppHeader />
                    <ActiveRideBanner />
                    <DriverOnlineBanner isOnline={isOnline} session={session} goOffline={goOffline} />
                  </>
                ),
                animation: "none",
                contentStyle: { backgroundColor: BG },
              }}
            />
            <Stack.Screen name="rideScreen" options={{ headerShown: false }} />
            <Stack.Screen name="riderScreen" options={{ headerShown: false }} />
            <Stack.Screen name="profileSettings" options={{ headerShown: false }} />
            <Stack.Screen name="favoriteScreen" options={{ headerShown: false }} />
            <Stack.Screen name="driverModeScreen" options={{ headerShown: false }} />
            <Stack.Screen name="driveOnlineScreen" options={{ headerShown: false }} />
            <Stack.Screen name="driverRequestsScreen" options={{ headerShown: false }} />
            <Stack.Screen
              name="findingDriverScreen"
              options={{
                headerShown: false,
                // A full-screen card (NOT a modal). Presenting this as a
                // transparentModal made every downstream passenger screen
                // (matchDriverScreen → rideScreen) inherit the reused modal
                // container via router.replace, so the whole flow rendered
                // inside a modal. Keeping it a card keeps the chain card↔card.
                animation: "slide_from_bottom",
                contentStyle: { backgroundColor: BG },
              }}
            />
            <Stack.Screen
              name="matchDriverScreen"
              options={{
                headerShown: false,
                animation: "slide_from_bottom",
                gestureEnabled: false,
              }}
            />
            <Stack.Screen name="rewardsScreen" options={{ headerShown: false }} />
            <Stack.Screen name="certificationScreen" options={{ headerShown: false }} />
            <Stack.Screen name="acceptRideScreen" options={{ headerShown: false }} />
            {isDev && <Stack.Screen name="devToolsScreen" options={{ headerShown: false }} />}
            <Stack.Screen name="onboardingScreen" options={{ headerShown: false }} />
            <Stack.Screen name="countdown-confirmation" options={{ headerShown: false }} />
          </Stack>
          {/* Floating availability banner — shown on non-tab screens when driver is online.
              Distinct from the active-ride (pink/purple) banner; this one is always green
              and routes back to the driver inbox, not to an active ride. */}
          <GlobalDriverAvailabilityBanner isOnline={isOnline} session={session} goOffline={goOffline} />
        </>
      )}
      <StatusBar
        style={STATUS_BAR_STYLE}
        backgroundColor={BG}
        translucent={false}
      />
    </ThemeProvider>
    </CountdownConfigContext.Provider>
  );
}

const styles = StyleSheet.create({
  loader:       { flex: 1, justifyContent: "center", alignItems: "center" },
  banner:          { paddingHorizontal: 16, paddingBottom: 14, borderBottomWidth: 1, borderBottomColor: "rgba(137, 56, 213, 0.55)", overflow: "hidden" },
  bannerHighlight: { position: "absolute", top: 0, left: 0, right: 0, height: 1, backgroundColor: "rgba(255, 255, 255, 0.12)" },
  bannerRow:    { flexDirection: "row", alignItems: "center", justifyContent: "center" },
  bannerText:   { flex: 1, color: "#f3f4f6", fontSize: 28, fontWeight: "800", letterSpacing: 0.5, textAlign: "left" },
  devBadge: {
    backgroundColor: "#f97316",
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
    marginRight: 8,
  },
  devBadgeText: { color: "#fff", fontSize: 10, fontWeight: "800", letterSpacing: 1 },
  walletPill:   {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: "rgba(224, 154, 247, 0.15)",
    borderWidth: 1,
    borderColor: "rgba(224, 154, 247, 0.35)",
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  walletAmount: { color: "#f3f4f6", fontSize: 13, fontWeight: "700" },

  // ── Global driver availability overlay (non-tab screens) ────────────────
  globalBanner: { position: "absolute", left: 0, right: 0, zIndex: 999 },

  // ── Active Ride Banner ───────────────────────────────────────────────────
  rideBanner: { overflow: "hidden" },
  rideBannerGrad: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  rideBannerLeft: { flexDirection: "row", alignItems: "center", gap: 8 },
  rideBannerDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#34d399",
  },
  rideBannerText: { color: "#fff", fontSize: 13, fontWeight: "600" },
  rideBannerBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "rgba(255,255,255,0.2)",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  rideBannerBtnText: { color: "#fff", fontSize: 12, fontWeight: "700" },
});
