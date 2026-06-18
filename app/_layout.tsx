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

import { runtimeConfig } from "@/constants/runtime-config";
import { ActiveRideProvider, useActiveRide } from "@/context/ActiveRideContext";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import { LanguageProvider, useLanguage } from "@/context/LanguageContext";
import { UserProfileProvider } from "@/context/UserProfileContext";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { usePushNotifications } from "@/hooks/use-push-notifications";
import { useWallet } from "@/hooks/use-wallet";
import SplashAnimation from "@/components/SplashAnimation";
import { DarkTheme, DefaultTheme, ThemeProvider } from "@react-navigation/native";
import { StripeProvider } from "@stripe/stripe-react-native";
import { LinearGradient } from "expo-linear-gradient";
import * as SplashScreen from "expo-splash-screen";
import { Stack, useRouter, useSegments } from "expo-router";
import { StatusBar } from "expo-status-bar";
import React, { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const BG = "#101010";
const STATUS_BAR_STYLE = "light";

const BANNER_GRADIENT  = ["#2d0015", "#1c0038"] as const;
const BANNER_BORDER    = "rgba(137, 56, 213, 0.22)";
const PURPLE_LIGHT     = "#e09af7";

export default function RootLayout() {
  const [showSplash, setShowSplash] = useState(true);

  useEffect(() => {
    SplashScreen.hideAsync().catch(() => {});
  }, []);

  return (
    <StripeProvider
      publishableKey={runtimeConfig.stripePublishableKey}
      merchantIdentifier="merchant.identifier"
      urlScheme="your-url-scheme"
    >
      <AuthProvider>
        <UserProfileProvider>
          <LanguageProvider>
            <ActiveRideProvider>
              <LayoutContent />
            </ActiveRideProvider>
          </LanguageProvider>
        </UserProfileProvider>
      </AuthProvider>
      {showSplash && <SplashAnimation onFinish={() => setShowSplash(false)} />}
    </StripeProvider>
  );
}

function AppHeader() {
  const { user } = useAuth();
  const { balance, loading } = useWallet(user);
  const { top: safeTop } = useSafeAreaInsets();
  const router = useRouter();

  return (
    <LinearGradient
      colors={BANNER_GRADIENT}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 0 }}
      style={[styles.banner, { paddingTop: safeTop + 7 }]}
    >
      <View style={styles.bannerRow}>
        <Text style={styles.bannerText}>UniLift</Text>

        <TouchableOpacity
          style={styles.walletPill}
          activeOpacity={0.75}
          onPress={() => router.push("/(tabs)/wallet")}
        >
          <Text style={{fontSize: 12}}>💰</Text>
          <Text style={styles.walletAmount}>
            {loading ? "—" : `$${(balance / 100).toFixed(2)}`}
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

function LayoutContent() {
  const { status } = useAuth();
  const colorScheme = useColorScheme() ?? "dark";

  usePushNotifications();

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

  if (status === "initializing") {
    return (
      <View style={styles.loader}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  return (
    <ThemeProvider value={theme}>
      {status === "unauthenticated" ? (
        <Stack screenOptions={commonStackOptions}>
          <Stack.Screen name="(auth)" />
        </Stack>
      ) : (
        <>
          <Stack screenOptions={commonStackOptions}>
            <Stack.Screen
              name="(tabs)"
              options={{
                headerShown: true,
                header: () => (
                  <>
                    <AppHeader />
                    <ActiveRideBanner />
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
            <Stack.Screen name="createRideScreen" options={{ headerShown: false }} />
            <Stack.Screen name="rewardsScreen" options={{ headerShown: false }} />
          </Stack>
        </>
      )}
      <StatusBar
        style={STATUS_BAR_STYLE}
        backgroundColor={BG}
        translucent={false}
      />
    </ThemeProvider>
  );
}

const styles = StyleSheet.create({
  loader:       { flex: 1, justifyContent: "center", alignItems: "center" },
  banner:       { paddingHorizontal: 16, paddingBottom: 14, borderBottomWidth: 1, borderBottomColor: BANNER_BORDER },
  bannerRow:    { flexDirection: "row", alignItems: "center", justifyContent: "center" },
  bannerText:   { flex: 1, color: "#f3f4f6", fontSize: 28, fontWeight: "800", letterSpacing: 0.5, textAlign: "left" },
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
