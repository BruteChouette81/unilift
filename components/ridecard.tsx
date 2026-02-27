import { Ionicons } from "@expo/vector-icons";
import React, { memo, useEffect, useState } from "react";
import { Image, Pressable, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import {
  extractDriverSummary,
  fetchUserDocument,
} from "@/services/userService";

interface Driver {
  name?: string;
  avatar?: string | null;
  level?: number;
}

interface RideCardProps {
  driverId: string;
  rating: number;
  destination: string;
  seatsAvailable: number;
  time: string;
  origin: string;
  level: number;
  onPress: () => void;
}

const DEFAULT_AVATAR =
  "https://www.macfcu.org/wp-content/uploads/2024/02/Windows_10_Default_Profile_Picture.svg.png";
const driverSummaryCache = new Map<string, Driver>();

function RideCardComponent(props: RideCardProps) {
  const [driver, setDriver] = useState<Driver | null>(null);

  const getDriver = async (id: string) => {
    if (driverSummaryCache.has(id)) {
      setDriver(driverSummaryCache.get(id) ?? null);
      return;
    }
    const data = await fetchUserDocument(id);
    const summary = extractDriverSummary(data);
    driverSummaryCache.set(id, summary);
    setDriver(summary);
  };

  useEffect(() => {
    void getDriver(props.driverId);
  }, [props.driverId]);

  return (
    <TouchableOpacity style={styles.card} activeOpacity={0.9} onPress={props.onPress}>
      <View style={styles.row}>
        {/* Driver avatar (placeholder) */}
        <Image
          source={{ uri: driver?.avatar || DEFAULT_AVATAR }}
          style={styles.avatar}
        />

        <View style={{ flex: 1 }}>
          <Text style={styles.driver}>{driver?.name || "Unknown Driver"}</Text>
          <View style={styles.ratingRow}>
            <Ionicons name="star" size={14} color="#facc15" />
            <Text style={styles.ratingText}>{props.rating?.toFixed(1)}</Text>
          </View>
        </View>

        <Text style={styles.time}>{props.time}</Text>
      </View>

      <View style={styles.info}>
        <Text style={styles.destination}>To {props.destination}</Text>
        <View style={styles.detailsRow}>
          <Text style={styles.detail}>
            <Ionicons name="people-outline" size={14} /> {props.seatsAvailable} seats
          </Text>
          <Text style={styles.detail}>
            <Ionicons name="speedometer-outline" size={14} /> {props.origin}
          </Text>
          <Text style={styles.detail}>
            <Ionicons name="bar-chart-outline" size={14} /> Lvl {driver?.level}
          </Text>
        </View>
      </View>
    </TouchableOpacity>
  );
}
export default memo(RideCardComponent);

interface RideCardSelectedProps {
  driverId: string;
  rating: number;
  destination: string;
  seatsAvailable: number;
  time: string;
  origin: string;
  level: number;
  onPress: () => void;
  onCancel: () => void;
}

export function RideCardSlected(props: RideCardSelectedProps) {
  const [driver, setDriver] = useState<Driver | null>(null);

  const getDriver = async (id: string) => {
    if (driverSummaryCache.has(id)) {
      setDriver(driverSummaryCache.get(id) ?? null);
      return;
    }
    const data = await fetchUserDocument(id);
    const summary = extractDriverSummary(data);
    driverSummaryCache.set(id, summary);
    setDriver(summary);
  };

  useEffect(() => {
    void getDriver(props.driverId);
  }, [props.driverId]);

  return (
    <View style={styles.card} > 
      <View style={styles.row}>
        {/* Driver avatar (placeholder) */}
        <Image
          source={{ uri: driver?.avatar || DEFAULT_AVATAR }}
          style={styles.avatar}
        />

        <View style={{ flex: 1 }}>
          <Text style={styles.driver}>{driver?.name || "Unknown Driver"}</Text>
          <View style={styles.ratingRow}>
            <Ionicons name="star" size={14} color="#facc15" />
            <Text style={styles.ratingText}>{props.rating?.toFixed(1)}</Text>
          </View>
        </View>

        <Text style={styles.time}>{props.time}</Text>
      </View>

      <View style={styles.info}>
        <Text style={styles.destination}>To {props.destination}</Text>
        <View style={styles.detailsRow}>
          <Text style={styles.detail}>
            <Ionicons name="people-outline" size={14} /> {props.seatsAvailable} seats
          </Text>
          <Text style={styles.detail}>
            <Ionicons name="speedometer-outline" size={14} /> {props.origin}
          </Text>
          <Text style={styles.detail}>
            <Ionicons name="bar-chart-outline" size={14} /> Lvl {driver?.level}
          </Text>
        </View>
      </View>
      <View style={styles.buttonRow}>
         <Pressable style={styles.submitButton} onPress={props.onPress}>
                  <Text style={styles.btnText}>
                   Go
                  </Text>
                </Pressable>
        
               
                  <Pressable style={styles.cancelButton} onPress={props.onCancel}>
                    <Text style={styles.btnText}>Cancel</Text>
                  </Pressable>
                
      </View>
    </View>
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
  buttonRow: {
    flexDirection: "row",
    gap: 12,
    marginTop: 20,
  },
  submitButton: {
    backgroundColor: "#3B82F6",
    padding: 12,
    borderRadius: 10,
    flex: 1,
    alignItems: "center",
  },
  cancelButton: {
    backgroundColor: "gray",
    padding: 12,
    borderRadius: 10,
    flex: 1,
    alignItems: "center",
  },
 
  btnText: {
    color: "white",
    fontSize: 16,
    fontWeight: "700",
  },
});
