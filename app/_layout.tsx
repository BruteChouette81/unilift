import { runtimeConfig } from "@/constants/runtime-config";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import { useColorScheme } from "@/hooks/use-color-scheme";
import {
  DarkTheme,
  DefaultTheme,
  ThemeProvider,
} from "@react-navigation/native";
import { StripeProvider } from "@stripe/stripe-react-native";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { ActivityIndicator, View } from "react-native";

/**
 * 
 * # If you want a production-like build for TestFlight:
 * set new build version in package.json
eas build -p ios --profile production

eas submit -p ios --latest


 */

export default function RootLayout() {
  return (
    <StripeProvider
      publishableKey={runtimeConfig.stripePublishableKey}
      merchantIdentifier="merchant.identifier" // required for Apple Pay
      urlScheme="your-url-scheme" // required for 3D Secure and bank redirects
    >
      <AuthProvider>
        <LayoutContent />
      </AuthProvider>
    </StripeProvider>
  );
}

/*<Stack.Screen
  name="Ride"
  component={RideScreen}
  options={{ headerShown: false }} // hide header so back swipe is disabled
/>*/

function LayoutContent() {
  const { status } = useAuth();
  const colorScheme = useColorScheme();
  const statusBarBackground = "#101010";
  const statusBarStyle = "light";

  if (status === "initializing") {
    return (
      <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
        <ActivityIndicator size="large" />
      </View>
    );
  } else {
    const baseTheme = colorScheme === "dark" ? DarkTheme : DefaultTheme;
    const theme = {
      ...baseTheme,
      colors: {
        ...baseTheme.colors,
        background: "#101010",
        card: "#101010",
      },
    };

    // If the user is not authenticated, only show the auth stack

    console.log("status ------------>>", status);

    if (status === "unauthenticated") {
      console.log("enter--------------");

      return (
        <ThemeProvider value={theme}>
          <Stack
            screenOptions={{
              headerShown: false,
              animation: "none",
              contentStyle: { backgroundColor: "#101010" },
            }}
          >
            <Stack.Screen
              name="(auth)"
              options={{
                headerShown: false,
              }}
            />
          </Stack>
          <StatusBar
            style={statusBarStyle}
            backgroundColor={statusBarBackground}
            translucent={false}
          />
        </ThemeProvider>
      );
    }

    // Authenticated users see the main app
    return (
      <ThemeProvider value={theme}>
        <Stack
          screenOptions={{
            animation: "none",
            contentStyle: { backgroundColor: "#101010" },
          }}
        >
          <Stack.Screen
            name="(tabs)"
            options={{
              headerShown: false,
              title: "UniLift",
              headerTitleStyle: {
                fontSize: 30,
                fontWeight: "bold",
              },
            }}
          />
          <Stack.Screen name="rideScreen" options={{ headerShown: false }} />
          <Stack.Screen name="riderScreen" options={{ headerShown: false }} />
        </Stack>
        <StatusBar
          style={statusBarStyle}
          backgroundColor={statusBarBackground}
          translucent={false}
        />
      </ThemeProvider>
    );
  }
}
