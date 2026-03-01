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
import { AuthProvider, useAuth } from "@/context/AuthContext";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { DarkTheme, DefaultTheme, ThemeProvider } from "@react-navigation/native";
import { StripeProvider } from "@stripe/stripe-react-native";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import React, { useMemo } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";

const BG = "#101010";
const STATUS_BAR_STYLE = "light";

export default function RootLayout() {
  return (
    <StripeProvider
      publishableKey={runtimeConfig.stripePublishableKey}
      merchantIdentifier="merchant.identifier"
      urlScheme="your-url-scheme"
    >
      <AuthProvider>
        <LayoutContent />
      </AuthProvider>
    </StripeProvider>
  );
}

function LayoutContent() {
  const { status } = useAuth();
  const colorScheme = useColorScheme() ?? "dark";

  const theme = useMemo(() => {
    const baseTheme = colorScheme === "dark" ? DarkTheme : DefaultTheme;
    return {
      ...baseTheme,
      colors: {
        ...baseTheme.colors,
        background: BG,
        card: BG,
      },
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
        <Stack screenOptions={commonStackOptions}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="rideScreen" options={{ headerShown: false }} />
          <Stack.Screen name="riderScreen" options={{ headerShown: false }} />
        </Stack>
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
  loader: { flex: 1, justifyContent: "center", alignItems: "center" },
});
