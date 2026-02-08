import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";

type FavoriteRouteCardProps = {
  
  destination: string;
  onPress?: () => void;
};

export default function FavoriteRouteCard({destination, onPress }: FavoriteRouteCardProps) {
  return (
    <TouchableOpacity style={styles.card} onPress={onPress}>
      <View style={styles.iconContainer}>
        <Ionicons name="star" size={22} color="#FFD700" />
      </View>

      <View style={styles.routeContainer}>
       
        <Text style={styles.locationText} numberOfLines={1}>
          {destination}
        </Text>
      </View>

      <Ionicons name="chevron-forward" size={22} color="#B0B0B0" />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: "row",
    padding: 14,
    borderRadius: 10,
    backgroundColor: "#222",
    alignItems: "center",
    marginBottom: 10,
    shadowColor: "#000",
    shadowOpacity: 0.08,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
  },
  iconContainer: {
    width: 40,
    height: 40,
    borderRadius: 8,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#222",
    marginRight: 12,
  },
  routeContainer: {
    flex: 1,
  },
  locationText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#FFF",
  },
  line: {
    height: 1,
    backgroundColor: "#E0E0E0",
    marginVertical: 4,
  },
});