import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { Image, StyleSheet, Text, TouchableOpacity, View } from "react-native";

interface Driver {
  name?: string;
  avatar?: string;
}

interface RideCardProps {
  driver: Driver;
  rating: number;
  destination: string;
  seats: number;
  time: string;
  distance: string;
  level: number;
  onPress: () => void;
}

export default function RideCard(props: RideCardProps) {
  return (
    <TouchableOpacity style={styles.card} activeOpacity={0.9} onPress={props.onPress}>
      <View style={styles.row}>
        {/* Driver avatar (placeholder) */}
        <Image
          source={{ uri: props.driver?.avatar || "https://via.placeholder.com/80" }}
          style={styles.avatar}
        />

        <View style={{ flex: 1 }}>
          <Text style={styles.driver}>{props.driver?.name || "Unknown Driver"}</Text>
          <View style={styles.ratingRow}>
            <Ionicons name="star" size={14} color="#facc15" />
            <Text style={styles.ratingText}>{props.rating?.toFixed(1) ?? "4.8"}</Text>
          </View>
        </View>

        <Text style={styles.time}>{props.time}</Text>
      </View>

      <View style={styles.info}>
        <Text style={styles.destination}>To {props.destination}</Text>
        <View style={styles.detailsRow}>
          <Text style={styles.detail}>
            <Ionicons name="people-outline" size={14} /> {props. seats} seats
          </Text>
          <Text style={styles.detail}>
            <Ionicons name="speedometer-outline" size={14} /> {props.distance}
          </Text>
          <Text style={styles.detail}>
            <Ionicons name="bar-chart-outline" size={14} /> Lvl {props.level}
          </Text>
        </View>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 16,
    shadowColor: "#000",
    shadowOpacity: 0.08,
    shadowOffset: { width: 0, height: 3 },
    shadowRadius: 6,
    elevation: 3,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 12,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    marginRight: 12,
    backgroundColor: "#e5e5e5",
  },
  driver: {
    fontSize: 16,
    fontWeight: "600",
  },
  ratingRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 2,
  },
  ratingText: {
    marginLeft: 4,
    color: "#555",
    fontSize: 14,
  },
  time: {
    fontWeight: "500",
    fontSize: 14,
    color: "#444",
  },
  info: {
    marginTop: 4,
  },
  destination: {
    fontWeight: "600",
    fontSize: 16,
    marginBottom: 4,
  },
  detailsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  detail: {
    color: "#555",
    fontSize: 13,
  },
});
