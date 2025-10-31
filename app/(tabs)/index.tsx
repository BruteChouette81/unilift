import React, { useState } from 'react';
import { ScrollView, StyleSheet } from 'react-native';

import MapView from '@/components/mapview';
import RideCard from '@/components/ridecard';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
export default function HomeScreen() {
  const [selectedRide, setSelectedRide] = useState<any>({
    driver: { name: "John D.", avatar: "https://via.placeholder.com/80" },
    destination: "Central Park",
    seats: 2,
    time: "10:15 AM",
  });
   const mockRides = [
    { driver: { name: "John D.", avatar: "https://via.placeholder.com/80" }, rating: 4.9, destination: "University Campus", seats: 3, time: "8:30 AM", distance: "2.5 km", level: 12, onPress: () => {} },
    { driver: { name: "John D.", avatar: "https://via.placeholder.com/80" }, rating: 4.7, destination: "Downtown Bars", seats: 2, time: "9:00 PM", distance: "3.8 km", level: 8, onPress: () => {} },
    { driver: { name: "John D.", avatar: "https://via.placeholder.com/80" }, rating: 5.0, destination: "North Campus", seats: 4, time: "7:45 AM", distance: "1.2 km", level: 15, onPress: () => {} },
    { driver: { name: "John D.", avatar: "https://via.placeholder.com/80" }, rating: 4.8, destination: "Student District", seats: 1, time: "10:30 PM", distance: "4.1 km", level: 10 , onPress: () => {}},
  ];

  return (
    <ScrollView>
      {/* Map */}
      <ThemedView style={styles.mapContainer}>
        <MapView onRideSelect={setSelectedRide} />
      </ThemedView>

      {/* Selected Ride */}
      {selectedRide && (
        <ThemedView style={styles.selectedRideContainer}>
          <ThemedText >Selected Ride</ThemedText>
          <RideCard driver={selectedRide.driver}
            rating={4.8}
            destination={selectedRide.destination}
            seats={selectedRide.seats}
            time={selectedRide.time}
            distance="2.5 km"
            level={12}
            onPress={() => {}}
            
          />
        </ThemedView>
      )}

      {/* Nearby Rides */}
      <ThemedView style={styles.nearbyContainer}>
        <ThemedText >Nearby Rides</ThemedText>
        <ThemedView style={styles.rideList}>
          {mockRides.slice(0, 2).map((ride, index) => (
            <RideCard key={index} {...ride} />
          ))}
        </ThemedView>
      </ThemedView>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  
  titleContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  stepContainer: {
    gap: 8,
    marginBottom: 8,
  },
  reactLogo: {
    height: 178,
    width: 290,
    bottom: 0,
    left: 0,
    position: 'absolute',
  },
  container: {
    paddingBottom: 96, // ~pb-24
    paddingHorizontal: 16,
    gap: 24, // space-y-6
  },
  mapContainer: {
    height: 400,
    borderRadius: 16,
    overflow: "hidden",
    
    shadowOpacity: 0.1,
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 8,
    elevation: 3, // for Android shadow
  },
  selectedRideContainer: {
    marginTop: 16,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: "#111",
    marginBottom: 12,
  },
  nearbyContainer: {
    marginTop: 8,
  },
  rideList: {
    gap: 12,
  },
});
