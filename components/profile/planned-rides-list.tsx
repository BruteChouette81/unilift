import React, { useCallback, useMemo } from "react";
import { Alert, FlatList, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import type { Ride, StartRidePayload } from "@/types/models";

type PlannedRidesListProps = {
  rides: Ride[];
  driverId?: string;
  onStartRide: (rideId: string, payload: StartRidePayload) => void;
  onCancelRide: (rideId: string) => void;
};

export function PlannedRidesList({
  rides,
  driverId,
  onStartRide,
  onCancelRide,
}: PlannedRidesListProps) {
  const today = useMemo(() => new Date().toISOString().split("T")[0], []);
  const plannedRides = useMemo(
    () => rides.filter((ride) => ride.status === "planned" && ride.driverId === driverId),
    [driverId, rides],
  );
  const keyExtractor = useCallback((item: Ride) => item.id, []);

  const renderItem = useCallback(({ item }: { item: Ride }) => {
    const rideDate = item.date?.split("T")[0];
    const canStart = rideDate === today;

    return (
      <View style={styles.card}>
        <Text style={styles.route}>{item.destination}</Text>
        <Text style={styles.date}>📅 {rideDate}</Text>
        <Text style={styles.status}>Status: {item.status}</Text>

        <View style={styles.actions}>
          <TouchableOpacity
            style={[styles.button, canStart ? styles.start : styles.disabled]}
            disabled={!canStart}
            onPress={() =>
              onStartRide(item.id, {
                originLat: item.localisation.latitude,
                originLng: item.localisation.longitude,
                destination: item.destination,
              })
            }
          >
            <Text style={styles.buttonText}>Start</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.button, styles.cancel]}
            onPress={() =>
              Alert.alert(
                "Cancel ride",
                "Are you sure you want to cancel this ride?",
                [
                  { text: "No" },
                  {
                    text: "Yes",
                    style: "destructive",
                    onPress: () => onCancelRide(item.id),
                  },
                ],
              )
            }
          >
            <Text style={styles.buttonText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }, [onCancelRide, onStartRide, today]);

  return (
    <FlatList
      data={plannedRides}
      keyExtractor={keyExtractor}
      renderItem={renderItem}
      contentContainerStyle={{ paddingBottom: 24 }}
      scrollEnabled={false}
      removeClippedSubviews
      initialNumToRender={4}
      maxToRenderPerBatch={8}
      windowSize={5}
    />
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: "#1e1e1e",
    padding: 16,
    borderRadius: 12,
    marginBottom: 12,
  },
  route: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
  date: {
    color: "#aaa",
    marginTop: 4,
  },
  status: {
    color: "#888",
    marginTop: 4,
  },
  actions: {
    flexDirection: "row",
    marginTop: 12,
  },
  button: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: "center",
    marginRight: 8,
  },
  start: {
    backgroundColor: "#4CAF50",
  },
  cancel: {
    backgroundColor: "#E53935",
  },
  disabled: {
    backgroundColor: "#555",
  },
  buttonText: {
    color: "#fff",
    fontWeight: "600",
  },
});
