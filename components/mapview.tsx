import React from "react";
import { StyleSheet, Text, View } from "react-native";

export default function RideMapView(onRideSelect: any) {
  return (
    <View style={styles.placeholder}>
      <Text style={styles.text}>🗺️ Map preview not available on web</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  placeholder: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 16,
    backgroundColor: "#f2f2f2",
  },
  text: {
    color: "#555",
    fontSize: 16,
  },
});
