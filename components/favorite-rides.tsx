import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import React from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";

const C = {
  surface:     "#0f0f1e",
  border:      "rgba(124, 58, 237, 0.22)",
  borderFaint: "rgba(255, 255, 255, 0.06)",
  purpleLight: "#a78bfa",
  gold:        "#fbbf24",
  text:        "#f3f4f6",
  muted:       "#9ca3af",
  dim:         "#4b5563",
};

const CARD_GRADIENT = ["#1e1b4b", "#0d1224"] as const;

type FavoriteRouteCardProps = {
  destination: string;
  onPress?: () => void;
};

export default function FavoriteRouteCard({ destination, onPress }: FavoriteRouteCardProps) {
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.75} style={styles.card}>
      <LinearGradient colors={CARD_GRADIENT} style={styles.iconWrap}>
        <Ionicons name="star" size={16} color={C.gold} />
      </LinearGradient>

      <View style={styles.routeContainer}>
        <Text style={styles.locationText} numberOfLines={1}>
          {destination}
        </Text>
        <Text style={styles.subText}>Favorite destination</Text>
      </View>

      <Ionicons name="chevron-forward" size={16} color={C.dim} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 13,
    paddingHorizontal: 14,
    backgroundColor: C.surface,
    borderRadius: 12,
    marginBottom: 7,
    borderWidth: 1,
    borderColor: C.borderFaint,
    gap: 12,
  },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: C.border,
  },
  routeContainer: { flex: 1 },
  locationText: {
    color: C.text,
    fontSize: 14,
    fontWeight: "600",
  },
  subText: {
    color: C.dim,
    fontSize: 11,
    marginTop: 2,
  },
});
