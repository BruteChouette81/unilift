import { useAuth } from '@/context/AuthContext';
import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import 'react-native-reanimated';
import { AuthProvider } from "../context/AuthContext";



import { useColorScheme } from '@/hooks/use-color-scheme';
import { ActivityIndicator, View } from 'react-native';

export const unstable_settings = {
  anchor: '(tabs)',
};

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const { user, loading } = useAuth();
  
  //if (loading) return null;

  

  return (
    <AuthProvider>
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <Stack>
        {loading ? <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
        <ActivityIndicator size="large" />
      </View> : user ? (
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />) : (
          <Stack.Screen name="signup" options={{ headerShown: false }} />
        )}
        <Stack.Screen name="modal" options={{ presentation: 'modal', title: 'Modal' }} />
        
      </Stack>
      <StatusBar style="auto" />
    </ThemeProvider>
    </AuthProvider>
  );
}







