import { Redirect, Tabs } from "expo-router";
import React from "react";
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { HapticTab } from "@/components/haptic-tab";
import { useAuth } from "@/context/AuthContext";
import { Ionicons } from "@expo/vector-icons";

const C = {
  bg:          "#080810",
  surface:     "#0f0f1e",
  border:      "rgba(124, 58, 237, 0.22)",
  purple:      "#7C3AED",
  purpleLight: "#a78bfa",
  dim:         "#4b5563",
};

export default function TabLayout() {
  const insets = useSafeAreaInsets();
  const { status } = useAuth();

  if (status === "unauthenticated") {
    return <Redirect href="/(auth)/login" />;
  }

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: C.purpleLight,
        tabBarInactiveTintColor: C.dim,
        tabBarStyle: {
          backgroundColor: C.surface,
          borderTopWidth: 1,
          borderTopColor: C.border,
          paddingBottom: Math.max(insets.bottom, 8),
          height: 60 + Math.max(insets.bottom, 8),
        },
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: "600",
          marginTop: 2,
        },
        sceneStyle: {
          backgroundColor: C.bg,
        },
        headerShown: false,
        tabBarButton: HapticTab,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Home",
          headerShown: false,
          tabBarIcon: ({ color, focused }) => (
            <View style={focused ? {
              backgroundColor: "rgba(124,58,237,0.15)",
              borderRadius: 10,
              padding: 5,
            } : { padding: 5 }}>
              <Ionicons name={focused ? "home" : "home-outline"} size={22} color={color} />
            </View>
          ),
        }}
      />
      <Tabs.Screen
        name="explore"
        options={{
          title: "Rides",
          headerShown: false,
          tabBarIcon: ({ color, focused }) => (
            <View style={focused ? {
              backgroundColor: "rgba(124,58,237,0.15)",
              borderRadius: 10,
              padding: 5,
            } : { padding: 5 }}>
              <Ionicons name={focused ? "car" : "car-outline"} size={22} color={color} />
            </View>
          ),
        }}
      />
      <Tabs.Screen
        name="wallet"
        options={{
          title: "Wallet",
          headerShown: false,
          tabBarIcon: ({ color, focused }) => (
            <View style={focused ? {
              backgroundColor: "rgba(124,58,237,0.15)",
              borderRadius: 10,
              padding: 5,
            } : { padding: 5 }}>
              <Ionicons name={focused ? "wallet" : "wallet-outline"} size={22} color={color} />
            </View>
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: "Profile",
          headerShown: false,
          tabBarIcon: ({ color, focused }) => (
            <View style={focused ? {
              backgroundColor: "rgba(124,58,237,0.15)",
              borderRadius: 10,
              padding: 5,
            } : { padding: 5 }}>
              <Ionicons name={focused ? "person" : "person-outline"} size={22} color={color} />
            </View>
          ),
        }}
      />
    </Tabs>
  );
}
