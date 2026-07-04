import { Redirect, Tabs } from "expo-router";
import React, { useRef, useEffect, useState } from "react";
import { Animated, StyleSheet, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { BlurView } from "expo-blur";
import { LinearGradient } from "expo-linear-gradient";
import { BottomTabBarProps } from "@react-navigation/bottom-tabs";

import { useAuth } from "@/context/AuthContext";
import { useLanguage } from "@/context/LanguageContext";
import { Ionicons } from "@expo/vector-icons";

const C = {
  bg:          "#080810",
  border:      "rgba(137, 56, 213, 0.22)",
  purple:      "#8938D5",
  purpleLight: "#e09af7",
  pink:        "#FD165A",
  dim:         "#4b5563",
};

const TAB_BAR_HEIGHT = 68;
const SLIDER_W = 36;

const VISIBLE_TABS = ["index", "wallet", "profile"] as const;
type VisibleTabName = (typeof VISIBLE_TABS)[number];

const TAB_ICONS: Record<VisibleTabName, { focused: string; idle: string }> = {
  index:   { focused: "home",   idle: "home-outline" },
  wallet:  { focused: "wallet", idle: "wallet-outline" },
  profile: { focused: "person", idle: "person-outline" },
};

function CustomTabBar({ state, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const tabBarBottom = Math.max(insets.bottom, 8) + 10;
  const [barWidth, setBarWidth] = useState(0);

  const visibleRoutes = state.routes.filter(r =>
    (VISIBLE_TABS as readonly string[]).includes(r.name),
  );
  const numTabs = visibleRoutes.length;

  const activeVisibleIndex = Math.max(
    0,
    visibleRoutes.findIndex(r => r.key === state.routes[state.index]?.key),
  );

  const sliderAnim = useRef(new Animated.Value(activeVisibleIndex)).current;

  useEffect(() => {
    Animated.spring(sliderAnim, {
      toValue: activeVisibleIndex,
      useNativeDriver: true,
      tension: 80,
      friction: 12,
    }).start();
  }, [activeVisibleIndex]);

  const itemWidth = barWidth > 0 ? barWidth / numTabs : 0;

  const sliderTranslateX = sliderAnim.interpolate({
    inputRange: visibleRoutes.map((_, i) => i),
    outputRange: visibleRoutes.map((_, i) => {
      const iw = barWidth > 0 ? barWidth / numTabs : 0;
      return i * iw + iw / 2 - SLIDER_W / 2;
    }),
  });

  return (
    <View
      style={[
        styles.container,
        { bottom: tabBarBottom, height: TAB_BAR_HEIGHT },
      ]}
    >
      {/* Glass background */}
      <BlurView
        intensity={70}
        tint="dark"
        experimentalBlurMethod="dimezisBlurView"
        style={StyleSheet.absoluteFill}
      />
      <View style={[StyleSheet.absoluteFill, styles.bgOverlay]} />

      {/* Sliding top indicator */}
      {barWidth > 0 && (
        <Animated.View
          pointerEvents="none"
          style={[styles.sliderTrack, { transform: [{ translateX: sliderTranslateX }] }]}
        >
          <LinearGradient
            colors={[C.purple, C.pink]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={styles.sliderPill}
          />
        </Animated.View>
      )}

      {/* Tab items */}
      <View
        style={styles.tabsRow}
        onLayout={e => setBarWidth(e.nativeEvent.layout.width)}
      >
        {visibleRoutes.map(route => {
          const focused = route.key === state.routes[state.index]?.key;
          const routeName = route.name as VisibleTabName;
          const icons = TAB_ICONS[routeName];
          const color = focused ? C.purpleLight : C.dim;

          const onPress = () => {
            const event = navigation.emit({
              type: "tabPress",
              target: route.key,
              canPreventDefault: true,
            });
            if (!focused && !event.defaultPrevented) {
              navigation.navigate(route.name);
            }
          };

          const onLongPress = () => {
            navigation.emit({ type: "tabLongPress", target: route.key });
          };

          return (
            <TouchableOpacity
              key={route.key}
              style={styles.tabItem}
              onPress={onPress}
              onLongPress={onLongPress}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityState={focused ? { selected: true } : {}}
            >
              <View style={focused ? styles.iconActive : styles.iconIdle}>
                <Ionicons
                  name={(focused ? icons?.focused : icons?.idle) as keyof typeof Ionicons.glyphMap}
                  size={24}
                  color={color}
                />
              </View>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

export default function TabLayout() {
  const { status } = useAuth();
  const { t } = useLanguage();

  if (status === "unauthenticated") {
    return <Redirect href="/(auth)/login" />;
  }

  return (
    <Tabs
      tabBar={props => <CustomTabBar {...props} />}
      screenOptions={{
        sceneStyle: { backgroundColor: C.bg },
        headerShown: false,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{ title: t("tabs.home"), headerShown: false }}
      />
      <Tabs.Screen
        name="wallet"
        options={{ title: t("tabs.wallet"), headerShown: false }}
      />
      <Tabs.Screen
        name="profile"
        options={{ title: t("tabs.profile"), headerShown: false }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  container: {
    position: "absolute",
    left: 16,
    right: 16,
    borderRadius: 28,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: C.border,
    shadowColor: C.purple,
    shadowOpacity: 0.30,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 4 },
    elevation: 14,
  },
  bgOverlay: {
    backgroundColor: "rgba(15, 15, 30, 0.75)",
    borderRadius: 28,
  },
  sliderTrack: {
    position: "absolute",
    top: 0,
    width: SLIDER_W,
    alignItems: "center",
    zIndex: 10,
  },
  sliderPill: {
    width: SLIDER_W,
    height: 3,
    borderRadius: 1.5,
  },
  tabsRow: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
  },
  tabItem: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    height: "100%",
  },
  iconActive: {
    backgroundColor: "rgba(137,56,213,0.18)",
    borderRadius: 12,
    padding: 7,
    borderWidth: 1,
    borderColor: "rgba(137,56,213,0.30)",
  },
  iconIdle: {
    padding: 7,
    borderWidth: 1,
    borderColor: "transparent",
    borderRadius: 12,
  },
});
