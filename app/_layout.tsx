import { AuthProvider, useAuth } from "@/context/AuthContext";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { DarkTheme, DefaultTheme, ThemeProvider } from "@react-navigation/native";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { ActivityIndicator, View } from "react-native";
//pk_test_51STT8xLp2qE85BeryLOWyCzhPYDoRJDXOYpGcuJUG5aQsPfkQ4grzZgtiqxQJuNoxSEHEpaTYjkXJrpCvcHWnzQu00nZkvFDFD
import { StripeProvider } from '@stripe/stripe-react-native';

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
      publishableKey="pk_test_51STT8xLp2qE85BeryLOWyCzhPYDoRJDXOYpGcuJUG5aQsPfkQ4grzZgtiqxQJuNoxSEHEpaTYjkXJrpCvcHWnzQu00nZkvFDFD"
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
  const { user, loading } = useAuth();
  const colorScheme = useColorScheme();

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
        <ActivityIndicator size="large" />
      </View>
    );
  } else {
    return (
      <ThemeProvider value={colorScheme === "dark" ? DarkTheme : DefaultTheme}>
      <Stack>
       
          <Stack.Screen name="(tabs)" options={{ headerShown: true, title: "UniLift",  headerTitleStyle: {
      fontSize: 30,
      fontWeight: "bold",
    }, }} />
          <Stack.Screen name="rideScreen" options={{ headerShown: false }} />
          <Stack.Screen name="riderScreen" options={{ headerShown: false }} />


          


       
      </Stack>
      <StatusBar style="auto" />
    </ThemeProvider>
    )
  }

  
}



